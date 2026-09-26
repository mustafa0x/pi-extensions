import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import lockfile from "proper-lockfile";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG, parseConfig } from "../config.ts";
import { branchFallback, CAPTURE_BOUNDARY } from "../history-source.ts";
import { HistoryStore, MAX_RECORD_BYTES, type HistoryRecord } from "../history-store.ts";
import { candidates, createSearch, displayText, type Candidate } from "../search.ts";

const exec = promisify(execFile);
function record(text: string, overrides: Partial<HistoryRecord> = {}): HistoryRecord {
  return { version: 1, id: text, timestamp: "2026-01-01T00:00:00Z", cwd: "/repo", sessionId: "a", text, ...overrides };
}
function candidate(text: string, overrides: Partial<Candidate> = {}): Candidate {
  return { ...record(text), label: displayText(text), source: "persisted", ...overrides };
}
async function temporary(t: { after: (fn: () => Promise<void>) => void }): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-history-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("config validates fields individually and all shortcuts", () => {
  const result = parseConfig({ capture: false, scope: "global", older: "alt+r", newer: "ctrl++", maxVisible: -1, maxEntries: "bad" });
  assert.equal(result.config.capture, false);
  assert.equal(result.config.scope, "global");
  assert.equal(result.config.older, "alt+r");
  assert.equal(result.config.newer, "ctrl++");
  assert.equal(result.config.maxVisible, DEFAULT_CONFIG.maxVisible);
  assert.equal(result.invalid, true);
  assert.equal(parseConfig({ shortcut: "wat+r" }).config.shortcut, "ctrl+r");
  assert.equal(parseConfig(null).invalid, true);
});

test("round-trip, duplicate scopes, corruption recovery, private permissions", async (t) => {
  const dir = await temporary(t);
  const path = join(dir, "store", "history.jsonl");
  const store = new HistoryStore(path, DEFAULT_CONFIG);
  const text = " hello\n\tمرحبا 中文 🧑‍💻 ";
  await store.append(record("   "));
  await store.append(record(text));
  await store.append(record(text));
  await store.append(record(text, { cwd: "/other", id: "other" }));
  assert.equal((await store.read()).length, 2);
  assert.equal((await store.read())[0].text, text);
  const data = await readFile(path, "utf8");
  await writeFile(path, 'bad row\n' + data + '{"torn":');
  assert.equal((await store.read()).length, 2);
  await store.append(record("after torn row"));
  assert.equal((await store.read()).at(-1)?.text, "after torn row");
  for (const line of (await readFile(path, "utf8")).trim().split("\n")) JSON.parse(line);
  if (process.platform !== "win32") {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(join(dir, "store"))).mode & 0o777, 0o700);
  }
});

test("retention, oversized records, queue recovery and clear", async (t) => {
  const dir = await temporary(t);
  const store = new HistoryStore(join(dir, "history.jsonl"), { maxEntries: 3, maxBytes: 650 });
  for (let i = 0; i < 12; i++) await store.append(record(String(i)));
  assert.equal((await store.read()).length, 3);
  assert.equal((await store.read()).at(-1)?.text, "11");
  assert.ok((await stat(store.path)).size <= 650);
  await assert.rejects(store.append(record("x".repeat(MAX_RECORD_BYTES))), /size limit/);
  await store.append(record("valid"));
  assert.equal((await store.read()).at(-1)?.text, "valid");
  await store.clear();
  assert.deepEqual(await store.read(), []);
});

test("byte limit and bounded tail reads recover after a huge malformed row", async (t) => {
  const dir = await temporary(t);
  const path = join(dir, "history.jsonl");
  const store = new HistoryStore(path, { maxEntries: 100, maxBytes: 500 });
  await writeFile(path, 'x'.repeat(200000) + '\n' + JSON.stringify(record("good")) + '\n');
  assert.deepEqual((await store.read()).map((r) => r.text), ["good"]);
  for (let i = 0; i < 10; i++) await store.append(record(String(i)));
  assert.ok((await stat(path)).size <= 500);
  assert.ok((await store.read()).length < 10);
});

test("lock contention fails promptly and subsequent writes recover", async (t) => {
  const dir = await temporary(t);
  const store = new HistoryStore(join(dir, "history.jsonl"), DEFAULT_CONFIG);
  const release = await lockfile.lock(store.path, { realpath: false });
  try { await assert.rejects(store.append(record("blocked")), { code: "ELOCKED" }); }
  finally { await release(); }
  await store.append(record("recovered"));
  assert.equal((await store.read())[0].text, "recovered");
});

test("separate processes serialize appends and pruning", async (t) => {
  const dir = await temporary(t);
  const path = join(dir, "history.jsonl");
  const worker = new URL("./writer.ts", import.meta.url);
  await Promise.all(["a", "b", "c"].map((id) => exec(process.execPath, [worker.pathname, path, id])));
  const store = new HistoryStore(path, { maxEntries: 15, maxBytes: 10000 });
  const records = await store.read();
  assert.equal(records.length, 15);
  assert.equal(new Set(records.map((r) => r.id)).size, 15);
  const rows = (await readFile(path, "utf8")).trim().split("\n");
  assert.equal(rows.length, 15);
  for (const row of rows) JSON.parse(row);
});

test("filter precedes exact deduplication; recency breaks fuzzy ties", () => {
  const older = candidate("same", { timestamp: "2026-01-01T00:00:00Z" });
  const newer = candidate("same", { id: "new", timestamp: "2026-02-01T00:00:00Z", cwd: "/other", sessionId: "b" });
  assert.deepEqual(candidates([newer, older], "directory", "/repo/.", "a"), [older]);
  assert.deepEqual(candidates([newer, older], "session", "/repo", "a"), [older]);
  assert.deepEqual(candidates([older, newer], "global", "/repo", "a"), [newer]);
  const items = candidates([candidate("ax", { id: "old" }), candidate("ay", { id: "new", timestamp: newer.timestamp })], "global", "/repo", "a");
  const search = createSearch(items);
  assert.deepEqual(search("a").map((m) => m.item.id), ["new", "old"]);
  assert.deepEqual(search("a").map((m) => [...m.positions]), [[0], [0]]);
  assert.deepEqual(search("").map((m) => m.item.id), ["new", "old"]);
});

test("search display strips control sequences without changing accepted text", () => {
  const item = candidate("hello\n \tworld\x1b[31m\x00");
  const matches = createSearch([item])("hw");
  assert.equal(item.label, "hello world");
  assert.equal(matches[0].item.text, item.text);
  assert.deepEqual([...matches[0].positions].sort((a, b) => a - b), [0, 6]);
});

test("branch fallback ends at durable capture boundary and survives resume", () => {
  const session = SessionManager.inMemory("/repo");
  session.appendMessage({ role: "user", content: "old prompt", timestamp: Date.now() });
  session.appendMessage({ role: "user", content: [{ type: "text", text: "text" }, { type: "image", data: "ignored", mimeType: "image/png" }], timestamp: Date.now() });
  session.appendCustomEntry(CAPTURE_BOUNDARY, {});
  session.appendMessage({ role: "user", content: "expanded skill contents", timestamp: Date.now() });
  assert.deepEqual(branchFallback(session.getBranch(), "/repo", "a").map((r) => r.text), ["old prompt", "text"]);
  assert.deepEqual(branchFallback(session.getBranch(), "/repo", "a").map((r) => r.source), ["branch", "branch"]);
});
