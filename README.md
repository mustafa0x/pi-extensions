# pi-extensions

Pi extensions for fuzzy prompt-history search, Luna-powered session compaction, and readable conversation recaps.

## Requirements

- Pi 0.87.1 or newer
- For the Luna extensions only: `openai-codex/gpt-5.6-luna` in `pi --list-models luna` and an authenticated `openai-codex` provider (`/login openai-codex`)
- History search needs no model or API key.

## Install

Install the repository without a tag or commit so Pi can update it from the default branch:

```bash
pi install git:github.com/mustafa0x/pi-extensions
```

Restart Pi, or run `/reload` in an existing session.

Review extensions before installing them. Pi extensions execute with your user account's permissions.

## Update

```bash
pi update --extensions
```

The unpinned git source follows the repository's default branch. Installing with a suffix such as `@v1.0.0` pins the package; pinned refs are reconciled but do not advance during normal package updates.

Use `pi list` to inspect installed packages and `pi config` to enable or disable individual extensions.

## Extensions

### Prompt history search

Press **Ctrl+R** or run `/history-search` to search previous prompts. Enter restores the selected prompt into the draft without submitting; Escape cancels. Tab cycles directory/session/global scope.

**Raw prompts are stored in plaintext and can contain secrets.** Set `capture: false` in `~/.pi/agent/history-search/config.json` to disable capture, then `/reload`. `/history-search-clear` clears the extension's history after confirmation, but does not delete Pi transcripts.

See [history search](packages/history-search/README.md) for configuration, storage limits, and transcript fallback behavior. Pi may show a nonfatal Ctrl+R conflict with the session-selector rename binding.

### Luna compaction

Manually compact the current session with `openai-codex/gpt-5.6-luna` at `xhigh` reasoning:

```text
/compact-luna
```

Optional instructions are forwarded to Pi's compaction summarizer:

```text
/compact-luna Preserve implementation details and unresolved errors
```

This uses Pi's normal compaction boundaries and structured format without changing the active session model. Automatic compaction remains unchanged.

### Luna conversation recap

Create a concise list of what was done in the session without compacting or changing the active session model:

```text
/recap-luna
```

Optional instructions can focus the result:

```text
/recap-luna Focus on decisions, unresolved problems, and next steps
```

The recap contains concise action/result bullets covering changes, diagnoses, decisions, tests, deployments, and remaining work. It omits introductions, conclusions, repeated background, and unnecessary bookkeeping.

The recap is saved as a durable session entry. In its modal:

- `c` copies the recap
- `Enter` or `Esc` closes the modal

Reopen or copy the latest recap in the current session:

```text
/recap-luna-show
/recap-luna-copy
```

## Configuration

Both Luna extensions default to `openai-codex/gpt-5.6-luna`. Override either command when starting Pi:

| Command | Flags | Environment |
| --- | --- | --- |
| `/compact-luna` | `--compact-luna-provider`, `--compact-luna-model` | `PI_COMPACT_LUNA_PROVIDER`, `PI_COMPACT_LUNA_MODEL` |
| `/recap-luna` | `--recap-luna-provider`, `--recap-luna-model` | `PI_RECAP_LUNA_PROVIDER`, `PI_RECAP_LUNA_MODEL` |

Flags take precedence over environment variables.

## Remove

```bash
pi remove git:github.com/mustafa0x/pi-extensions
```

Restart Pi or run `/reload` afterward.

## Troubleshooting

### Luna is unavailable

```bash
pi --list-models luna
```

### Authentication fails

Run `/login openai-codex` and authenticate again.

### Nothing can be compacted

Pi keeps recent context according to its compaction settings. `/compact-luna` reports that there is nothing to compact when the session is smaller than that retained-context budget.

## License

MIT
