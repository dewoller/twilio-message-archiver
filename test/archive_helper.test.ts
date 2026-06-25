import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveAndDeleteMessage } from "../src/archive";
import { Store } from "../src/store";
import type { TwilioClient, TwilioMessage } from "../src/twilio";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ahelp-")); });
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

function fakeClient(over: Partial<TwilioClient> = {}): TwilioClient & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    listAllMessages: async () => [],
    listMedia: async () => [],
    downloadMedia: async () => ({ bytes: new Uint8Array([1]), contentType: "image/jpeg" }),
    deleteMessage: async (sid: string) => { deleted.push(sid); return "deleted"; },
    ...over,
  } as TwilioClient & { deleted: string[] };
}

const NOW = new Date("2026-06-24T05:00:00.000Z");

test("archives and deletes a non-terminal message (no status filter in the helper)", async () => {
  const client = fakeClient();
  const store = new Store(dir); store.ensureDirs();
  const res = await archiveAndDeleteMessage(client, store, msg({ sid: "SM1", status: "queued" }), NOW, () => {});
  expect(res).toEqual({ outcome: "archived", deleted: true });
  expect(client.deleted).toEqual(["SM1"]);
  const csv = readFileSync(join(dir, "messages_2026-06.csv"), "utf8");
  expect(csv).toContain("SM1,");
  expect(new Store(dir).loadLedger().has("SM1")).toBe(true);
});

test("media download failure: no row, no delete, returns media-error", async () => {
  const client = fakeClient({
    listMedia: async () => [{ sid: "ME1", contentType: "image/jpeg", uri: "/x/ME1.json" }],
    downloadMedia: async () => { throw new Error("network"); },
  });
  const store = new Store(dir); store.ensureDirs();
  const res = await archiveAndDeleteMessage(
    client, store, msg({ sid: "SM1", num_media: "1", subresource_uris: { media: "/m.json" } }), NOW, () => {},
  );
  expect(res).toEqual({ outcome: "media-error", deleted: false });
  expect(client.deleted).toEqual([]);
  expect(existsSync(join(dir, "messages_2026-06.csv"))).toBe(false);
  expect(new Store(dir).loadLedger().has("SM1")).toBe(false);
});

test("treats Twilio not_found as deleted (idempotent)", async () => {
  const client = fakeClient({ deleteMessage: async () => "not_found" });
  const store = new Store(dir); store.ensureDirs();
  const res = await archiveAndDeleteMessage(client, store, msg({ sid: "SM1" }), NOW, () => {});
  expect(res).toEqual({ outcome: "archived", deleted: true });
});
