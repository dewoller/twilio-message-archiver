import { test, expect } from "bun:test";
import { renderIndex, renderSetup } from "../src/webapp/page";

test("renderIndex embeds the token and the core UI hooks", () => {
  const html = renderIndex("tok-123");
  expect(html).toContain("tok-123");
  expect(html).toContain('id="messages"');
  expect(html).toContain('id="select-all"');
  expect(html).toContain('id="delete-btn"');
  expect(html).toContain("/api/messages");
  expect(html).toContain("/api/delete");
  expect(html).toContain("X-Viewer-Token");
  expect(html).not.toContain("__VIEWER_TOKEN__"); // placeholder fully replaced
});

test("renderSetup embeds token, account default, and the three field names", () => {
  const html = renderSetup("tok123", { accountSid: "AC9", region: "us1" });
  expect(html).toContain("tok123");
  expect(html).toContain("AC9");
  expect(html).toContain('id="apiKeySid"');
  expect(html).toContain('id="apiKeySecret"');
  expect(html).toContain("/api/setup");
  expect(html).not.toContain("__VIEWER_TOKEN__");
  expect(html).not.toContain("__ACCOUNT_SID__");
});

test("renderSetup links to the Twilio console page that has all three values", () => {
  const html = renderSetup("tok", { accountSid: "AC9", region: "us1" });
  expect(html).toContain("https://console.twilio.com/us1/account/keys-credentials/api-keys");
});

test("renderSetup escapes injected default values", () => {
  const html = renderSetup("tok", { accountSid: '"><script>x</script>', region: "us1" });
  expect(html).not.toContain("<script>x</script>");
  expect(html).toContain("&lt;script&gt;");
});
