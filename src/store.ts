import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CSV_COLUMNS = [
  "sid", "account_sid", "messaging_service_sid", "direction", "from", "to",
  "body", "status", "num_segments", "num_media", "media_files", "price",
  "price_unit", "error_code", "error_message", "date_created", "date_sent",
  "date_updated", "api_version", "downloaded_at",
] as const;

export type MessageRow = Record<(typeof CSV_COLUMNS)[number], string>;

function csvEscape(v: string): string {
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export class Store {
  private readonly mediaDir: string;
  private readonly ledgerPath: string;

  constructor(private readonly dataDir: string) {
    this.mediaDir = join(dataDir, "media");
    this.ledgerPath = join(dataDir, "processed_sids.log");
  }

  ensureDirs(): void {
    mkdirSync(this.dataDir, { recursive: true });
    mkdirSync(this.mediaDir, { recursive: true });
  }

  private monthFile(downloadedAt: string): string {
    const month = downloadedAt.slice(0, 7); // YYYY-MM from ISO string
    return join(this.dataDir, `messages_${month}.csv`);
  }

  appendRow(row: MessageRow): void {
    const file = this.monthFile(row.downloaded_at);
    if (!existsSync(file)) {
      writeFileSync(file, CSV_COLUMNS.join(",") + "\n");
    }
    const line = CSV_COLUMNS.map((c) => csvEscape(row[c] ?? "")).join(",");
    appendFileSync(file, line + "\n");
  }

  loadLedger(): Set<string> {
    if (!existsSync(this.ledgerPath)) return new Set();
    const text = readFileSync(this.ledgerPath, "utf8");
    return new Set(text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  }

  recordSid(sid: string): void {
    appendFileSync(this.ledgerPath, sid + "\n");
  }

  writeMedia(sid: string, index: number, ext: string, bytes: Uint8Array): string {
    const name = `${sid}_${index}.${ext}`;
    writeFileSync(join(this.mediaDir, name), bytes);
    return `media/${name}`;
  }
}
