export interface Config {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  region: string;
  dataDir: string;
  apiBase: string;
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env): Config {
  const region = (env.TWILIO_REGION ?? "us1").trim() || "us1";
  const required = {
    TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
    TWILIO_API_KEY_SID: env.TWILIO_API_KEY_SID,
    TWILIO_API_KEY_SECRET: env.TWILIO_API_KEY_SECRET,
  };
  const missing = Object.entries(required)
    .filter(([, v]) => !v || !v.trim())
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
  // DATA_DIR is optional: default to the current working directory (the folder
  // the tool runs in — e.g. the Task Scheduler "Start in" directory).
  const dataDir = (env.DATA_DIR && env.DATA_DIR.trim()) || process.cwd();
  const apiBase =
    region === "us1"
      ? "https://api.twilio.com"
      : `https://api.${region}.twilio.com`;
  return {
    accountSid: required.TWILIO_ACCOUNT_SID!.trim(),
    apiKeySid: required.TWILIO_API_KEY_SID!.trim(),
    apiKeySecret: required.TWILIO_API_KEY_SECRET!.trim(),
    region,
    dataDir,
    apiBase,
  };
}

export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}
