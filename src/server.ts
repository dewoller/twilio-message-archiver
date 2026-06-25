import { writeFileSync } from "node:fs";
import type { TwilioClient, TwilioMessage } from "./twilio";
import { verifyCredentials } from "./twilio";
import type { Config } from "./config";
import { Store } from "./store";
import { archiveAndDeleteSelected } from "./archive";
import { renderIndex, renderSetup } from "./webapp/page";
import { buildEnvFile, envFilePath, DEFAULT_ACCOUNT_SID } from "./setup";

export interface MessageDTO {
  sid: string;
  from: string | null;
  to: string | null;
  body: string | null;
  status: string;
  direction: string | null;
  date_sent: string | null;
  num_media: string | null;
}

export function toDTO(m: TwilioMessage): MessageDTO {
  return {
    sid: m.sid, from: m.from, to: m.to, body: m.body, status: m.status,
    direction: m.direction, date_sent: m.date_sent, num_media: m.num_media,
  };
}

export interface ServerContext {
  client: TwilioClient;
  store: Store;
  token: string;
  allowedHosts: Set<string>;
  now: () => Date;
  log: (m: string) => void;
  configError?: string;
  // Setup-wizard wiring (injectable for tests).
  envPath: string;
  verify: (cfg: Config) => Promise<{ ok: boolean; error?: string }>;
  reconfigure: (cfg: Config) => void;
}

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// Loopback trust boundary: same host-allowlist + token check for every mutating
// or data API. Returns a 403 Response to short-circuit, or null when allowed.
function guard(req: Request, ctx: ServerContext): Response | null {
  const host = req.headers.get("host") ?? "";
  if (!ctx.allowedHosts.has(host)) return json({ error: "forbidden host" }, 403);
  if (req.headers.get("x-viewer-token") !== ctx.token) return json({ error: "forbidden" }, 403);
  return null;
}

export async function handleRequest(req: Request, ctx: ServerContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const isApi = path.startsWith("/api/");

  if (ctx.configError) {
    if (path === "/" && req.method === "GET")
      return html(renderSetup(ctx.token, { accountSid: DEFAULT_ACCOUNT_SID, region: "us1" }));
    if (path === "/api/setup" && req.method === "POST") {
      const denied = guard(req, ctx);
      if (denied) return denied;
      let v: any;
      try { v = await req.json(); } catch { return json({ error: "bad json" }, 400); }
      const candidate = {
        TWILIO_ACCOUNT_SID: v?.accountSid, TWILIO_API_KEY_SID: v?.apiKeySid,
        TWILIO_API_KEY_SECRET: v?.apiKeySecret, TWILIO_REGION: v?.region,
        ...(v?.dataDir ? { DATA_DIR: v.dataDir } : {}),
      };
      const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
      let cfg: Config;
      try { cfg = loadConfig(candidate); }
      catch (e) { return json({ error: msg(e) }, 400); }
      // verifyCredentials makes a real network call; a rejected fetch (offline,
      // TLS/proxy) must surface as JSON, not Bun's HTML 500 page.
      let check: { ok: boolean; error?: string };
      try { check = await ctx.verify(cfg); }
      catch (e) { return json({ error: `Could not reach Twilio to verify the credentials: ${msg(e)}` }, 502); }
      if (!check.ok) return json({ error: check.error }, 400);
      try {
        writeFileSync(ctx.envPath, buildEnvFile({
          accountSid: cfg.accountSid, apiKeySid: cfg.apiKeySid, apiKeySecret: cfg.apiKeySecret,
          region: cfg.region, dataDir: v?.dataDir,
        }));
      } catch (e) {
        return json({ error: `Credentials verified, but could not write the .env file at ${ctx.envPath}: ${msg(e)}` }, 500);
      }
      try { ctx.reconfigure(cfg); }
      catch (e) { return json({ error: `Saved .env, but could not start with it (${msg(e)}). Restart the viewer.` }, 500); }
      return json({ ok: true });
    }
    if (isApi) return json({ error: ctx.configError }, 503);
    return new Response("Not found", { status: 404 });
  }

  if (path === "/" && req.method === "GET") return html(renderIndex(ctx.token));

  if (isApi) {
    const denied = guard(req, ctx);
    if (denied) return denied;

    if (path === "/api/messages" && req.method === "GET") {
      const messages = (await ctx.client.listAllMessages()).map(toDTO);
      return json({ messages });
    }
    if (path === "/api/delete" && req.method === "POST") {
      let sids: unknown;
      try { sids = (await req.json())?.sids; } catch { return json({ error: "bad json" }, 400); }
      if (!Array.isArray(sids) || sids.length === 0) return json({ error: "no sids" }, 400);
      const summary = await archiveAndDeleteSelected(
        ctx.client, ctx.store, sids as string[], { now: ctx.now, log: ctx.log },
      );
      return json(summary);
    }
  }

  return new Response("Not found", { status: 404 });
}

