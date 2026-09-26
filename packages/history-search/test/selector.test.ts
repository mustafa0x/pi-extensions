import assert from "node:assert/strict";
import { test } from "node:test";
import { CURSOR_MARKER, KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG } from "../config.ts";
import { displayText, type Candidate } from "../search.ts";
import { HistorySelector } from "../selector.ts";

const theme = { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text };
const records: Candidate[] = ["new\n中文 🧑‍💻", "older", "oldest"].map((text, i) => ({
  version: 1, id: String(i), timestamp: `2026-01-0${3 - i}T00:00:00Z`, text, label: displayText(text), source: "persisted", cwd: "/repo", sessionId: "s",
}));

function setup(config = DEFAULT_CONFIG, keys = new KeybindingsManager(TUI_KEYBINDINGS)) {
  const accepted: (string | undefined)[] = [];
  const tui = { requestRender() {}, terminal: { rows: 24 } };
  const selector = new HistorySelector(tui, theme, keys, (text) => accepted.push(text), records, config, "/repo", "s");
  return { selector, accepted, tui };
}

test("focus/IME marker, stable heights and narrow/wide Unicode rendering", () => {
  const { selector, tui } = setup();
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
  assert.equal(selector.render(80).length, height);
  assert.ok(selector.render(80).some((line) => line.includes("No matching history")));
  selector.focused = false;
  assert.ok(selector.render(80).every((line) => !line.includes(CURSOR_MARKER)));
});

test("accept preserves multiline text; cancel and empty results do not accept", () => {
  const { selector, accepted } = setup();
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

test("cycling, page navigation and configurable selection keys", () => {
  const { selector, accepted } = setup();
  selector.handleInput("\x12"); // Ctrl+R: older
  selector.handleInput("\x12");
  selector.handleInput("\x13"); // Ctrl+S: newer
  selector.handleInput("\r");
  assert.deepEqual(accepted, ["older"]);
  const custom = setup({ ...DEFAULT_CONFIG, older: "alt+j", newer: "alt+k" }, new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.confirm": "alt+y", "tui.select.cancel": "alt+x" }));
  custom.selector.handleInput("\x1bj");
  custom.selector.handleInput("\x1by");
  assert.deepEqual(custom.accepted, ["older"]);
  const cancel = setup(DEFAULT_CONFIG, new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.cancel": "alt+x" }));
  cancel.selector.handleInput("\x1bx");
  assert.deepEqual(cancel.accepted, [undefined]);
});

test("scope cycle preserves query and updates results", () => {
  const { selector } = setup();
  selector.handleInput("old");
  selector.handleInput("\t");
  assert.ok(selector.render(80)[0].includes("session (2)"));
  selector.handleInput("\t");
  assert.ok(selector.render(80)[0].includes("global (2)"));
});
