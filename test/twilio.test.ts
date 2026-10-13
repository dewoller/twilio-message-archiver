import { test, expect } from "bun:test";
import { createTwilioClient, extFromContentType, verifyCredentials } from "../src/twilio";
import type { Config } from "../src/config";

const config: Config = {
  accountSid: "AC1", apiKeySid: "SK1", apiKeySecret: "sec",
  region: "us1", dataDir: "/tmp", apiBase: "https://api.twilio.com",
};

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

test("listAllMessages follows next_page_uri and concatenates", async () => {
  const calls: string[] = [];
  const fetchFn = (async (url: string) => {
    calls.push(url);
    if (calls.length === 1) {
      return jsonResponse({ messages: [{ sid: "SM1" }], next_page_uri: "/2010-04-01/Accounts/AC1/Messages.json?Page=1" });
    }
    return jsonResponse({ messages: [{ sid: "SM2" }], next_page_uri: null });
  }) as unknown as typeof fetch;
  const client = createTwilioClient(config, fetchFn);
  const msgs = await client.listAllMessages();
  expect(msgs.map((m) => m.sid)).toEqual(["SM1", "SM2"]);
  expect(calls[0]).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json?PageSize=1000");
  expect(calls[1]).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json?Page=1");
});

test("listAllMessages sends Basic auth from the API key", async () => {
  let authHeader = "";
  const fetchFn = (async (_url: string, init: RequestInit) => {
    authHeader = (init.headers as Record<string, string>).Authorization;
    return jsonResponse({ messages: [], next_page_uri: null });
  }) as unknown as typeof fetch;
  await createTwilioClient(config, fetchFn).listAllMessages();
  expect(authHeader).toBe("Basic " + Buffer.from("SK1:sec").toString("base64"));
});

test("listMedia maps the media_list", async () => {
  const fetchFn = (async () =>
    jsonResponse({ media_list: [{ sid: "ME1", content_type: "image/png", uri: "/x/ME1.json" }] })
  ) as unknown as typeof fetch;
  const client = createTwilioClient(config, fetchFn);
  const items = await client.listMedia({ subresource_uris: { media: "/x/Media.json" } } as any);
  expect(items).toEqual([{ sid: "ME1", contentType: "image/png", uri: "/x/ME1.json" }]);
});

test("downloadMedia requests the uri without .json and returns bytes", async () => {
  let requested = "";
  const fetchFn = (async (url: string) => {
    requested = url;
    return new Response(new Uint8Array([9, 8, 7]), { status: 200, headers: { "content-type": "image/png" } });
  }) as unknown as typeof fetch;
  const client = createTwilioClient(config, fetchFn);
  const { bytes, contentType } = await client.downloadMedia({ sid: "ME1", contentType: "image/png", uri: "/x/ME1.json" });
  expect(requested).toBe("https://api.twilio.com/x/ME1");
  expect(Array.from(bytes)).toEqual([9, 8, 7]);
  expect(contentType).toBe("image/png");
});

test("deleteMessage returns 'deleted' on 204 and 'not_found' on 404", async () => {
  const make = (status: number) =>
    createTwilioClient(config, (async () => new Response(null, { status })) as unknown as typeof fetch);
  expect(await make(204).deleteMessage("SM1")).toBe("deleted");
  expect(await make(404).deleteMessage("SM1")).toBe("not_found");
});

test("deleteMessage returns 'pending' on 409 code 20009 (delivery not completed)", async () => {
  const body = JSON.stringify({ code: 20009, message: "Cannot delete message because delivery has not been completed.", status: 409 });
  const client = createTwilioClient(config, (async () => new Response(body, { status: 409 })) as unknown as typeof fetch);
  expect(await client.deleteMessage("SM1")).toBe("pending");
});

test("deleteMessage still throws on a 409 with a different code", async () => {
  const body = JSON.stringify({ code: 20001, message: "other", status: 409 });
  const client = createTwilioClient(config, (async () => new Response(body, { status: 409 })) as unknown as typeof fetch);
  await expect(client.deleteMessage("SM1")).rejects.toThrow(/409/);
});

test("deleteMessage throws on unexpected status", async () => {
  const client = createTwilioClient(config, (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch);
  await expect(client.deleteMessage("SM1")).rejects.toThrow(/500/);
});

const verifyFetch = (status: number) =>
  (async () => new Response(status === 200 ? "{}" : "err", { status })) as unknown as typeof fetch;

test("verifyCredentials returns ok on 200 and hits the Account resource", async () => {
  let requested = "";
  const fetchFn = (async (url: string) => { requested = url; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
  expect(await verifyCredentials(config, fetchFn)).toEqual({ ok: true });
  expect(requested).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1.json");
});

test("verifyCredentials maps 401 to a credentials error", async () => {
  const r = await verifyCredentials(config, verifyFetch(401));
  expect(r.ok).toBe(false);
  expect(r.error).toContain("401");
});

test("verifyCredentials maps 404 to an account error", async () => {
  const r = await verifyCredentials(config, verifyFetch(404));
  expect(r.ok).toBe(false);
  expect(r.error).toContain("Account");
});

test("verifyCredentials reports other statuses", async () => {
  const r = await verifyCredentials(config, verifyFetch(500));
  expect(r.ok).toBe(false);
  expect(r.error).toContain("500");
});

test("extFromContentType maps common types and falls back to subtype", () => {
  expect(extFromContentType("image/jpeg")).toBe("jpg");
  expect(extFromContentType("image/png")).toBe("png");
  expect(extFromContentType("application/pdf")).toBe("pdf");
  expect(extFromContentType("audio/ogg")).toBe("ogg");
  expect(extFromContentType("")).toBe("bin");
});
