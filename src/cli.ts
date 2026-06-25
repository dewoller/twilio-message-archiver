import { closeSync, existsSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, parseDotenv } from "./config";
import { createTwilioClient } from "./twilio";
import { Store } from "./store";
import { archive } from "./archive";

export function parseArgs(argv: string[]): { dryRun: boolean } {
  return { dryRun: argv.includes("--dry-run") };
}

export function resolveEnv(dotenvText: string, processEnv: Record<string, string | undefined>) {
  return { ...parseDotenv(dotenvText), ...processEnv };
}

export function readEnvFile(): string {
  // Honour an explicit override (used by the viewer's setup wizard and tests),
  // then look beside the executable (compiled), then the current directory.
  const candidates = [
    ...(process.env.VIEWER_ENV_PATH ? [process.env.VIEWER_ENV_PATH] : []),
    join(dirname(process.execPath), ".env"),
    join(process.cwd(), ".env"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  return "";
}

const LOCK_PATH = join(tmpdir(), "twilio-archiver.lock");
const LOCK_STALE_MS = 15 * 60 * 1000;

function acquireLock(): boolean {
  try {
    const fd = openSync(LOCK_PATH, "wx");
    writeSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch {
    if (existsSync(LOCK_PATH) && Date.now() - statSync(LOCK_PATH).mtimeMs > LOCK_STALE_MS) {
      rmSync(LOCK_PATH, { force: true });
      return acquireLock();
    }
    return false;
  }
}

function releaseLock(): void {
  rmSync(LOCK_PATH, { force: true });
}

export async function main(argv: string[]): Promise<number> {
  const { dryRun } = parseArgs(argv);
  const env = resolveEnv(readEnvFile(), process.env);
  const config = loadConfig(env);

  if (!acquireLock()) {
    console.log("another run is in progress; exiting");
    return 0;
  }
  try {
    const store = new Store(config.dataDir);
    store.ensureDirs();
    const client = createTwilioClient(config);
    await archive(client, store, { dryRun, now: () => new Date(), log: (m) => console.log(m) });
    return 0;
  } finally {
    releaseLock();
  }
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => { console.error(e); process.exit(1); });
}
