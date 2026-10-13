import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archive } from "../src/archive";
import { Store } from "../src/store";
import type { TwilioClient, TwilioMessage } from "../src/twilio";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "arch-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function msg(over: Partial<TwilioMessage>): TwilioMessage {
  return {
    sid: "SM1", account_sid: "AC1", messaging_service_sid: null, direction: "outbound-api",
    from: "+1", to: "+2", body: "hi", status: "delivered", num_segments: "1", num_media: "0",
    price: "-0.05", price_unit: "USD", error_code: null, error_message: null,
    date_created: "d1", date_sent: "d2", date_updated: "d3", api_version: "2010-04-01",
    subresource_uris: {}, ...over,
  };
}

function fakeClient(messages: TwilioMessage[], over: Partial<TwilioClient> = {}): TwilioClient & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    listAllMessages: async () => messages,
    listMedia: async () => [],
    downloadMedia: async () => ({ bytes: new Uint8Array([1]), contentType: "image/jpeg" }),
    deleteMessage: async (sid: string) => { deleted.push(sid); return "deleted"; },
    ...over,
  } as TwilioClient & { deleted: string[] };
}

const opts = (dryRun: boolean) => ({
  dryRun, now: () => new Date("2026-06-12T05:00:00.000Z"), log: () => {},
});

test("archives terminal messages, writes a row, and deletes them", async () => {
  const client = fakeClient([msg({ sid: "SM1", status: "delivered" })]);
  const store = new Store(dir); store.ensureDirs();
  const r = await archive(client, store, opts(false));
  expect(r.archived).toBe(1);
  expect(r.deleted).toBe(1);
  expect(client.deleted).toEqual(["SM1"]);
  const csv = readFileSync(join(dir, "messages_2026-06.csv"), "utf8");
  expect(csv).toContain("SM1,");
  expect(new Store(dir).loadLedger().has("SM1")).toBe(true);
});

test("skips in-flight (non-terminal) messages entirely", async () => {
  const client = fakeClient([msg({ sid: "SM1", status: "queued" })]);
  const store = new Store(dir); store.ensureDirs();
  const r = await archive(client, store, opts(false));
  expect(r.skippedInflight).toBe(1);
  expect(r.archived).toBe(0);
  expect(client.deleted).toEqual([]);
  expect(existsSync(join(dir, "messages_2026-06.csv"))).toBe(false);
});

test("dedupes against the ledger: no re-archive, but retries the delete of a message still on Twilio", async () => {
  const store = new Store(dir); store.ensureDirs();
  store.recordSid("SM1");
  const client = fakeClient([msg({ sid: "SM1", status: "delivered" })]);
  const r = await archive(client, store, opts(false));
  expect(r.skippedDuplicate).toBe(1);
  expect(r.archived).toBe(0);
  expect(r.deleted).toBe(1);
  expect(client.deleted).toEqual(["SM1"]);
  expect(existsSync(join(dir, "messages_2026-06.csv"))).toBe(false);
});

test("dry-run does not retry deletes for ledger duplicates", async () => {
  const store = new Store(dir); store.ensureDirs();
  store.recordSid("SM1");
  const client = fakeClient([msg({ sid: "SM1", status: "delivered" })]);
  const r = await archive(client, store, opts(true));
  expect(r.skippedDuplicate).toBe(1);
  expect(client.deleted).toEqual([]);
});

test("a delete Twilio refuses as pending (409/20009) keeps the run going and is retried next run", async () => {
  const pendingOnce = new Set(["SM1"]);
  const deleted: string[] = [];
  const client = fakeClient([msg({ sid: "SM1", status: "sent" }), msg({ sid: "SM2", status: "delivered" })], {
    deleteMessage: async (sid: string) => {
      if (pendingOnce.delete(sid)) return "pending";
      deleted.push(sid); return "deleted";
    },
  });
  const store = new Store(dir); store.ensureDirs();
  const r1 = await archive(client, store, opts(false));
  expect(r1.archived).toBe(2);
  expect(r1.deleted).toBe(1);
  expect(deleted).toEqual(["SM2"]);
  const r2 = await archive(fakeClient([msg({ sid: "SM1", status: "delivered" })], { deleteMessage: client.deleteMessage }), store, opts(false));
  expect(r2.archived).toBe(0);
  expect(r2.deleted).toBe(1);
  expect(deleted).toEqual(["SM2", "SM1"]);
  const csv = readFileSync(join(dir, "messages_2026-06.csv"), "utf8");
  expect(csv.split("\n").filter((l) => l.startsWith("SM1,")).length).toBe(1);
});

test("downloads media before delete and records relative paths", async () => {
  const client = fakeClient([msg({ sid: "SM1", status: "delivered", num_media: "1", subresource_uris: { media: "/m.json" } })], {
    listMedia: async () => [{ sid: "ME1", contentType: "image/jpeg", uri: "/x/ME1.json" }],
  });
  const store = new Store(dir); store.ensureDirs();
  await archive(client, store, opts(false));
  expect(existsSync(join(dir, "media", "SM1_0.jpg"))).toBe(true);
  const csv = readFileSync(join(dir, "messages_2026-06.csv"), "utf8");
  expect(csv).toContain("media/SM1_0.jpg");
});

test("media download failure skips the message: no row, no delete, retryable", async () => {
  const client = fakeClient([msg({ sid: "SM1", status: "delivered", num_media: "1", subresource_uris: { media: "/m.json" } })], {
    listMedia: async () => [{ sid: "ME1", contentType: "image/jpeg", uri: "/x/ME1.json" }],
    downloadMedia: async () => { throw new Error("network"); },
  });
  const store = new Store(dir); store.ensureDirs();
  const r = await archive(client, store, opts(false));
  expect(r.skippedMediaError).toBe(1);
  expect(client.deleted).toEqual([]);
  expect(existsSync(join(dir, "messages_2026-06.csv"))).toBe(false);
  expect(new Store(dir).loadLedger().has("SM1")).toBe(false);
});

test("dry-run touches nothing", async () => {
  const client = fakeClient([msg({ sid: "SM1", status: "delivered" })]);
  const store = new Store(dir); store.ensureDirs();
  const r = await archive(client, store, opts(true));
  expect(r.archived).toBe(1); // counts what it WOULD archive
  expect(client.deleted).toEqual([]);
  expect(existsSync(join(dir, "messages_2026-06.csv"))).toBe(false);
  expect(new Store(dir).loadLedger().size).toBe(0);
});
