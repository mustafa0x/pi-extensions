import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as settle } from "node:timers/promises";
import { CURSOR_MARKER, KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG } from "../config.ts";
import { candidates, createSearch, displayText, type Candidate, type SearchResult, type SearchService } from "../search.ts";
import { HistorySelector } from "../selector.ts";

const theme = { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text };
const records: Candidate[] = ["new\n中文 🧑‍💻", "older", "oldest"].map((text, i) => ({
  version: 1, id: String(i), timestamp: `2026-01-0${3 - i}T00:00:00Z`, text, label: displayText(text), source: "persisted", cwd: "/repo", sessionId: "s",
}));

function setup(config = DEFAULT_CONFIG, keys = new KeybindingsManager(TUI_KEYBINDINGS)) {
  const accepted: (string | undefined)[] = [];
  const tui = { requestRender() {}, terminal: { rows: 24 } };
  const service: SearchService = {
    search: async (query, scope, offset = 0) => {
      const matches = createSearch(candidates(records, scope, "/repo", "s"))(query);
      return { matches: matches.slice(offset, offset + 100), total: matches.length, offset };
    },
    dispose() {},
  };
  const selector = new HistorySelector(tui, theme, keys, (text) => accepted.push(text), service, config);
  return { selector, accepted, tui };
}

test("focus/IME marker, stable heights and narrow/wide Unicode rendering", async () => {
  const { selector, tui } = setup();
  await settle();
  selector.focused = true;
  assert.ok(selector.render(80).some((line) => line.includes(CURSOR_MARKER)));
  for (const rows of [8, 12, 24]) {
    tui.terminal.rows = rows;
    for (const width of [1, 2, 3, 4, 8, 20, 80]) {
      const lines = selector.render(width);
      assert.ok(lines.length <= rows);
      assert.ok(lines.every((line) => visibleWidth(line) <= width), `width ${width}`);
    }
  }
  const height = selector.render(80).length;
  selector.handleInput("no matches");
  await settle();
  assert.equal(selector.render(80).length, height);
  assert.ok(selector.render(80).some((line) => line.includes("No matching history")));
  selector.focused = false;
  assert.ok(selector.render(80).every((line) => !line.includes(CURSOR_MARKER)));
});

test("accept preserves multiline text; cancel and empty results do not accept", async () => {
  const { selector, accepted } = setup();
  await settle();
  selector.handleInput("\r");
  assert.deepEqual(accepted, [records[0].text]);
  for (const key of ["\x1b", "\x03"]) {
    const other = setup();
    other.selector.handleInput(key);
    assert.deepEqual(other.accepted, [undefined]);
  }
  const empty = setup();
  empty.selector.handleInput("unmatchable");
  empty.selector.handleInput("\r");
  assert.deepEqual(empty.accepted, []);
});

