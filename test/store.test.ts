import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, CSV_COLUMNS, type MessageRow } from "../src/store";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "archiver-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function row(over: Partial<MessageRow> = {}): MessageRow {
  const base: Record<string, string> = {};
  for (const c of CSV_COLUMNS) base[c] = "";
  base.sid = "SM1";
  base.body = "hello";
  base.downloaded_at = "2026-06-12T05:00:00.000Z";
  return { ...base, ...over } as MessageRow;
}

test("appendRow writes a monthly file with header once, then appends", () => {
  const s = new Store(dir);
  s.ensureDirs();
  s.appendRow(row({ sid: "SM1" }));
  s.appendRow(row({ sid: "SM2" }));
  const file = join(dir, "messages_2026-06.csv");
  const lines = readFileSync(file, "utf8").trim().split("\n");
  expect(lines[0]).toBe(CSV_COLUMNS.join(","));
  expect(lines).toHaveLength(3); // header + 2 rows
  expect(lines[1].startsWith("SM1,")).toBe(true);
});

test("rows route to the month of downloaded_at", () => {
  const s = new Store(dir);
  s.ensureDirs();
  s.appendRow(row({ sid: "SM1", downloaded_at: "2026-07-01T00:00:00.000Z" }));
  expect(existsSync(join(dir, "messages_2026-07.csv"))).toBe(true);
});

test("CSV values with commas, quotes and newlines are escaped", () => {
  const s = new Store(dir);
  s.ensureDirs();
  s.appendRow(row({ sid: "SM1", body: 'a,b "c"\nd' }));
  const file = join(dir, "messages_2026-06.csv");
  const content = readFileSync(file, "utf8");
  expect(content).toContain('"a,b ""c""\nd"');
});

test("ledger round-trips sids", () => {
  const s = new Store(dir);
  s.ensureDirs();
  expect(s.loadLedger().size).toBe(0);
  s.recordSid("SM1");
  s.recordSid("SM2");
  const reloaded = new Store(dir).loadLedger();
  expect(reloaded.has("SM1")).toBe(true);
  expect(reloaded.has("SM2")).toBe(true);
});

test("writeMedia stores bytes and returns a forward-slash relative path", () => {
  const s = new Store(dir);
  s.ensureDirs();
  const rel = s.writeMedia("MM1", 0, "jpg", new Uint8Array([1, 2, 3]));
  expect(rel).toBe("media/MM1_0.jpg");
  const abs = join(dir, "media", "MM1_0.jpg");
  expect(Array.from(readFileSync(abs))).toEqual([1, 2, 3]);
});
