import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleRequest, type ServerContext } from "../src/server";
import { Store } from "../src/store";
import type { TwilioClient, TwilioMessage } from "../src/twilio";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "srv-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function msg(over: Partial<TwilioMessage>): TwilioMessage {
  return {
    sid: "SM1", account_sid: "AC1", messaging_service_sid: null, direction: "inbound",
    from: "+1", to: "+2", body: "hi", status: "received", num_segments: "1", num_media: "0",
    price: null, price_unit: null, error_code: null, error_message: null,
    date_created: "d1", date_sent: "d2", date_updated: "d3", api_version: "2010-04-01",
    subresource_uris: {}, ...over,
  };
}
function fakeClient(messages: TwilioMessage[]): TwilioClient & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    listAllMessages: async () => messages,
    listMedia: async () => [],
    downloadMedia: async () => ({ bytes: new Uint8Array([1]), contentType: "image/jpeg" }),
    deleteMessage: async (sid: string) => { deleted.push(sid); return "deleted"; },
  } as TwilioClient & { deleted: string[] };
}
function ctx(over: Partial<ServerContext> = {}): ServerContext {
  const store = new Store(dir); store.ensureDirs();
  return {
    client: fakeClient([msg({ sid: "SM1" })]),
    store, token: "tok", allowedHosts: new Set(["127.0.0.1:8787"]),
    now: () => new Date("2026-06-24T05:00:00.000Z"), log: () => {},
    envPath: join(dir, ".env"),
    verify: async () => ({ ok: true }),
    reconfigure: () => {},
    ...over,
  };
}
const api = (path: string, init: RequestInit = {}) =>
  new Request("http://127.0.0.1:8787" + path, {
    ...init,
    headers: { Host: "127.0.0.1:8787", "X-Viewer-Token": "tok", ...(init.headers || {}) },
  });

test("GET / serves the page with the token", async () => {
  const res = await handleRequest(new Request("http://127.0.0.1:8787/"), ctx());
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(await res.text()).toContain("tok");
});

test("GET /api/messages returns slim DTOs", async () => {
  const res = await handleRequest(api("/api/messages"), ctx());
  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.messages).toHaveLength(1);
  expect(Object.keys(data.messages[0]).sort()).toEqual(
    ["body", "date_sent", "direction", "from", "num_media", "sid", "status", "to"],
  );
});

test("rejects a bad token with 403", async () => {
  const res = await handleRequest(api("/api/messages", { headers: { "X-Viewer-Token": "wrong" } }), ctx());
  expect(res.status).toBe(403);
});

test("rejects a foreign Host header with 403 (DNS-rebinding guard)", async () => {
  const res = await handleRequest(api("/api/messages", { headers: { Host: "evil.example.com" } }), ctx());
  expect(res.status).toBe(403);
});

test("POST /api/delete archives+deletes and returns a summary", async () => {
  const c = ctx();
  const res = await handleRequest(
    api("/api/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sids: ["SM1"] }) }),
    c,
  );
  expect(res.status).toBe(200);
  const s = await res.json();
  expect(s.deleted).toBe(1);
  expect((c.client as any).deleted).toEqual(["SM1"]);
});

test("POST /api/delete with no sids returns 400", async () => {
  const res = await handleRequest(
    api("/api/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sids: [] }) }),
    ctx(),
  );
  expect(res.status).toBe(400);
});

test("rejects an absent/empty Host header with 403", async () => {
  const res = await handleRequest(api("/api/messages", { headers: { Host: "" } }), ctx());
  expect(res.status).toBe(403);
});

test("POST /api/delete with non-array sids returns 400", async () => {
  const res = await handleRequest(
    api("/api/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sids: "SM1" }) }),
    ctx(),
  );
  expect(res.status).toBe(400);
});

test("unknown api route returns 404", async () => {
  const res = await handleRequest(api("/api/unknown"), ctx());
  expect(res.status).toBe(404);
});

test("config-error mode serves the interactive setup form on / and 503 on api", async () => {
  const root = await handleRequest(new Request("http://127.0.0.1:8787/"), ctx({ configError: "broken" }));
  expect(root.status).toBe(200);
  const body = await root.text();
  expect(body).toContain("/api/setup");
  expect(body).toContain('id="apiKeySecret"');
  const apiRes = await handleRequest(api("/api/messages"), ctx({ configError: "broken" }));
  expect(apiRes.status).toBe(503);
});

test("POST /api/setup rejects a bad token with 403", async () => {
  const res = await handleRequest(
    api("/api/setup", { method: "POST", headers: { "content-type": "application/json", "X-Viewer-Token": "wrong" }, body: "{}" }),
    ctx({ configError: "broken" }),
  );
  expect(res.status).toBe(403);
});

test("POST /api/setup with failing verify returns 400 and writes nothing", async () => {
  const envPath = join(dir, ".env");
  const res = await handleRequest(
    api("/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      accountSid: "AC9", apiKeySid: "SK1", apiKeySecret: "bad", region: "us1",
    }) }),
    ctx({ configError: "broken", envPath, verify: async () => ({ ok: false, error: "Twilio rejected these credentials (401). Check the API Key SID and Secret." }) }),
  );
  expect(res.status).toBe(400);
  expect((await res.json()).error).toContain("401");
  expect(existsSync(envPath)).toBe(false);
});

test("POST /api/setup with blank creds returns 400", async () => {
  const res = await handleRequest(
    api("/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      accountSid: "AC9", apiKeySid: "", apiKeySecret: "", region: "us1",
    }) }),
    ctx({ configError: "broken", envPath: join(dir, ".env") }),
  );
  expect(res.status).toBe(400);
});

test("POST /api/setup returns a JSON error (not HTML) when verify throws", async () => {
  const envPath = join(dir, ".env");
  const res = await handleRequest(
    api("/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      accountSid: "AC9", apiKeySid: "SK1", apiKeySecret: "sec", region: "us1",
    }) }),
    ctx({ configError: "broken", envPath, verify: async () => { throw new Error("network down"); } }),
  );
  expect(res.status).toBe(502);
  expect(res.headers.get("content-type")).toContain("application/json");
  expect((await res.json()).error).toContain("Twilio");
  expect(existsSync(envPath)).toBe(false);
});

test("POST /api/setup returns a JSON error when .env cannot be written", async () => {
  const badPath = join(dir, "missing-dir", "deeper", ".env");
  const res = await handleRequest(
    api("/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      accountSid: "AC9", apiKeySid: "SK1", apiKeySecret: "sec", region: "us1",
    }) }),
    ctx({ configError: "broken", envPath: badPath, verify: async () => ({ ok: true }) }),
  );
  expect(res.status).toBe(500);
  expect(res.headers.get("content-type")).toContain("application/json");
  expect((await res.json()).error).toContain(".env");
});

test("POST /api/setup writes .env, reconfigures, and clears config error", async () => {
  const envPath = join(dir, ".env");
  let reconfigured = false;
  const c = ctx({ configError: "broken", envPath, verify: async () => ({ ok: true }), reconfigure: () => { reconfigured = true; c.configError = undefined; } });
  const res = await handleRequest(
    api("/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      accountSid: "AC9", apiKeySid: "SK1", apiKeySecret: "sec", region: "us1",
    }) }),
    c,
  );
  expect(res.status).toBe(200);
  expect((await res.json()).ok).toBe(true);
  expect(existsSync(envPath)).toBe(true);
  expect(reconfigured).toBe(true);
  const root = await handleRequest(new Request("http://127.0.0.1:8787/"), c);
  expect(await root.text()).toContain("Twilio Message Viewer");
});
