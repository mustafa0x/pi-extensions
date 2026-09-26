# History search

Fzf-powered prompt history inside Pi's TUI. Requires Pi 0.87.1 or newer; no model, API key, or external `fzf` binary is needed.

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

## Privacy and storage

**Raw prompts are saved in plaintext and may contain secrets.** This extension cannot reliably detect credentials. Disable capture before submitting sensitive text; Pi's own session logs are separate and may still record it.

Files live under `getAgentDir()` (normally `~/.pi/agent`):

```text
history-search/config.json
history-search/history.jsonl
```

The directory is mode `0700` and history files are `0600` on platforms supporting these permissions. Images, assistant messages, tool results, RPC input, and extension-injected input are not captured. Prompts intercepted before this extension's input handler cannot be captured.

Default retention is 10,000 records and 10 MiB. A serialized record over 64 KiB (or `maxBytes`, if smaller) is skipped with a warning. Writes are queued outside prompt submission, serialized across processes with `proper-lockfile`, and pruned through atomic rename. Corrupt/torn rows are skipped; reads only load a bounded file tail. Storage errors never prevent prompt submission and produce at most one capture/storage warning per extension load. Abrupt process termination can lose queued history.

`/history-search-clear` only clears this extension's file. It does not delete Pi session logs or stop other running sessions from recording new prompts. It is not secure erasure. To stop future capture, set `capture: false` and `/reload` each running Pi session.

## Configuration

Create `history-search/config.json` in the agent directory; all fields are optional:

```json
{
  "capture": true,
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

A content-free session entry marks where this extension started observing the branch. Only transcript messages before that marker are used as fallback, preventing raw `/skill:name` and its expanded transcript from appearing twice. The marker survives reload/resume; tree branches get their own marker when needed. This intentionally excludes subsequent transcript-only messages, including those whose raw capture failed, was disabled, or was pruned. It does not import all historical Pi sessions.

Built-in and extension commands are dispatched before the input event and are not captured. Skills/templates reaching the input event are captured before expansion, unless an earlier extension transformed them. Bash (`!`/`!!`) capture is not included.

Pi currently reports a nonfatal Ctrl+R shortcut conflict with session rename. History search owns Ctrl+R in the main editor; rename still works inside `/resume`. Configure a different shortcut to avoid the diagnostic.

## Development

From the repository root:

```bash
npm install --ignore-scripts
npm run check
npm run test:history-search
```

Tests cover storage limits/corruption/locking, concurrent processes, filtering and matching, selector focus and keys, and loading through Pi's real extension loader. They use no provider APIs.