import { loadConfig } from "./config";
import { resolveEnv, readEnvFile } from "./cli";
import { createTwilioClient } from "./twilio";

export interface StartOptions {
  client: TwilioClient;
  store: Store;
  configError?: string;
  port?: number;
  openBrowser?: (url: string) => void;
  envPath?: string;
  verify?: ServerContext["verify"];
}

export function buildContext(opts: {
  client: TwilioClient; store: Store; token: string; port: number; configError?: string;
  envPath?: string; verify?: ServerContext["verify"];
}): ServerContext {
  const ctx: ServerContext = {
    client: opts.client, store: opts.store, token: opts.token,
    allowedHosts: new Set([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`]),
    now: () => new Date(), log: (m) => console.log(m), configError: opts.configError,
    envPath: opts.envPath ?? envFilePath(),
    verify: opts.verify ?? verifyCredentials,
    reconfigure: () => {},
  };
  // Hot-reload: swap in a real client/store and clear the error in place so the
  // very next request (the fetchHandler closes over this same ctx) serves data.
  ctx.reconfigure = (cfg) => {
    ctx.client = createTwilioClient(cfg);
    ctx.store = new Store(cfg.dataDir);
    ctx.store.ensureDirs();
    ctx.configError = undefined;
  };
  return ctx;
}

function defaultOpenBrowser(url: string): void {
  const cmd = process.platform === "win32"
    ? ["cmd", "/c", "start", "", url]
    : process.platform === "darwin"
      ? ["open", url]
      : ["xdg-open", url];
  try { Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }); } catch { /* headless: ignore */ }
}

export function startServer(opts: StartOptions): { stop: () => void; url: string; port: number; token: string } {
  const token = crypto.randomUUID();
  const wanted = opts.port ?? Number(process.env.VIEWER_PORT ?? "8787");
  // Resolve the token-bound context lazily so allowedHosts matches the actual bound port.
  let ctx: ServerContext;
  const fetchHandler = (req: Request) => handleRequest(req, ctx);

  let server: ReturnType<typeof Bun.serve> | null = null;
  // Try the wanted port, then a handful of fallbacks (skip when port 0 = ephemeral).
  const candidates = wanted === 0 ? [0] : [wanted, wanted + 1, wanted + 2, wanted + 3, 0];
  let lastErr: unknown;
  for (const p of candidates) {
    try {
      server = Bun.serve({
        hostname: "127.0.0.1", port: p, fetch: fetchHandler,
        // Last-resort guard: any uncaught handler error returns JSON, never
        // Bun's default HTML page (which the browser fetch() can't parse).
        error(e) {
          return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
            { status: 500, headers: { "content-type": "application/json" } });
        },
      });
      break;
    }
    catch (e) { lastErr = e; }
  }
  if (!server) throw new Error(`could not bind a loopback port: ${lastErr}`);

  const port = server.port;
  if (!port) throw new Error("Bun.serve bound but reported no port");
  ctx = buildContext({
    client: opts.client, store: opts.store, token, port, configError: opts.configError,
    envPath: opts.envPath, verify: opts.verify,
  });
  const url = `http://127.0.0.1:${port}`;
  (opts.openBrowser ?? defaultOpenBrowser)(url);
  return { stop: () => server!.stop(true), url, port, token };
}

export async function main(): Promise<number> {
  const env = resolveEnv(readEnvFile(), process.env);
  let client: TwilioClient | undefined;
  let store: Store | undefined;
  let configError: string | undefined;
  try {
    const config = loadConfig(env);
    store = new Store(config.dataDir);
    store.ensureDirs();
    client = createTwilioClient(config);
  } catch (e) {
    configError = e instanceof Error ? e.message : String(e);
  }

  // In config-error mode we still serve the setup page; client/store are stubbed and unused.
  const safeStore = store ?? new Store(process.cwd());
  const safeClient = client ?? ({
    listAllMessages: async () => [], listMedia: async () => [],
    downloadMedia: async () => ({ bytes: new Uint8Array(), contentType: "" }),
    deleteMessage: async () => "not_found" as const,
  } as TwilioClient);

  const srv = startServer({ client: safeClient, store: safeStore, configError });
  console.log(`Twilio Message Viewer running at ${srv.url}`);
  if (configError) console.log(`Config problem: ${configError}`);
  await new Promise(() => {}); // keep the process alive until killed
  return 0;
}

if (import.meta.main) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
