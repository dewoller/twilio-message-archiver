import type { Config } from "./config";

export interface TwilioMessage {
  sid: string;
  account_sid: string | null;
  messaging_service_sid: string | null;
  direction: string | null;
  from: string | null;
  to: string | null;
  body: string | null;
  status: string;
  num_segments: string | null;
  num_media: string | null;
  price: string | null;
  price_unit: string | null;
  error_code: number | null;
  error_message: string | null;
  date_created: string | null;
  date_sent: string | null;
  date_updated: string | null;
  api_version: string | null;
  subresource_uris: { media?: string };
}

export interface MediaItem { sid: string; contentType: string; uri: string; }

export interface TwilioClient {
  listAllMessages(): Promise<TwilioMessage[]>;
  listMedia(message: TwilioMessage): Promise<MediaItem[]>;
  downloadMedia(item: MediaItem): Promise<{ bytes: Uint8Array; contentType: string }>;
  deleteMessage(sid: string): Promise<"deleted" | "not_found">;
}

const EXT_MAP: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/gif": "gif",
  "video/mp4": "mp4", "audio/mpeg": "mp3", "application/pdf": "pdf", "text/vcard": "vcf",
};

export function extFromContentType(ct: string): string {
  if (!ct) return "bin";
  const key = ct.split(";")[0].trim().toLowerCase();
  if (EXT_MAP[key]) return EXT_MAP[key];
  const sub = key.split("/")[1];
  return sub || "bin";
}

export function createTwilioClient(config: Config, fetchFn: typeof fetch = fetch): TwilioClient {
  const auth = "Basic " + Buffer.from(`${config.apiKeySid}:${config.apiKeySecret}`).toString("base64");
  const headers = { Authorization: auth };

  async function listAllMessages(): Promise<TwilioMessage[]> {
    const messages: TwilioMessage[] = [];
    let url: string | null =
      `${config.apiBase}/2010-04-01/Accounts/${config.accountSid}/Messages.json?PageSize=1000`;
    while (url) {
      const res = await fetchFn(url, { headers });
      if (!res.ok) throw new Error(`list messages failed: ${res.status} ${await res.text()}`);
      const data: any = await res.json();
      messages.push(...(data.messages ?? []));
      url = data.next_page_uri ? `${config.apiBase}${data.next_page_uri}` : null;
    }
    return messages;
  }

  async function listMedia(message: TwilioMessage): Promise<MediaItem[]> {
    const path = message.subresource_uris?.media;
    if (!path) return [];
    const res = await fetchFn(`${config.apiBase}${path}`, { headers });
    if (!res.ok) throw new Error(`list media failed: ${res.status} ${await res.text()}`);
    const data: any = await res.json();
    return (data.media_list ?? []).map((m: any) => ({
      sid: m.sid, contentType: m.content_type, uri: m.uri,
    }));
  }

  async function downloadMedia(item: MediaItem): Promise<{ bytes: Uint8Array; contentType: string }> {
    const url = `${config.apiBase}${item.uri.replace(/\.json$/, "")}`;
    const res = await fetchFn(url, { headers });
    if (!res.ok) throw new Error(`download media failed: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") || item.contentType || "";
    return { bytes, contentType };
  }

  async function deleteMessage(sid: string): Promise<"deleted" | "not_found"> {
    const url = `${config.apiBase}/2010-04-01/Accounts/${config.accountSid}/Messages/${sid}.json`;
    const res = await fetchFn(url, { method: "DELETE", headers });
    if (res.status === 204) return "deleted";
    if (res.status === 404) return "not_found";
    throw new Error(`delete failed for ${sid}: ${res.status} ${await res.text()}`);
  }

  return { listAllMessages, listMedia, downloadMedia, deleteMessage };
}

// One lightweight authenticated call used by the viewer's setup wizard to check
// credentials before writing .env. Fetches the Account resource; never mutates.
export async function verifyCredentials(
  config: Config,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; error?: string }> {
  const auth = "Basic " + Buffer.from(`${config.apiKeySid}:${config.apiKeySecret}`).toString("base64");
  const res = await fetchFn(
    `${config.apiBase}/2010-04-01/Accounts/${config.accountSid}.json`,
    { headers: { Authorization: auth } },
  );
  if (res.ok) return { ok: true };
  if (res.status === 401) return { ok: false, error: "Twilio rejected these credentials (401). Check the API Key SID and Secret." };
  if (res.status === 404) return { ok: false, error: "Account not found (404). Check the Account SID." };
  return { ok: false, error: `Twilio returned ${res.status}.` };
}