test("cycling, page navigation and configurable selection keys", async () => {
  const { selector, accepted } = setup();
  await settle();
  selector.handleInput("\x12"); // Ctrl+R: older
  selector.handleInput("\x12");
  selector.handleInput("\x13"); // Ctrl+S: newer
  selector.handleInput("\r");
  assert.deepEqual(accepted, ["older"]);
  const custom = setup({ ...DEFAULT_CONFIG, older: "alt+j", newer: "alt+k" }, new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.confirm": "alt+y", "tui.select.cancel": "alt+x" }));
  await settle();
  custom.selector.handleInput("\x1bj");
  custom.selector.handleInput("\x1by");
  assert.deepEqual(custom.accepted, ["older"]);
  const cancel = setup(DEFAULT_CONFIG, new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.cancel": "alt+x" }));
  cancel.selector.handleInput("\x1bx");
  assert.deepEqual(cancel.accepted, [undefined]);
});

test("scope cycle preserves query and updates results", async () => {
  const { selector } = setup();
  selector.handleInput("old");
  selector.handleInput("\t");
  await settle();
  assert.ok(selector.render(80)[0].includes("session (2)"));
  selector.handleInput("\t");
  await settle();
  assert.ok(selector.render(80)[0].includes("global (2)"));
});

test("typing keeps the previous frame stable without loading labels or stale acceptance", async () => {
  const requests: ((value: SearchResult) => void)[] = [];
  const accepted: (string | undefined)[] = [];
  const selector = new HistorySelector({ requestRender() {}, terminal: { rows: 24 } }, theme,
    new KeybindingsManager(TUI_KEYBINDINGS), (value) => accepted.push(value), {
      search: () => new Promise((resolve) => requests.push(resolve)), dispose() {},
    }, DEFAULT_CONFIG);
  assert.ok(selector.render(80).every((line) => !/Searching history|loading/.test(line)));
  requests[0]({ matches: records.map((item) => ({ item, positions: new Set() })), total: records.length, offset: 0 });
  await settle();
  selector.handleInput("\x12");
  const before = selector.render(80);
  selector.handleInput("old");
  const pending = selector.render(80);
  assert.equal(pending.length, before.length);
  assert.equal(pending[0], before[0]);
  assert.deepEqual(pending.slice(2), before.slice(2));
  selector.handleInput("\r");
  assert.deepEqual(accepted, []);
  requests[1]({ matches: [{ item: records[2], positions: new Set() }], total: 1, offset: 0 });
  await settle();
  selector.handleInput("\r");
  assert.deepEqual(accepted, ["oldest"]);
});

test("async results cannot overwrite newer queries or accept stale selections", async () => {
  const requests: ((value: SearchResult) => void)[] = [];
  const accepted: (string | undefined)[] = [];
  let disposed = false;
  let renders = 0;
  const service: SearchService = {
    search: () => new Promise((resolve) => requests.push(resolve)),
    dispose: () => { disposed = true; },
  };
  const selector = new HistorySelector({ requestRender: () => { renders++; }, terminal: { rows: 24 } }, theme,
    new KeybindingsManager(TUI_KEYBINDINGS), (value) => accepted.push(value), service, DEFAULT_CONFIG);
  selector.handleInput("a");
  selector.handleInput("b");
  selector.handleInput("\r");
  assert.deepEqual(accepted, []);
  requests[2]({ matches: [{ item: records[2], positions: new Set() }], total: 1, offset: 0 });
  await settle();
  requests[1]({ matches: [{ item: records[1], positions: new Set() }], total: 1, offset: 0 });
  await settle();
  assert.ok(selector.render(80).some((line) => line.includes("oldest")));
  selector.handleInput("\x1b");
  assert.equal(disposed, true);
  const previousRenders = renders;
  requests[0]({ matches: [], total: 0, offset: 0 });
  await settle();
  assert.equal(renders, previousRenders);
  assert.deepEqual(accepted, [undefined]);
});

test("navigation loads later and earlier pages without losing the selected value", async () => {
  const items = Array.from({ length: 250 }, (_, i) => ({ ...records[0], text: `prompt${i}`, label: `prompt${i}`, id: String(i) }));
  const accepted: (string | undefined)[] = [];
  const offsets: number[] = [];
  const selector = new HistorySelector({ requestRender() {}, terminal: { rows: 24 } }, theme,
    new KeybindingsManager(TUI_KEYBINDINGS), (value) => accepted.push(value), {
      search: async (_query, _scope, offset = 0) => {
        offsets.push(offset);
        return { matches: items.slice(offset, offset + 100).map((item) => ({ item, positions: new Set<number>() })), total: items.length, offset };
      }, dispose() {},
    }, DEFAULT_CONFIG);
  await settle();
  for (let i = 0; i < 150; i++) { selector.handleInput("\x12"); await settle(); }
  assert.ok(selector.render(80).some((line) => line.includes("→ prompt150")));
  selector.handleInput("prompt");
  await settle();
  assert.equal(offsets.at(-1), 0);
  assert.ok(selector.render(80).some((line) => line.includes("→ prompt0")));
  for (let i = 0; i < 150; i++) { selector.handleInput("\x12"); await settle(); }
  for (let i = 0; i < 150; i++) { selector.handleInput("\x13"); await settle(); }
  assert.ok(offsets.some((offset) => offset >= 100));
  selector.handleInput("\r");
  assert.deepEqual(accepted, ["prompt0"]);
});

test("search failure clears retained results and remains cancellable", async () => {
  const accepted: (string | undefined)[] = [];
  let initial = true;
  const selector = new HistorySelector({ requestRender() {}, terminal: { rows: 24 } }, theme,
    new KeybindingsManager(TUI_KEYBINDINGS), (value) => accepted.push(value), {
      search: async () => {
        if (!initial) throw new Error("failed");
        initial = false;
        return { matches: [{ item: records[0], positions: new Set<number>() }], total: 1, offset: 0 };
      }, dispose() {},
    }, DEFAULT_CONFIG);
  await settle();
  selector.handleInput("fail");
  await settle();
  assert.ok(selector.render(100).some((line) => line.includes("History search failed")));
  selector.handleInput("\r");
  assert.deepEqual(accepted, []);
  selector.handleInput("\x03");
  assert.deepEqual(accepted, [undefined]);
});
