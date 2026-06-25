import { test, expect } from "bun:test";
import { buildEnvFile, envFilePath, DEFAULT_ACCOUNT_SID } from "../src/setup";
import { parseDotenv } from "../src/config";

test("buildEnvFile round-trips through parseDotenv without DATA_DIR", () => {
  const v = { accountSid: "AC9", apiKeySid: "SK1", apiKeySecret: "sec", region: "us1" };
  const parsed = parseDotenv(buildEnvFile(v));
  expect(parsed.TWILIO_ACCOUNT_SID).toBe("AC9");
  expect(parsed.TWILIO_API_KEY_SID).toBe("SK1");
  expect(parsed.TWILIO_API_KEY_SECRET).toBe("sec");
  expect(parsed.TWILIO_REGION).toBe("us1");
  expect(parsed.DATA_DIR).toBeUndefined();
});

test("buildEnvFile includes DATA_DIR only when supplied", () => {
  const parsed = parseDotenv(buildEnvFile({
    accountSid: "AC9", apiKeySid: "SK1", apiKeySecret: "sec", region: "us1", dataDir: "/tmp/x",
  }));
  expect(parsed.DATA_DIR).toBe("/tmp/x");
});

test("envFilePath honours VIEWER_ENV_PATH override", () => {
  const prev = process.env.VIEWER_ENV_PATH;
  process.env.VIEWER_ENV_PATH = "/tmp/custom/.env";
  try { expect(envFilePath()).toBe("/tmp/custom/.env"); }
  finally { if (prev === undefined) delete process.env.VIEWER_ENV_PATH; else process.env.VIEWER_ENV_PATH = prev; }
});

test("DEFAULT_ACCOUNT_SID looks like a Twilio account sid", () => {
  expect(DEFAULT_ACCOUNT_SID).toMatch(/^AC[0-9a-f]{32}$/);
});
