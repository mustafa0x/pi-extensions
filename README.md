# pi-extensions

Pi extensions for Luna-powered session compaction and conversation summaries.

## Requirements

- Pi 0.85.1 or newer
- `openai-codex/gpt-5.6-luna` in `pi --list-models luna`
- An authenticated `openai-codex` provider (`/login openai-codex`)

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

### Luna conversation summary

Generate a structured summary without compacting or changing the active session model:

```text
/summarize-luna
```

Optional instructions can focus the result:

```text
/summarize-luna Focus on decisions, unresolved problems, and next steps
```

The summary is saved as a durable session entry. In its modal:

- `c` copies the summary
- `Enter` or `Esc` closes the modal

Reopen or copy the latest summary in the current session:

```text
/summary-luna-show
/summary-luna-copy
```

## Configuration

Both extensions default to `openai-codex/gpt-5.6-luna`. Override either command when starting Pi:

| Command | Flags | Environment |
| --- | --- | --- |
| `/compact-luna` | `--compact-luna-provider`, `--compact-luna-model` | `PI_COMPACT_LUNA_PROVIDER`, `PI_COMPACT_LUNA_MODEL` |
| `/summarize-luna` | `--summarize-luna-provider`, `--summarize-luna-model` | `PI_SUMMARIZE_LUNA_PROVIDER`, `PI_SUMMARIZE_LUNA_MODEL` |

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
