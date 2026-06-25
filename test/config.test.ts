import { test, expect } from "bun:test";
import { loadConfig, parseDotenv } from "../src/config";

const full = {
  TWILIO_ACCOUNT_SID: "AC123",
  TWILIO_API_KEY_SID: "SK123",
  TWILIO_API_KEY_SECRET: "secret",
  TWILIO_REGION: "us1",
  DATA_DIR: "/tmp/data",
};

test("loadConfig returns a populated config and derives us1 apiBase", () => {
  const c = loadConfig(full);
  expect(c.accountSid).toBe("AC123");
  expect(c.apiKeySid).toBe("SK123");
  expect(c.apiKeySecret).toBe("secret");
  expect(c.dataDir).toBe("/tmp/data");
  expect(c.apiBase).toBe("https://api.twilio.com");
});

test("dataDir defaults to the current folder when DATA_DIR is absent", () => {
  const { DATA_DIR, ...noDir } = full;
  expect(loadConfig(noDir).dataDir).toBe(process.cwd());
});

test("region defaults to us1 when absent", () => {
  const { TWILIO_REGION, ...noRegion } = full;
  expect(loadConfig(noRegion).apiBase).toBe("https://api.twilio.com");
});

test("non-us1 region produces a regional apiBase", () => {
  const c = loadConfig({ ...full, TWILIO_REGION: "au1" });
  expect(c.apiBase).toBe("https://api.au1.twilio.com");
});

test("missing required keys throw listing every missing key (DATA_DIR is optional)", () => {
  expect(() => loadConfig({})).toThrow(
    /TWILIO_ACCOUNT_SID.*TWILIO_API_KEY_SID.*TWILIO_API_KEY_SECRET/s,
  );
});

test("parseDotenv parses KEY=VALUE, ignores comments and blanks", () => {
  const env = parseDotenv("# comment\n\nA=1\nB = two words \nC=\n");
  expect(env).toEqual({ A: "1", B: "two words", C: "" });
});
