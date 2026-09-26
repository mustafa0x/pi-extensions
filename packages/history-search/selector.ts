import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Input, matchesKey, truncateToWidth, visibleWidth, type Component, type Focusable, type TUI } from "@earendil-works/pi-tui";
import type { Config, Scope } from "./config.ts";
import { type Candidate, type Match, candidates, createSearch, displayText } from "./search.ts";

type SelectorTui = Pick<TUI, "requestRender"> & { terminal: { rows: number } };
type SelectorTheme = Pick<Theme, "fg" | "bg" | "bold">;
type SelectorKeys = Pick<KeybindingsManager, "matches" | "getKeys">;

const SCOPES: Scope[] = ["directory", "session", "global"];
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export class HistorySelector implements Component, Focusable {
  private readonly input = new Input();
  private readonly tui: SelectorTui;
  private readonly theme: SelectorTheme;
  private readonly keys: SelectorKeys;
  private readonly done: (value: string | undefined) => void;
  private readonly records: Candidate[];
  private readonly config: Config;
  private readonly cwd: string;
  private readonly sessionId: string;
  private scope: Scope;
  private search: (query: string) => Match[];
  private results: Match[] = [];
  private selected = 0;
  private pageSize = 1;

  constructor(tui: SelectorTui, theme: SelectorTheme, keys: SelectorKeys,
    done: (value: string | undefined) => void, records: Candidate[], config: Config, cwd: string, sessionId: string) {
    this.tui = tui;
    this.theme = theme;
    this.keys = keys;
    this.done = done;
    this.records = records;
    this.config = config;
    this.cwd = cwd;
    this.sessionId = sessionId;
    this.scope = config.scope;
    this.search = createSearch(candidates(records, this.scope, cwd, sessionId));
    this.results = this.search("");
  }

  get focused(): boolean { return this.input.focused; }
  set focused(value: boolean) { this.input.focused = value; }
  invalidate(): void { this.input.invalidate(); }

  handleInput(data: string): void {
    if (this.keys.matches(data, "tui.select.cancel")) { this.done(undefined); return; }
    if (this.keys.matches(data, "tui.select.confirm")) {
      const result = this.results[this.selected];
      if (result) this.done(result.item.text);
      return;
    }
    if (matchesKey(data, this.config.cycleScope)) {
      this.scope = SCOPES[(SCOPES.indexOf(this.scope) + 1) % SCOPES.length];
      this.search = createSearch(candidates(this.records, this.scope, this.cwd, this.sessionId));
      this.results = this.search(this.input.getValue());
      this.selected = 0;
    } else if (matchesKey(data, this.config.older) || this.keys.matches(data, "tui.select.down")) {
      this.selected = Math.min(this.results.length - 1, this.selected + 1);
    } else if (matchesKey(data, this.config.newer) || this.keys.matches(data, "tui.select.up")) {
      this.selected = Math.max(0, this.selected - 1);
    } else if (this.keys.matches(data, "tui.select.pageDown")) {
      this.selected = Math.min(this.results.length - 1, this.selected + this.pageSize);
    } else if (this.keys.matches(data, "tui.select.pageUp")) {
      this.selected = Math.max(0, this.selected - this.pageSize);
    } else {
      const before = this.input.getValue();
      this.input.handleInput(data);
      if (before !== this.input.getValue()) {
        this.results = this.search(this.input.getValue());
        this.selected = 0;
      }
    }
    this.selected = Math.max(0, this.selected);
    this.tui.requestRender();
  }

  render(width: number): string[] {
    if (width < 4) return this.input.render(Math.max(1, width)).map((line) => truncateToWidth(line, width, ""));
    const inner = width - 2;
    const th = this.theme;
    const row = (text: string) => {
      const clipped = truncateToWidth(text, inner, "…");
      return th.fg("border", "│") + clipped + " ".repeat(Math.max(0, inner - visibleWidth(clipped))) + th.fg("border", "│");
    };
    // Fixed height for a given terminal, including empty queries and no matches.
    this.pageSize = Math.max(1, Math.min(this.config.maxVisible, this.tui.terminal.rows - 7));
    const title = truncateToWidth(` history: ${this.scope} (${this.results.length}) `, inner, "…");
    const lines = [th.fg("border", "╭") + th.fg("accent", title) + th.fg("border", "─".repeat(Math.max(0, inner - visibleWidth(title))) + "╮")];
    lines.push(row(this.input.render(inner)[0] ?? ""));
    const start = Math.max(0, this.selected - this.pageSize + 1);
    for (let i = 0; i < this.pageSize; i++) {
      const match = this.results[start + i];
      if (!match) { lines.push(row(i === 0 ? th.fg("muted", " No matching history") : "")); continue; }
      let label = "";
      // Fzf positions are UTF-16 indices. Style whole graphemes, not surrogate halves.
      for (const { segment, index } of segmenter.segment(truncateToWidth(match.item.label, Math.max(1, inner - 2), "…"))) {
        const hit = Array.from({ length: segment.length }, (_, j) => index + j).some((j) => match.positions.has(j));
        label += hit ? th.fg("accent", th.bold(segment)) : segment;
      }
      const text = `${start + i === this.selected ? "→ " : "  "}${label}`;
      lines.push(row(start + i === this.selected ? th.bg("selectedBg", text) : text));
    }
    const selected = this.results[this.selected]?.item;
    if (width >= 60 && selected) lines.push(row(th.fg("dim", ` ${selected.timestamp.slice(0, 16)} ${displayText(selected.cwd)}${selected.source === "branch" ? " [transcript]" : ""}`)));
    else lines.push(row(""));
    const confirm = this.keys.getKeys("tui.select.confirm").join("/");
    const cancel = this.keys.getKeys("tui.select.cancel").join("/");
    lines.push(row(th.fg("dim", ` ${this.config.older}/${this.config.newer} cycle · ${this.config.cycleScope} scope · ${confirm} use · ${cancel} cancel`)));
    lines.push(th.fg("border", `╰${"─".repeat(inner)}╯`));
    return lines;
  }
}
