import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, resolveEnv, readEnvFile } from "../src/cli";

test("parseArgs detects --dry-run", () => {
  expect(parseArgs(["--dry-run"]).dryRun).toBe(true);
  expect(parseArgs([]).dryRun).toBe(false);
});

test("resolveEnv merges dotenv under process env (process wins)", () => {
  const merged = resolveEnv("A=fromfile\nB=fromfile", { B: "fromproc" });
  expect(merged.A).toBe("fromfile");
  expect(merged.B).toBe("fromproc");
});

test("readEnvFile reads VIEWER_ENV_PATH when set", () => {
  const dir = mkdtempSync(join(tmpdir(), "envpath-"));
  const p = join(dir, ".env");
  writeFileSync(p, "TWILIO_ACCOUNT_SID=ACtest\n");
  const prev = process.env.VIEWER_ENV_PATH;
  process.env.VIEWER_ENV_PATH = p;
  try { expect(readEnvFile()).toContain("ACtest"); }
  finally {
    if (prev === undefined) delete process.env.VIEWER_ENV_PATH; else process.env.VIEWER_ENV_PATH = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
