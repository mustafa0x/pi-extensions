import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { readAgentsView } from "../agentsview.mjs";
import { SearchClient } from "../search-client.ts";
import type { Candidate, SearchOptions } from "../search.ts";

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), "pi-agentsview-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "sessions.db");
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE sessions(id TEXT PRIMARY KEY, agent TEXT, cwd TEXT, deleted_at TEXT);
    CREATE TABLE messages(id INTEGER PRIMARY KEY, session_id TEXT, source_uuid TEXT, content TEXT,
      timestamp TEXT, role TEXT, source_type TEXT, is_system INTEGER);
    CREATE INDEX idx_sessions_agent ON sessions(agent);
    CREATE INDEX idx_messages_session_role ON messages(session_id, role);
    INSERT INTO sessions VALUES ('pi:one', 'pi', '/repo', NULL), ('pi:two', 'pi', '/other', NULL),
      ('pi:deleted', 'pi', '/repo', '2026-01-01'), ('codex:other', 'codex', '/repo', NULL);
  `);
  const insert = db.prepare("INSERT INTO messages(session_id,source_uuid,content,timestamp,role,source_type,is_system) VALUES(?,?,?,?,?,?,?)");
  insert.run("pi:one", "a", " old\n\tمرحبا 中文 🧑‍💻 ", "2026-01-01T00:00:00Z", "user", "user", 0);
  insert.run("pi:one", "b", "duplicate", "2026-01-02T00:00:00Z", "user", "user", 0);
  insert.run("pi:two", "c", "duplicate", "2026-01-03T00:00:00Z", "user", "user", 0);
  insert.run("pi:one", "d", "tool result", "2026-01-04T00:00:00Z", "user", "toolResult", 0);
  insert.run("pi:one", "e", "assistant", "2026-01-04T00:00:00Z", "assistant", "assistant", 0);
  insert.run("pi:one", "f", "system", "2026-01-04T00:00:00Z", "user", "user", 1);
  insert.run("pi:deleted", "g", "deleted", "2026-01-04T00:00:00Z", "user", "user", 0);
  insert.run("codex:other", "h", "codex", "2026-01-04T00:00:00Z", "user", "user", 0);
  db.close();
  const options: SearchOptions = { records: [], cwd: "/repo", sessionId: "one", databasePath: path };
  return { path, options };
}

test("read-only AgentsView adapter preserves text and excludes other agents, roles and deleted sessions", async (t) => {
  const { path, options } = await fixture(t);
  const before = await readFile(path);
  const { records, warning } = readAgentsView(options);
  assert.equal(warning, undefined);
  assert.equal(records.length, 3);
  assert.equal(records[2].text, " old\n\tمرحبا 中文 🧑‍💻 ");
  assert.equal(records[2].sessionId, "one");
  assert.equal(records[2].cwd, "/repo");
  assert.equal(records[2].id, "agentsview:pi:one:a");
  assert.equal(records[2].source, "agentsview");
  assert.deepEqual(await readFile(path), before);
  const cutoff = readAgentsView({ ...options, branchCutoff: "2026-01-02T00:00:00Z" });
  assert.equal(cutoff.records.length, 2);
  assert.ok(cutoff.records.some((r) => r.sessionId === "two"));
});

test("disabled/missing/incompatible archives are non-destructive and optional", async (t) => {
  const { path, options } = await fixture(t);
  assert.deepEqual(readAgentsView({ ...options, databasePath: undefined }), { records: [] });
  const missing = `${path}.missing`;
  assert.match(readAgentsView({ ...options, databasePath: missing }).warning ?? "", /unavailable/);
  await assert.rejects(readFile(missing), { code: "ENOENT" });
  const db = new DatabaseSync(path);
  db.exec("DROP TABLE messages");
  db.close();
  const before = await readFile(path);
  const result = readAgentsView(options);
  assert.deepEqual(result.records, []);
  assert.match(result.warning ?? "", /incompatible/);
  assert.deepEqual(await readFile(path), before);
});

test("real Node process merges, filters before deduplication and prefers raw history", async (t) => {
  const { options } = await fixture(t);
  const raw: Candidate = { version: 1, id: "raw", text: "duplicate", label: "duplicate", cwd: "/repo",
    sessionId: "one", timestamp: "2026-01-02T00:00:00Z", source: "persisted" };
  const client = new SearchClient({ ...options, records: [raw] });
  t.after(() => client.dispose());
  const directory = await client.search("", "directory");
  assert.equal(directory?.warning, undefined);
  assert.equal(directory?.matches.length, 2);
  assert.equal(directory?.matches[0].item.id, "raw");
  const global = await client.search("dup", "global");
  assert.equal(global?.matches.length, 1);
  assert.equal(global?.matches[0].item.source, "persisted");
  assert.deepEqual([...global!.matches[0].positions].sort((a, b) => a - b), [0, 1, 2]);
  const session = await client.search("", "session");
  assert.ok(session?.matches.every((m) => m.item.sessionId === "one"));
});

test("queries are coalesced and disposal resolves outstanding requests", async (t) => {
  const { options } = await fixture(t);
  const client = new SearchClient(options);
  t.after(() => client.dispose());
  const first = client.search("", "global");
  const obsolete = client.search("x", "global");
  const latest = client.search("dup", "global");
  assert.equal(await obsolete, undefined);
  assert.ok((await first)?.matches.length);
  assert.equal((await latest)?.matches.length, 1);
  const cancelled = client.search("hello", "global");
  client.dispose();
  assert.equal(await cancelled, undefined);
  assert.equal(await client.search("", "global"), undefined);
});

test("worker launch failure preserves local history search", async (t) => {
  const records: Candidate[] = [{ version: 1, id: "raw", text: "local prompt", label: "local prompt", cwd: "/repo",
    sessionId: "one", timestamp: "2026-01-02T00:00:00Z", source: "persisted" }];
  const client = new SearchClient({ records, cwd: "/repo", sessionId: "one" }, "/nonexistent/pi-history-node");
  t.after(() => client.dispose());
  const result = await client.search("local", "global");
  assert.equal(result?.matches[0].item.text, "local prompt");
  assert.match(result?.warning ?? "", /Search process unavailable/);
  const subsequent = await client.search("", "global");
  assert.equal(subsequent?.total, 1);
});

test("bounded pages retain the full searchable result count", async (t) => {
  const records: Candidate[] = Array.from({ length: 250 }, (_, i) => ({ version: 1, id: `raw-${i}`,
    text: `prompt${String(i).padStart(3, "0")}`, label: `prompt${String(i).padStart(3, "0")}`, cwd: "/repo", sessionId: "one",
    timestamp: new Date(Date.UTC(2026, 0, 1) - i * 1000).toISOString(), source: "persisted" }));
  const client = new SearchClient({ records, cwd: "/repo", sessionId: "one" });
  t.after(() => client.dispose());
  const first = await client.search("", "global");
  assert.equal(first?.matches.length, 100);
  assert.equal(first?.total, 250);
  const last = await client.search("", "global", 200);
  assert.equal(last?.matches.length, 50);
  assert.equal(last?.matches[0].item.text, "prompt200");
  assert.equal(last?.offset, 200);
  const fuzzy = await client.search("prompt", "global", 200);
  assert.equal(fuzzy?.total, 250);
  assert.equal(fuzzy?.matches.length, 50);
});

test("missing archive still searches raw history, and reopening sees archive updates", async (t) => {
  const { path, options } = await fixture(t);
  const raw: Candidate = { version: 1, id: "raw", text: "recent", label: "recent", cwd: "/repo",
    sessionId: "one", timestamp: "2026-01-02T00:00:00Z", source: "persisted" };
  const unavailable = new SearchClient({ ...options, databasePath: `${path}.missing`, records: [raw] });
  t.after(() => unavailable.dispose());
  const fallback = await unavailable.search("recent", "global");
  assert.equal(fallback?.matches[0].item.text, "recent");
  assert.match(fallback?.warning ?? "", /AgentsView unavailable/);
  unavailable.dispose();
  const db = new DatabaseSync(path);
  db.prepare("UPDATE messages SET content='newly indexed' WHERE source_uuid='a'").run();
  db.close();
  const reopened = new SearchClient(options);
  t.after(() => reopened.dispose());
  const result = await reopened.search("newly", "global");
  assert.equal(result?.matches[0].item.text, "newly indexed");
});
