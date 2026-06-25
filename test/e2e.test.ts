import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { createTwilioClient } from "../src/twilio";
import type { TwilioClient } from "../src/twilio";
import { Store } from "../src/store";
import { archive } from "../src/archive";
import { startServer } from "../src/server";

function fakeMsgClient(): TwilioClient {
  return {
    listAllMessages: async () => [],
    listMedia: async () => [],
    downloadMedia: async () => ({ bytes: new Uint8Array([1]), contentType: "image/jpeg" }),
    deleteMessage: async () => "deleted" as const,
  };
}

test("setup wizard verifies, writes .env, and reconfigures over real HTTP", async () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-setup-"));
  const envPath = join(dir, ".env");
  try {
    const srv = startServer({
      client: fakeMsgClient(), store: new Store(dir),
      configError: "Missing required env vars: TWILIO_API_KEY_SID",
      port: 0, openBrowser: () => {},
      verify: async () => ({ ok: true }), envPath,
    });
    try {
      const host = new URL(srv.url).host;
      const setup = await fetch(srv.url + "/api/setup", {
        method: "POST",
        headers: { Host: host, "X-Viewer-Token": srv.token, "content-type": "application/json" },
        body: JSON.stringify({ accountSid: "AC9", apiKeySid: "SK1", apiKeySecret: "sec", region: "us1", dataDir: dir }),
      });
      expect(setup.status).toBe(200);
      expect((await setup.json()).ok).toBe(true);
      expect(existsSync(envPath)).toBe(true);
      // configError cleared → GET / now serves the real message-list page (no network).
      const root = await fetch(srv.url + "/", { headers: { Host: host } });
      expect(await root.text()).toContain("Archive + delete selected");
    } finally { srv.stop(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Safe: lists the real account but writes/deletes nothing. Runs only when creds present.
const haveCreds =
  !!process.env.TWILIO_ACCOUNT_SID &&
  !!process.env.TWILIO_API_KEY_SID &&
  !!process.env.TWILIO_API_KEY_SECRET;

test.if(haveCreds)("dry-run lists real messages and deletes nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-"));
  try {
    const config = loadConfig({ ...process.env, DATA_DIR: dir });
    const client = createTwilioClient(config);
    const r = await archive(client, new Store(dir), {
      dryRun: true, now: () => new Date(), log: () => {},
    });
    expect(r.fetched).toBeGreaterThanOrEqual(0);
    expect(r.deleted).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Destructive: only when TWILIO_E2E_DESTRUCTIVE=1. Sends one SMS, waits for it to
// reach a terminal state, archives for real, asserts the row + deletion.
const destructive = haveCreds && process.env.TWILIO_E2E_DESTRUCTIVE === "1";

test.if(destructive)("real archive captures then deletes a throwaway SMS", async () => {
  const from = process.env.TWILIO_E2E_FROM!;   // a Twilio number you own, e.g. +61468172567
  const to = process.env.TWILIO_E2E_TO!;       // your mobile, e.g. +61414529454
  const dir = mkdtempSync(join(tmpdir(), "e2e-d-"));
  try {
    const config = loadConfig({ ...process.env, DATA_DIR: dir });
    const auth = "Basic " + Buffer.from(`${config.apiKeySid}:${config.apiKeySecret}`).toString("base64");

    // Send a throwaway SMS via the REST API.
    const sendRes = await fetch(
      `${config.apiBase}/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: { Authorization: auth, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: to, From: from, Body: "archiver e2e test" }),
      },
    );
    const sent: any = await sendRes.json();
    const sid: string = sent.sid;
    expect(sid).toMatch(/^SM/);

    // Poll until the message reaches a terminal state (max ~60s).
    const client = createTwilioClient(config);
    let terminal = false;
    for (let i = 0; i < 30 && !terminal; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const all = await client.listAllMessages();
      const m = all.find((x) => x.sid === sid);
      terminal = !!m && ["delivered", "sent", "failed", "undelivered"].includes(m.status);
    }
    expect(terminal).toBe(true);

    const store = new Store(dir); store.ensureDirs();
    const r = await archive(client, store, { dryRun: false, now: () => new Date(), log: () => {} });
    expect(r.deleted).toBeGreaterThanOrEqual(1);
    expect(store.loadLedger().has(sid)).toBe(true);

    // Confirm it is gone from Twilio.
    const after = await client.listAllMessages();
    expect(after.find((x) => x.sid === sid)).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 90_000);

test.if(haveCreds)("viewer lists real messages over HTTP and deletes nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-viewer-"));
  try {
    const config = loadConfig({ ...process.env, DATA_DIR: dir });
    const client = createTwilioClient(config);
    const store = new Store(dir); store.ensureDirs();
    const srv = startServer({ client, store, port: 0, openBrowser: () => {} });
    try {
      const res = await fetch(srv.url + "/api/messages", {
        headers: { Host: new URL(srv.url).host, "X-Viewer-Token": srv.token },
      });
      expect(res.status).toBe(200);
      expect(Array.isArray((await res.json()).messages)).toBe(true);
    } finally {
      srv.stop();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
