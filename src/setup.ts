import { dirname, join } from "node:path";

// Placeholder Twilio account SID pre-filled in the setup wizard. It is not a
// secret (an Account SID is an identifier, not a credential), but it is
// deployment-specific, so the public default is a blank-looking placeholder the
// operator overwrites with their own SID. Override it for your own deployment.
export const DEFAULT_ACCOUNT_SID = "AC00000000000000000000000000000000";

export interface SetupValues {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  region: string;
  dataDir?: string;
}

export function buildEnvFile(v: SetupValues): string {
  const lines = [
    "# Written by the Twilio Message Viewer setup wizard. Never commit .env.",
    `TWILIO_ACCOUNT_SID=${v.accountSid}`,
    `TWILIO_API_KEY_SID=${v.apiKeySid}`,
    `TWILIO_API_KEY_SECRET=${v.apiKeySecret}`,
    `TWILIO_REGION=${v.region}`,
  ];
  if (v.dataDir && v.dataDir.trim()) lines.push(`DATA_DIR=${v.dataDir.trim()}`);
  return lines.join("\n") + "\n";
}

// Where the wizard writes .env and where readEnvFile looks first. The
// VIEWER_ENV_PATH override keeps dev runs and tests writable; the default lands
// .env beside the compiled executable (the deployment layout).
export function envFilePath(): string {
  return process.env.VIEWER_ENV_PATH || join(dirname(process.execPath), ".env");
}
