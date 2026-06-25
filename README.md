# Twilio Message Archiver

A standalone tool that periodically downloads all terminal-state Twilio
messages (both directions, including MMS media) to monthly CSV files, then
deletes them from Twilio so the account does not accumulate message history.
It is idempotent (a `processed_sids.log` ledger prevents double-processing) and
ships as a single self-contained executable with no runtime dependencies.

It was built for a research project that runs the archiver every 5 minutes on a
Windows PC, writing into a OneDrive-synced folder so the messages land in
SharePoint — but it works anywhere you have a Twilio account and somewhere to
put the files. A companion browser GUI (the **viewer**) is included for manual,
review-then-delete cleanup.

> **Privacy note:** this tool deletes messages from your Twilio account after
> archiving them. Always run `--dry-run` first and confirm the counts.

## Download

Pre-built binaries are attached to each [GitHub
release](https://github.com/dewoller/twilio-message-archiver/releases):

- `twilio-archiver.exe` (Windows x64) — the unattended archiver
- `twilio-viewer.exe` / `twilio-viewer` — the browser GUI (Windows / macOS)

No install or runtime is required; copy the binary and run it.

## Build from source (macOS/Linux with [Bun](https://bun.sh))

```bash
bun install
bun test           # all tests must pass
bun run build:win  # produces dist/twilio-archiver.exe
```

## Configuration

Create a Twilio **API Key** (SID + Secret) in the Twilio console. Copy
`.env.template` to `.env` next to the executable and fill in your
`TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, and `TWILIO_API_KEY_SECRET`. The
viewer can also write this file for you via its first-run setup screen.

## Deploy as a scheduled task (Windows example)

1. Ensure the **LAMPlongsurvey Documents** library is synced locally
   (OneDrive → the site → "Sync" or "Add shortcut to My files"), so
   `...\LAMPlongsurvey - Documents\Twilio_logs` exists as a real folder.
2. Copy `dist\twilio-archiver.exe` to `C:\LAMP\twilio-archiver\`.
3. Copy `.env.template` to `C:\LAMP\twilio-archiver\.env` and fill in the
   Twilio credentials. **Leave `DATA_DIR` unset** — the tool writes to whatever
   folder it runs in (the task's "Start in" directory). Only set `DATA_DIR` if
   you want to override that.
4. **Test first — this deletes nothing.** Run it *from* the synced folder so the
   data dir resolves there:
   ```cmd
   cd "C:\Users\<user>\RMIT University\LAMPlongsurvey - Documents\Twilio_logs"
   C:\LAMP\twilio-archiver\twilio-archiver.exe --dry-run
   ```
   It prints what it would archive/delete. Confirm the counts look right.
5. Edit `deploy\twilio-archiver.xml` so `<WorkingDirectory>` is your real synced
   `Twilio_logs` path (and `<Command>` is the exe path), then register the task
   (every 5 min, only when logged on so OneDrive is active):
   ```cmd
   schtasks /Create /TN "Twilio Archiver" /XML C:\LAMP\twilio-archiver\deploy\twilio-archiver.xml
   ```
   The task's "Start in" (WorkingDirectory) is the data dir, so CSVs and media
   land in the synced folder and OneDrive uploads them.

## Companion viewer

A browser-based GUI for manual bulk cleanup. It lists live Twilio messages,
lets you tick-and-delete them (archiving each one first), and runs as a
loopback-only server so it is not reachable from other machines. On first run
with no `.env`, it shows a setup screen: paste the API Key SID + Secret (Account
SID pre-filled, Region/data-folder under *Advanced*), and it verifies them with
Twilio, writes `.env` beside the program, and loads your messages — no restart.
See [`deploy/twilio-viewer-README.md`](deploy/twilio-viewer-README.md) for full
run instructions.

Build the viewer binary:

```bash
bun run build:viewer:mac  # → dist/twilio-viewer  (macOS ARM)
bun run build:viewer:win  # → dist/twilio-viewer.exe  (Windows x64)
```

Run it locally (dev):

```bash
bun run start:viewer
```

## Notes

- The PC must be on and signed in (OneDrive running) for uploads. Missed runs
  are harmless — the tool is idempotent and catches up.
- `processed_sids.log` is the idempotency ledger; do not delete it.
- Credentials live only in `.env` (never committed). Rotate the Twilio API key
  if it is ever exposed.

## License

MIT — see [LICENSE](LICENSE).
