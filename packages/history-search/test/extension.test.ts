import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discoverAndLoadExtensions, SessionManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CAPTURE_BOUNDARY } from "../history-source.ts";

const extensionPath = new URL("../index.ts", import.meta.url).pathname;

test("real extension loader: raw capture, exclusions, cancel/accept, streaming and reload", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-history-extension-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });
  const loaded = await discoverAndLoadExtensions([extensionPath], dir, dir);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const extension = loaded.extensions[0];
  let session = SessionManager.inMemory(dir);
  loaded.runtime.appendEntry = (type, data) => { session.appendCustomEntry(type, data); };
  let draft = "original\n  multiline";
  let selection: string | undefined;
  let customCalls = 0;
  let editorWrites = 0;
  let rendersAfterWrite = 0;
  const notifications: string[] = [];
  // Only the UI surface this extension uses is mocked; session storage and loader are real.
  const ctx = {
    mode: "tui", hasUI: true, cwd: dir, isIdle: () => false,
    get sessionManager() { return session; },
    ui: {
      notify: (text: string) => notifications.push(text),
      getEditorText: () => draft,
      setEditorText: (text: string) => { draft = text; editorWrites++; },
      custom: async (factory: (...args: unknown[]) => unknown) => {
        customCalls++;
        factory({ requestRender: () => { if (editorWrites) rendersAfterWrite++; }, terminal: { rows: 24 } }, {}, {}, () => {});
        return selection;
      },
      confirm: async () => true,
    },
  } as unknown as ExtensionContext;
  const fire = async (type: string, event: object = {}) => {
    for (const handler of extension.handlers.get(type) ?? []) await handler({ type, ...event }, ctx);
  };
  await fire("session_start");
  await fire("session_start");
  assert.equal(session.getBranch().filter((e) => e.type === "custom" && e.customType === CAPTURE_BOUNDARY).length, 1);
  assert.deepEqual(await extension.handlers.get("input")![0]({ type: "input", source: "interactive", text: "/skill:demo  raw\nargs" }, ctx), { action: "continue" });
  await fire("input", { source: "extension", text: "do not capture" });
  await fire("input", { source: "rpc", text: "do not capture either" });
  await fire("session_shutdown");
  const path = join(dir, "history-search/history.jsonl");
  const records = (await readFile(path, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(records.length, 1);
  assert.equal(records[0].text, "/skill:demo  raw\nargs");
  await extension.shortcuts.get("ctrl+r")!.handler(ctx);
  assert.equal(draft, "original\n  multiline");
  assert.equal(editorWrites, 0);
  selection = "selected\nexact";
  await extension.shortcuts.get("ctrl+r")!.handler(ctx);
  assert.equal(draft, selection);
  assert.equal(editorWrites, 1);
  assert.equal(rendersAfterWrite, 1);
  assert.equal(customCalls, 2);
  const resumed = await discoverAndLoadExtensions([extensionPath], dir, dir);
  assert.deepEqual(resumed.errors, []);
  resumed.runtime.appendEntry = loaded.runtime.appendEntry;
  for (const handler of resumed.extensions[0].handlers.get("session_start") ?? []) await handler({ type: "session_start" }, ctx);
  assert.equal(session.getBranch().filter((e) => e.type === "custom").length, 1);
  session = SessionManager.inMemory(dir);
  await fire("session_start");
  assert.equal(session.getBranch().filter((e) => e.type === "custom").length, 1);
  assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 1);
  assert.deepEqual(notifications, []);
});

test("capture disabled does not write; unavailable storage never rejects input", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-history-disabled-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });
  await mkdir(join(dir, "history-search"));
  await writeFile(join(dir, "history-search/config.json"), '{"capture":false}');
  const session = SessionManager.inMemory(dir);
  const notifications: string[] = [];
  const ctx = { mode: "tui", hasUI: true, cwd: dir, sessionManager: session,
    ui: { notify: (text: string) => notifications.push(text) } };
  let loaded = await discoverAndLoadExtensions([extensionPath], dir, dir);
  assert.deepEqual(loaded.errors, []);
  await loaded.extensions[0].handlers.get("input")![0]({ source: "interactive", text: "secret" }, ctx);
  await loaded.extensions[0].handlers.get("session_shutdown")![0]({}, ctx);
  await assert.rejects(readFile(join(dir, "history-search/history.jsonl")), { code: "ENOENT" });
  await rm(join(dir, "history-search"), { recursive: true });
  await writeFile(join(dir, "history-search"), "not a directory");
  loaded = await discoverAndLoadExtensions([extensionPath], dir, dir);
  assert.deepEqual(loaded.errors, []);
  loaded.runtime.appendEntry = (type, data) => { session.appendCustomEntry(type, data); };
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(await loaded.extensions[0].handlers.get("input")![0]({ source: "interactive", text: "saved?" }, ctx), { action: "continue" });
  }
  await loaded.extensions[0].handlers.get("session_shutdown")![0]({}, ctx);
  assert.equal(notifications.length, 1);
});
