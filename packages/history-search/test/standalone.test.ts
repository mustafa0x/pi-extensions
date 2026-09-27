import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const binary = process.env.PI_HISTORY_TEST_BINARY;

test("standalone Pi survives repeated history locks, pruning, clearing and reopening", {
  skip: !binary && "Set PI_HISTORY_TEST_BINARY to the standalone Pi executable",
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-history-standalone-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = fileURLToPath(new URL("./fixtures/storage-extension.ts", import.meta.url));
  // Regression: Bun/Jiti's graceful-fs proxy used to crash on the second lock's
  // non-configurable mtime-precision Symbol, outside the promise error handler.
  const run = exec(binary!, [
    "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
    "--no-themes", "--no-session", "--no-tools", "--offline", "-e", fixture,
    "--mode", "json", "-p", "ignored",
  ], {
    cwd: directory,
    env: { PATH: process.env.PATH, HOME: directory, PI_CODING_AGENT_DIR: join(directory, "agent"), PI_OFFLINE: "1", PI_TELEMETRY: "0" },
    timeout: 20000,
  });
  // Print mode waits for piped stdin to finish before starting the session.
  run.child.stdin?.end();
  const { stderr } = await run;
  assert.doesNotMatch(stderr, /TypeError|Proxy handler|Extension error/);
  const rows: { text: string }[] = (await readFile(join(directory, "history.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(rows.map((row) => row.text), ["after clear 1", "after clear 2", "after clear 3"]);
});
