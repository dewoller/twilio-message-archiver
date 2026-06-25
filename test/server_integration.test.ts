import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server";
import { Store } from "../src/store";
import type { TwilioClient, TwilioMessage } from "../src/twilio";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "srvint-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function msg(sid: string): TwilioMessage {
  return {
    sid, account_sid: "AC1", messaging_service_sid: null, direction: "inbound",
    from: "+1", to: "+2", body: "hi", status: "received", num_segments: "1", num_media: "0",
    price: null, price_unit: null, error_code: null, error_message: null,
    date_created: "d1", date_sent: "d2", date_updated: "d3", api_version: "2010-04-01",
    subresource_uris: {},
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

test("serves over real HTTP on a loopback ephemeral port", async () => {
  const store = new Store(dir); store.ensureDirs();
  const client = fakeClient([msg("SM1")]);
  const srv = startServer({ client, store, port: 0, openBrowser: () => {} });
  try {
    const headers = { Host: new URL(srv.url).host, "X-Viewer-Token": srv.token };
    const list = await fetch(srv.url + "/api/messages", { headers });
    expect(list.status).toBe(200);
    expect((await list.json()).messages).toHaveLength(1);

    const del = await fetch(srv.url + "/api/delete", {
      method: "POST", headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ sids: ["SM1"] }),
    });
    expect(del.status).toBe(200);
    expect((await del.json()).deleted).toBe(1);
    expect(client.deleted).toEqual(["SM1"]);
  } finally {
    srv.stop();
  }
});
