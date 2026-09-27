# History search

Fzf-powered prompt history inside Pi's TUI. Requires Pi 0.87.1 or newer; no model, API key, or external `fzf` binary is needed. The standalone Pi binary needs Node 22.19+ on PATH for background search and AgentsView access.

Included in the repository's Pi package. Run `/reload` after installing or updating it.

## Use

- **Ctrl+R** or `/history-search`: open with an empty query, newest first.
- Type to fuzzy-search. Matching characters are highlighted.
- **Up/Down**: select; **Ctrl+R/Ctrl+S**: older/newer result (in ranked order).
- **Tab**: cycle directory, session, global scope. The query is preserved.
- **Enter**: replace the entire draft with the original prompt, including whitespace and newlines. Nothing is submitted.
- **Escape/Ctrl+C**: cancel without changing the draft.
- `/history-search global`, `/history-search directory`, `/history-search session`: choose a starting scope.
- `/history-search-clear`: confirm deletion of this extension's stored history across all directories and sessions.

Directory scope means exact normalized working directory, not Git repository root. `/repo` and `/repo/src` are separate scopes. Scope filtering happens before exact-text deduplication. Empty queries use recency; nonempty queries use fzf scores with recency breaking ties.

Normal selection, confirmation, cancellation, and page navigation respect Pi's `tui.select.*` keybindings. The overlay propagates focus to Pi's Input component for IME placement. It can open while the agent is streaming; choosing a prompt only changes the composer. If another action changed the draft while history was loading, selection is not applied.

## Existing history from AgentsView

By default, search also reads Pi user messages from AgentsView's existing SQLite archive. No new persistent index is built, no Pi JSONL files are scanned, and no imported text is copied into this extension's history file. Other agents, assistant messages, tool results, system messages, and deleted sessions are excluded. Archived sessions whose source files are gone remain searchable.

The default path is `$AGENTSVIEW_DATA_DIR/sessions.db`, or `~/.agentsview/sessions.db` when that variable is unset. Override `agentsViewDatabase` or set `agentsView: false` to disable this source. Relative overrides resolve from Pi's agent directory; `~/` is supported.

The adapter was verified against AgentsView 0.44.0. It opens SQLite **read-only**, uses existing indexes, and never migrates the schema, triggers sync, starts the daemon, or accesses its authentication token. Missing/locked/incompatible databases leave raw history and branch fallback available, with a status warning. Unknown message metadata is skipped with a warning. The archive read is limited to the newest 100,000 matching message rows and 64 MiB of text, with a warning if limited; raw retention settings are separate.

Each selector opening starts one temporary Node process. It loads the archive and performs normalization, deduplication, and fuzzy matching outside Pi's UI thread. Only 100 results at a time are sent to the selector; navigation fetches further pages without limiting the searchable result count. Typing replaces pending queries, stale replies cannot replace newer results, and Enter is disabled until the requested results arrive. Closing the selector terminates the process and releases its memory. If that process cannot run, local raw/branch search remains available in Pi with a warning.

Reopen search to see changes indexed since it was opened. AgentsView itself must be syncing to ingest newer historical sessions; this extension does not keep its archive fresh. Its already-indexed history works even while the daemon is stopped. Raw capture supplies recent prompts immediately.

Imported results are labeled `[AgentsView]`. Exact duplicate text prefers raw capture. Archived text can contain expanded skills/templates or extension-generated user messages; the original typed input cannot always be recovered. For the active session, archive messages at/after the known branch capture marker are excluded, like branch fallback. Other sessions have no such marker available through AgentsView, so nonidentical expanded copies may appear separately.

## Privacy and storage

**Raw prompts are saved in plaintext and may contain secrets.** This extension cannot reliably detect credentials. Disable capture before submitting sensitive text; Pi's own session logs are separate and may still record it.

Files live under `getAgentDir()` (normally `~/.pi/agent`):

```text
history-search/config.json
history-search/history.jsonl
```

The directory is mode `0700` and history files are `0600` on platforms supporting these permissions. Images, assistant messages, tool results, RPC input, and extension-injected input are not captured. Prompts intercepted before this extension's input handler cannot be captured.

Default retention is 10,000 records and 10 MiB. A serialized record over 64 KiB (or `maxBytes`, if smaller) is skipped with a warning. Writes are queued outside prompt submission, serialized across processes with `proper-lockfile`, and pruned through atomic rename. Corrupt/torn rows are skipped; reads only load a bounded file tail. Storage errors never prevent prompt submission and produce at most one capture/storage warning per extension load. Abrupt process termination can lose queued history.

`/history-search-clear` only clears this extension's file. It does not delete Pi session logs or AgentsView's archive, so archived prompts may still appear. It does not stop other running sessions from recording new prompts and is not secure erasure. To stop future raw capture, set `capture: false` and `/reload` each running Pi session. To hide AgentsView history too, also set `agentsView: false`; this does not change what AgentsView itself records.

## Configuration

Create `history-search/config.json` in the agent directory; all fields are optional:

```json
{
  "capture": true,
  "agentsView": true,
  "agentsViewDatabase": "",
  "scope": "directory",
  "shortcut": "ctrl+r",
  "older": "ctrl+r",
  "newer": "ctrl+s",
  "cycleScope": "tab",
  "maxEntries": 10000,
  "maxBytes": 10485760,
  "maxVisible": 12
}
```

Run `/reload` after edits. Invalid fields fall back to defaults with a warning. Limits must be positive integers: at most 100,000 entries, 100 MiB, and 50 visible results. Choose distinct overlay shortcuts that do not conflict with confirmation/cancellation or normal text editing. Changing `shortcut` does not implicitly change `older`.

## Transcript fallback and limitations

Before any raw history exists, the current branch's older user messages are available as transient `[transcript]` results. They may contain expanded skill/template text. They are never copied into the history file.

A content-free session entry marks where this extension started observing the branch. Only transcript messages before that marker are used as fallback, preventing raw `/skill:name` and its expanded transcript from appearing twice. The marker survives reload/resume; tree branches get their own marker when needed. This intentionally excludes subsequent transcript-only messages, including those whose raw capture failed, was disabled, or was pruned. Older sessions are searchable through AgentsView when available; without it, only this branch and captured raw history are searched.

Built-in and extension commands are dispatched before the input event and are not captured. Skills/templates reaching the input event are captured before expansion, unless an earlier extension transformed them. Bash (`!`/`!!`) capture is not included.

Pi currently reports a nonfatal Ctrl+R shortcut conflict with session rename. History search owns Ctrl+R in the main editor; rename still works inside `/resume`. Configure a different shortcut to avoid the diagnostic.

## Development

From the repository root:

```bash
npm install --ignore-scripts
npm run check
npm run test:history-search
```

Tests cover storage limits/corruption/locking, concurrent processes, read-only archive access and schema fallback, paginated worker searches, stale-query suppression, filtering and matching, selector focus and keys, and loading through Pi's real extension loader. They use temporary databases and no provider APIs.
