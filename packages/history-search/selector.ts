import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Input, matchesKey, truncateToWidth, visibleWidth, type Component, type Focusable, type TUI } from "@earendil-works/pi-tui";
import type { Config, Scope } from "./config.ts";
import { type Match, type SearchService, displayText } from "./search.ts";

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
  private readonly config: Config;
  private scope: Scope;
  private readonly search: SearchService;
  private requestId = 0;
  private loading = true;
  private disposed = false;
  private warning?: string;
  private results: Match[] = [];
  private total = 0;
  private offset = 0;
  private selected = 0;
  private pageSize = 1;

  constructor(tui: SelectorTui, theme: SelectorTheme, keys: SelectorKeys,
    done: (value: string | undefined) => void, search: SearchService, config: Config) {
    this.tui = tui;
    this.theme = theme;
    this.keys = keys;
    this.done = done;
    this.config = config;
    this.scope = config.scope;
    this.search = search;
    this.refresh();
  }

  get focused(): boolean { return this.input.focused; }
  set focused(value: boolean) { this.input.focused = value; }
  invalidate(): void { this.input.invalidate(); }

  private refresh(reset = true): void {
    const id = ++this.requestId;
    this.loading = true;
    // Keep the last completed page on screen until its replacement arrives.
    void this.search.search(this.input.getValue(), this.scope, reset ? 0 : Math.max(0, this.selected - 50)).then((result) => {
      if (this.disposed || id !== this.requestId || !result) return;
      this.results = result.matches;
      if (reset) this.selected = 0;
      this.total = result.total;
      this.offset = result.offset;
      this.warning = result.warning;
      this.loading = false;
      this.tui.requestRender();
    }).catch(() => {
      if (this.disposed || id !== this.requestId) return;
      this.results = [];
      this.total = 0;
      this.offset = 0;
      this.selected = 0;
      this.loading = false;
      this.warning = "History search failed. Close and reopen the selector.";
      this.tui.requestRender();
    });
  }

  private move(delta: number): void {
    if (this.loading) return;
    this.selected = Math.max(0, Math.min(this.total - 1, this.selected + delta));
    if (this.total && (this.selected < this.offset || this.selected >= this.offset + this.results.length)) this.refresh(false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.search.dispose();
  }

  handleInput(data: string): void {
    if (this.disposed) return;
    if (this.keys.matches(data, "tui.select.cancel")) { this.dispose(); this.done(undefined); return; }
    if (this.keys.matches(data, "tui.select.confirm")) {
      const result = this.results[this.selected - this.offset];
      if (!this.loading && result) { this.dispose(); this.done(result.item.text); }
      return;
    }
    if (matchesKey(data, this.config.cycleScope)) {
      this.scope = SCOPES[(SCOPES.indexOf(this.scope) + 1) % SCOPES.length];
      this.refresh();
    } else if (matchesKey(data, this.config.older) || this.keys.matches(data, "tui.select.down")) {
      this.move(1);
    } else if (matchesKey(data, this.config.newer) || this.keys.matches(data, "tui.select.up")) {
      this.move(-1);
    } else if (this.keys.matches(data, "tui.select.pageDown")) {
      this.move(this.pageSize);
    } else if (this.keys.matches(data, "tui.select.pageUp")) {
      this.move(-this.pageSize);
    } else {
      const before = this.input.getValue();
      this.input.handleInput(data);
      if (before !== this.input.getValue()) {
        this.refresh();
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
    const title = truncateToWidth(` history: ${this.scope} (${this.total}) `, inner, "…");
    const lines = [th.fg("border", "╭") + th.fg("accent", title) + th.fg("border", "─".repeat(Math.max(0, inner - visibleWidth(title))) + "╮")];
    lines.push(row(this.input.render(inner)[0] ?? ""));
    const start = Math.max(this.offset, this.selected - this.pageSize + 1);
    for (let i = 0; i < this.pageSize; i++) {
      const match = this.results[start + i - this.offset];
      if (!match) { lines.push(row(i === 0 && !this.loading ? th.fg("muted", " No matching history") : "")); continue; }
      let label = "";
      // Fzf positions are UTF-16 indices. Style whole graphemes, not surrogate halves.
      for (const { segment, index } of segmenter.segment(truncateToWidth(match.item.label, Math.max(1, inner - 2), "…"))) {
        const hit = Array.from({ length: segment.length }, (_, j) => index + j).some((j) => match.positions.has(j));
        label += hit ? th.fg("accent", th.bold(segment)) : segment;
      }
      const text = `${start + i === this.selected ? "→ " : "  "}${label}`;
      lines.push(row(start + i === this.selected ? th.bg("selectedBg", text) : text));
    }
    const selected = this.results[this.selected - this.offset]?.item;
    if (this.warning) lines.push(row(th.fg("warning", ` ${this.warning}`)));
    else if (width >= 60 && selected) lines.push(row(th.fg("dim", ` ${selected.timestamp.slice(0, 16)} ${displayText(selected.cwd)}${selected.source === "agentsview" ? " [AgentsView]" : selected.source === "branch" ? " [transcript]" : ""}`)));
    else lines.push(row(""));
    const confirm = this.keys.getKeys("tui.select.confirm").join("/");
    const cancel = this.keys.getKeys("tui.select.cancel").join("/");
    lines.push(row(th.fg("dim", ` ${this.config.older}/${this.config.newer} cycle · ${this.config.cycleScope} scope · ${confirm} use · ${cancel} cancel`)));
    lines.push(th.fg("border", `╰${"─".repeat(inner)}╯`));
    return lines;
  }
}
