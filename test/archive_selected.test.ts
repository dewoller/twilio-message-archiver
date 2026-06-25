import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveAndDeleteSelected } from "../src/archive";
import { Store } from "../src/store";
import type { TwilioClient, TwilioMessage } from "../src/twilio";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "asel-")); });
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
const opts = { now: () => new Date("2026-06-24T05:00:00.000Z"), log: () => {} };

test("archives and deletes only the selected sids", async () => {
  const client = fakeClient([msg({ sid: "SM1" }), msg({ sid: "SM2" }), msg({ sid: "SM3" })]);
  const store = new Store(dir); store.ensureDirs();
  const s = await archiveAndDeleteSelected(client, store, ["SM1", "SM3"], opts);
  expect(client.deleted.sort()).toEqual(["SM1", "SM3"]);
  expect(s.archived).toBe(2);
  expect(s.deleted).toBe(2);
  expect(s.failed).toBe(0);
});

test("sid no longer on the account counts as already-deleted", async () => {
  const client = fakeClient([msg({ sid: "SM1" })]);
  const store = new Store(dir); store.ensureDirs();
  const s = await archiveAndDeleteSelected(client, store, ["SMGONE"], opts);
  expect(client.deleted).toEqual([]);
  expect(s.results[0]).toEqual({ sid: "SMGONE", archived: false, deleted: true });
});

test("sid already in ledger is deleted without re-archiving", async () => {
  const store = new Store(dir); store.ensureDirs();
  store.recordSid("SM1");
  const client = fakeClient([msg({ sid: "SM1" })]);
  const s = await archiveAndDeleteSelected(client, store, ["SM1"], opts);
  expect(client.deleted).toEqual(["SM1"]);
  expect(s.results[0]).toEqual({ sid: "SM1", archived: false, deleted: true });
});

test("media error is reported as failed and not deleted", async () => {
  const client = fakeClient(
    [msg({ sid: "SM1", num_media: "1", subresource_uris: { media: "/m.json" } })],
    { listMedia: async () => [{ sid: "ME1", contentType: "image/jpeg", uri: "/x/ME1.json" }],
      downloadMedia: async () => { throw new Error("network"); } },
  );
  const store = new Store(dir); store.ensureDirs();
  const s = await archiveAndDeleteSelected(client, store, ["SM1"], opts);
  expect(client.deleted).toEqual([]);
  expect(s.failed).toBe(1);
  expect(s.results[0].error).toBe("media download failed");
});
