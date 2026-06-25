import { CSV_COLUMNS, Store, type MessageRow } from "./store";
import { extFromContentType, type TwilioClient, type TwilioMessage } from "./twilio";

export interface ArchiveResult {
  fetched: number; terminal: number; archived: number; deleted: number;
  skippedInflight: number; skippedDuplicate: number; skippedMediaError: number;
}

const TERMINAL = new Set(["delivered", "failed", "undelivered", "received", "read", "sent"]);

export function toRow(m: TwilioMessage, mediaRel: string[], now: Date): MessageRow {
  const s = (v: string | null | undefined) => (v == null ? "" : String(v));
  const row: MessageRow = Object.fromEntries(CSV_COLUMNS.map((c) => [c, ""])) as MessageRow;
  row.sid = s(m.sid);
  row.account_sid = s(m.account_sid);
  row.messaging_service_sid = s(m.messaging_service_sid);
  row.direction = s(m.direction);
  row.from = s(m.from);
  row.to = s(m.to);
  row.body = s(m.body);
  row.status = s(m.status);
  row.num_segments = s(m.num_segments);
  row.num_media = s(m.num_media);
  row.media_files = mediaRel.join(";");
  row.price = s(m.price);
  row.price_unit = s(m.price_unit);
  row.error_code = m.error_code == null ? "" : String(m.error_code);
  row.error_message = s(m.error_message);
  row.date_created = s(m.date_created);
  row.date_sent = s(m.date_sent);
  row.date_updated = s(m.date_updated);
  row.api_version = s(m.api_version);
  row.downloaded_at = now.toISOString();
  return row;
}

export type ArchiveOutcome = "archived" | "media-error";

export async function archiveAndDeleteMessage(
  client: TwilioClient,
  store: Store,
  m: TwilioMessage,
  now: Date,
  log: (s: string) => void,
): Promise<{ outcome: ArchiveOutcome; deleted: boolean }> {
  let mediaRel: string[] = [];
  try {
    if (Number(m.num_media ?? "0") > 0) {
      const items = await client.listMedia(m);
      for (let i = 0; i < items.length; i++) {
        const { bytes, contentType } = await client.downloadMedia(items[i]);
        mediaRel.push(store.writeMedia(m.sid, i, extFromContentType(contentType), bytes));
      }
    }
  } catch (e) {
    log(`WARN media download failed for ${m.sid}: ${e}; skipping (will retry)`);
    return { outcome: "media-error", deleted: false };
  }
  // Crash-safety: write the CSV row + ledger entry BEFORE deleting from Twilio so
  // a crash never loses data. Known accepted trade-off: a crash in the tiny window
  // between appendRow and recordSid would re-archive the message next run (a
  // duplicate CSV row), since it's still on Twilio and not yet in the ledger. This
  // is preferred over the alternative (delete-before-record), which could lose data.
  store.appendRow(toRow(m, mediaRel, now));
  store.recordSid(m.sid);
  const outcome = await client.deleteMessage(m.sid);
  return { outcome: "archived", deleted: outcome === "deleted" || outcome === "not_found" };
}

export interface DeleteItemResult { sid: string; archived: boolean; deleted: boolean; error?: string; }
export interface DeleteSummary { results: DeleteItemResult[]; archived: number; deleted: number; failed: number; }

export async function archiveAndDeleteSelected(
  client: TwilioClient,
  store: Store,
  sids: string[],
  opts: { now: () => Date; log: (m: string) => void },
): Promise<DeleteSummary> {
  const ledger = store.loadLedger();
  const all = await client.listAllMessages();
  const bySid = new Map(all.map((m) => [m.sid, m]));
  const results: DeleteItemResult[] = [];

  for (const sid of sids) {
    const m = bySid.get(sid);
    if (!m) { results.push({ sid, archived: false, deleted: true }); continue; }

    if (ledger.has(sid)) {
      try {
        const outcome = await client.deleteMessage(sid);
        results.push({ sid, archived: false, deleted: outcome === "deleted" || outcome === "not_found" });
      } catch (e) {
        results.push({ sid, archived: false, deleted: false, error: String(e) });
      }
      continue;
    }

    try {
      const res = await archiveAndDeleteMessage(client, store, m, opts.now(), opts.log);
      if (res.outcome === "media-error") {
        results.push({ sid, archived: false, deleted: false, error: "media download failed" });
      } else {
        ledger.add(sid);
        results.push({ sid, archived: true, deleted: res.deleted });
      }
    } catch (e) {
      results.push({ sid, archived: false, deleted: false, error: String(e) });
    }
  }

  const summary: DeleteSummary = {
    results,
    archived: results.filter((r) => r.archived).length,
    deleted: results.filter((r) => r.deleted).length,
    failed: results.filter((r) => !r.deleted).length,
  };
  opts.log(`bulk: requested=${sids.length} archived=${summary.archived} deleted=${summary.deleted} failed=${summary.failed}`);
  return summary;
}

export async function archive(
  client: TwilioClient,
  store: Store,
  opts: { dryRun: boolean; now: () => Date; log: (m: string) => void },
): Promise<ArchiveResult> {
  const r: ArchiveResult = {
    fetched: 0, terminal: 0, archived: 0, deleted: 0,
    skippedInflight: 0, skippedDuplicate: 0, skippedMediaError: 0,
  };
  const ledger = store.loadLedger();
  const messages = await client.listAllMessages();
  r.fetched = messages.length;

  for (const m of messages) {
    if (!TERMINAL.has(m.status)) { r.skippedInflight++; continue; }
    r.terminal++;
    if (ledger.has(m.sid)) { r.skippedDuplicate++; continue; }

    if (opts.dryRun) {
      opts.log(`DRYRUN would archive+delete ${m.sid} (${m.direction}, ${m.status}, media=${m.num_media})`);
      r.archived++;
      continue;
    }

    const res = await archiveAndDeleteMessage(client, store, m, opts.now(), opts.log);
    if (res.outcome === "media-error") { r.skippedMediaError++; continue; }
    ledger.add(m.sid);
    r.archived++;
    if (res.deleted) r.deleted++;
  }

  opts.log(
    `${opts.dryRun ? "[dry-run] " : ""}fetched=${r.fetched} terminal=${r.terminal} ` +
    `archived=${r.archived} deleted=${r.deleted} inflight=${r.skippedInflight} ` +
    `dup=${r.skippedDuplicate} mediaErr=${r.skippedMediaError}`,
  );
  return r;
}
