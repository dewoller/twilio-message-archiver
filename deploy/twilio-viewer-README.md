# Twilio Message Viewer

A standalone GUI to browse the messages currently in the Twilio account and
bulk-delete them. Each selected message is archived to CSV/media (same format
and folder as the auto-archiver) **before** it is deleted, so nothing is lost.
It complements the unattended archiver — use it for occasional manual cleanup.

## Run

1. Put the binary (`twilio-viewer.exe` on Windows, `twilio-viewer` on macOS)
   somewhere convenient — on Windows it can sit in `C:\LAMP\twilio-archiver\`
   next to the archiver's `.env`.
2. Double-click it. It starts a local server on `http://127.0.0.1:8787` and
   opens your browser. (Set `VIEWER_PORT` to override the port.)
3. **First run — setup screen.** If there is no `.env` yet, the viewer shows a
   short setup form. Paste your **API Key SID** and **API Key Secret** (the
   Account SID is pre-filled; Region and an optional data folder are under
   *Advanced*), then click **Verify & save**. The viewer checks the key with
   Twilio, writes the `.env` beside the program, and loads your messages — no
   restart. You can still create `.env` by hand from `.env.template` if you
   prefer.
4. Tick the messages to remove (or the header checkbox to select all) and click
   **Archive + delete selected**. Confirm the count. The list refreshes when done.

## Notes

- The server listens on loopback only and rejects requests without the
  per-launch token, so it is not reachable from other machines.
- Archived CSVs land in `DATA_DIR` (or the folder the program runs in), shared
  with the auto-archiver via the `processed_sids.log` ledger.
- Close the program (Ctrl-C in its console, or close the window) to stop it.
