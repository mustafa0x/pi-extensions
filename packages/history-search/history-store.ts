import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";

export interface HistoryRecord {
  version: 1;
  id: string;
  timestamp: string;
  cwd: string;
  sessionId: string;
  text: string;
}

export interface Limits { maxEntries: number; maxBytes: number }
export const MAX_RECORD_BYTES = 64 * 1024;

export function isRecord(value: unknown): value is HistoryRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return r.version === 1 && typeof r.id === "string" && typeof r.timestamp === "string" &&
    Number.isFinite(Date.parse(r.timestamp)) && typeof r.cwd === "string" && typeof r.sessionId === "string" &&
    typeof r.text === "string" && r.text.trim().length > 0;
}

export function retain(records: HistoryRecord[], limits: Limits): HistoryRecord[] {
  let bytes = 0;
  const kept: HistoryRecord[] = [];
  for (let i = records.length - 1; i >= 0 && kept.length < limits.maxEntries; i--) {
    const size = Buffer.byteLength(JSON.stringify(records[i]) + "\n");
    if (size > Math.min(MAX_RECORD_BYTES, limits.maxBytes)) continue;
    if (bytes + size > limits.maxBytes) break;
    bytes += size;
    kept.push(records[i]);
  }
  return kept.reverse();
}

export class HistoryStore {
  readonly path: string;
  private readonly limits: Limits;
  private queue: Promise<void> = Promise.resolve();

  constructor(path: string, limits: Limits) {
    this.path = path;
    this.limits = limits;
  }

  // Read a bounded tail, not an unbounded file. Ignore an incomplete first/last row.
  async read(): Promise<HistoryRecord[]> {
    return retain((await this.snapshot()).records, this.limits);
  }

  private async snapshot(): Promise<{ records: HistoryRecord[]; size: number; terminated: boolean }> {
    let file;
    try { file = await open(this.path, "r"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { records: [], size: 0, terminated: true };
      throw error;
    }
    try {
      const { size } = await file.stat();
      const start = Math.max(0, size - this.limits.maxBytes - MAX_RECORD_BYTES);
      const buffer = Buffer.alloc(size - start);
      let read = 0;
      while (read < buffer.length) {
        const result = await file.read(buffer, read, buffer.length - read, start + read);
        if (!result.bytesRead) break;
        read += result.bytesRead;
      }
      const data = buffer.subarray(0, read);
      const terminated = data.length === 0 || data[data.length - 1] === 10;
      const lines = data.toString("utf8").split("\n");
      if (start) lines.shift();
      lines.pop(); // Empty after final newline, or a torn final row.
      const records: HistoryRecord[] = [];
      for (const line of lines) {
        if (Buffer.byteLength(line) + 1 > MAX_RECORD_BYTES) continue;
        try {
          const value: unknown = JSON.parse(line);
          if (isRecord(value)) records.push(value);
        } catch { /* Corrupt rows do not prevent recovering later records. */ }
      }
      return { records, size, terminated };
    } finally { await file.close(); }
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => {});
    return next;
  }

  private async locked(operation: (assertLock: () => void) => Promise<void>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await chmod(dirname(this.path), 0o700);
    let compromised: Error | undefined;
    const release = await lockfile.lock(this.path, {
      realpath: false,
      retries: { retries: 8, minTimeout: 20, maxTimeout: 100, factor: 1.5 },
      onCompromised: (error) => { compromised = error; },
    });
    try {
      await operation(() => { if (compromised) throw compromised; });
      if (compromised) throw compromised;
    } finally { await release(); }
  }

  append(record: HistoryRecord): Promise<void> {
    const row = JSON.stringify(record) + "\n";
    if (!record.text.trim()) return Promise.resolve();
    if (Buffer.byteLength(row) > Math.min(MAX_RECORD_BYTES, this.limits.maxBytes)) {
      return Promise.reject(new Error("prompt exceeds the history record size limit"));
    }
    return this.enqueue(() => this.locked(async (assertLock) => {
      const { records, size, terminated } = await this.snapshot();
      const last = records.at(-1);
      if (last?.text === record.text && last.cwd === record.cwd && last.sessionId === record.sessionId) return;
      records.push(record);
      assertLock();
      if (!terminated || size + Buffer.byteLength(row) > this.limits.maxBytes || records.length > this.limits.maxEntries) {
        await this.rewrite(retain(records, this.limits), assertLock);
      } else {
        const file = await open(this.path, "a", 0o600);
        try {
          if (process.platform !== "win32") await file.chmod(0o600);
          assertLock();
          await file.writeFile(row);
        } finally { await file.close(); }
      }
    }));
  }

  clear(): Promise<void> {
    return this.enqueue(() => this.locked((assertLock) => this.rewrite([], assertLock)));
  }

  flush(): Promise<void> { return this.queue; }

  private async rewrite(records: HistoryRecord[], assertLock: () => void): Promise<void> {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, records.map((record) => JSON.stringify(record) + "\n").join(""), { mode: 0o600, flag: "wx" });
      assertLock();
      await rename(temporary, this.path);
    } finally { await rm(temporary, { force: true }); }
  }
}
