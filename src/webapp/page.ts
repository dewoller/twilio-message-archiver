const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Twilio Message Viewer</title>
<style>
  body { font: 14px system-ui, sans-serif; margin: 0; padding: 1rem; }
  header { display: flex; align-items: center; gap: 1rem; margin-bottom: .75rem; }
  h1 { font-size: 1.1rem; margin: 0; }
  #delete-btn { padding: .4rem .8rem; }
  #status { color: #555; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid #ddd; padding: .35rem .5rem; text-align: left; vertical-align: top; }
  td.body { max-width: 36rem; white-space: pre-wrap; word-break: break-word; }
  .banner { background: #fde2e2; color: #7a1f1f; padding: .5rem .75rem; border-radius: 4px; margin-bottom: .75rem; }
  .hidden { display: none; }
</style>
</head>
<body>
<header>
  <h1>Twilio Message Viewer</h1>
  <button id="delete-btn">Archive + delete selected</button>
  <span id="status"></span>
</header>
<div id="error" class="banner hidden"></div>
<table>
  <thead>
    <tr>
      <th><input type="checkbox" id="select-all" /></th>
      <th>From</th><th>To</th><th>Status</th><th>Direction</th><th>Date sent</th><th>Media</th><th>Body</th>
    </tr>
  </thead>
  <tbody id="messages"></tbody>
</table>
<script>
const TOKEN = "__VIEWER_TOKEN__";
const H = { "X-Viewer-Token": TOKEN };
const $ = (id) => document.getElementById(id);
function showError(msg) { const e = $("error"); e.textContent = msg; e.classList.remove("hidden"); }
function clearError() { $("error").classList.add("hidden"); }
function esc(s) { return (s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

async function load() {
  clearError();
  $("status").textContent = "Loading…";
  try {
    const res = await fetch("/api/messages", { headers: H });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    render(data.messages || []);
    $("status").textContent = (data.messages || []).length + " message(s)";
  } catch (e) {
    showError("Failed to load messages: " + e.message);
    $("status").textContent = "";
  }
}
function render(messages) {
  const tbody = $("messages");
  tbody.innerHTML = "";
  for (const m of messages) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      '<td><input type="checkbox" class="row" value="' + esc(m.sid) + '" /></td>' +
      "<td>" + esc(m.from) + "</td><td>" + esc(m.to) + "</td>" +
      "<td>" + esc(m.status) + "</td><td>" + esc(m.direction) + "</td>" +
      "<td>" + esc(m.date_sent) + "</td><td>" + esc(String(m.num_media)) + "</td>" +
      '<td class="body">' + esc(m.body) + "</td>";
    tbody.appendChild(tr);
  }
  $("select-all").checked = false;
}
$("select-all").addEventListener("change", (e) => {
  document.querySelectorAll("input.row").forEach((c) => { c.checked = e.target.checked; });
});
$("delete-btn").addEventListener("click", async () => {
  const sids = [...document.querySelectorAll("input.row:checked")].map((c) => c.value);
  if (sids.length === 0) { showError("Select at least one message first."); return; }
  if (!confirm("Archive and delete " + sids.length + " message(s)? This removes them from Twilio.")) return;
  clearError();
  $("delete-btn").disabled = true;
  $("status").textContent = "Archiving + deleting…";
  try {
    const res = await fetch("/api/delete", {
      method: "POST", headers: { ...H, "content-type": "application/json" },
      body: JSON.stringify({ sids }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const s = await res.json();
    $("status").textContent = "Deleted " + s.deleted + ", failed " + s.failed;
    if (s.failed > 0) showError(s.failed + " message(s) could not be deleted; see status.");
  } catch (e) {
    showError("Delete failed: " + e.message);
  } finally {
    $("delete-btn").disabled = false;
    await load();
  }
});
load();
</script>
</body>
</html>`;

export function renderIndex(token: string): string {
  return PAGE.replaceAll("__VIEWER_TOKEN__", token);
}

const SETUP_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Twilio Message Viewer — setup</title>
<style>
  body{font:14px system-ui,sans-serif;margin:2rem;max-width:34rem}
  label{display:block;margin:.75rem 0 .2rem;font-weight:600}
  input{width:100%;padding:.4rem;box-sizing:border-box}
  details{margin:1rem 0}
  button{margin-top:1rem;padding:.5rem 1rem}
  .banner{background:#fde2e2;color:#7a1f1f;padding:.5rem .75rem;border-radius:4px;margin-bottom:.75rem}
  .hidden{display:none}
  small{color:#555;font-weight:400}
</style></head><body>
<h1>Set up the Twilio Message Viewer</h1>
<p>Enter your Twilio API key. The viewer checks it with Twilio, saves it to a
local <code>.env</code> file, and then loads your messages.</p>
<p>All three values are on one Twilio page —
<a href="https://console.twilio.com/us1/account/keys-credentials/api-keys" target="_blank" rel="noopener">API keys &amp; tokens</a>:
your <strong>Account SID</strong> is at the top, and <strong>Create API key</strong>
shows the <strong>API Key SID</strong> and <strong>Secret</strong> (the secret is
shown only once — copy it now).</p>
<div id="error" class="banner hidden"></div>
<label>Account SID</label>
<input id="accountSid" value="__ACCOUNT_SID__" />
<label>API Key SID</label>
<input id="apiKeySid" placeholder="SK…" />
<label>API Key Secret</label>
<input id="apiKeySecret" type="password" placeholder="your API key secret" />
<details><summary>Advanced</summary>
  <label>Region</label>
  <input id="region" value="__REGION__" />
  <label>Data folder <small>(blank = the folder the viewer runs in)</small></label>
  <input id="dataDir" placeholder="current folder" />
</details>
<button id="save">Verify &amp; save</button>
<script>
const TOKEN = "__VIEWER_TOKEN__";
const $ = (id) => document.getElementById(id);
function showError(m){const e=$("error");e.textContent=m;e.classList.remove("hidden");}
$("save").addEventListener("click", async () => {
  $("error").classList.add("hidden");
  $("save").disabled = true;
  $("save").textContent = "Verifying…";
  try {
    const body = {
      accountSid: $("accountSid").value.trim(),
      apiKeySid: $("apiKeySid").value.trim(),
      apiKeySecret: $("apiKeySecret").value.trim(),
      region: $("region").value.trim(),
      dataDir: $("dataDir").value.trim(),
    };
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Viewer-Token": TOKEN },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok && data.ok) { location.reload(); return; }
    showError(data.error || ("HTTP " + res.status));
  } catch (e) { showError("Setup failed: " + e.message); }
  finally { $("save").disabled = false; $("save").textContent = "Verify & save"; }
});
</script>
</body></html>`;

export function renderSetup(token: string, defaults: { accountSid: string; region: string }): string {
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? ""));
  return SETUP_PAGE
    .replaceAll("__VIEWER_TOKEN__", token)
    .replaceAll("__ACCOUNT_SID__", esc(defaults.accountSid))
    .replaceAll("__REGION__", esc(defaults.region));
}
