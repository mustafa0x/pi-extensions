import { fork, type ChildProcess } from "node:child_process";
import type { Scope } from "./config.ts";
import { candidates, createSearch, type SearchOptions, type SearchRequest, type SearchResponse, type SearchResult, type SearchService } from "./search.ts";

interface Pending {
  id: number;
  query: string;
  scope: Scope;
  offset: number;
  resolve: (result: SearchResult | undefined) => void;
}

export class SearchClient implements SearchService {
  private readonly child?: ChildProcess;
  private readonly options: SearchOptions;
  private active?: Pending;
  private pending?: Pending;
  private timer?: ReturnType<typeof setTimeout>;
  private nextId = 0;
  private disposed = false;
  private failed = false;

  // The distributed Pi binary is compiled Bun, not a Node executable.
  constructor(options: SearchOptions, executable = process.versions.bun ? "node" : process.execPath) {
    this.options = options;
    try {
      this.child = fork(new URL("./search-worker.mjs", import.meta.url), [], {
        execPath: executable,
        execArgv: [],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        serialization: "json",
      });
    } catch { this.failed = true; return; }
    this.child.stderr?.resume();
    this.child.on("error", () => this.fail());
    this.child.on("exit", () => { if (!this.disposed) this.fail(); });
    this.child.on("message", (message: SearchResponse) => {
      if (this.disposed || message.id !== this.active?.id) return;
      clearTimeout(this.timer);
      const active = this.active;
      this.active = undefined;
      active.resolve({ matches: message.matches.map((match) => ({ ...match, positions: new Set(match.positions) })), total: message.total, offset: message.offset, warning: message.error ?? message.warning });
      if (this.pending) {
        const pending = this.pending;
        this.pending = undefined;
        this.send(pending);
      }
    });
    this.post({ type: "init", options });
  }

  search(query: string, scope: Scope, offset = 0): Promise<SearchResult | undefined> {
    if (this.disposed) return Promise.resolve(undefined);
    if (this.failed) return Promise.resolve(this.fallback(query, scope, offset));
    return new Promise((resolve) => {
      const pending = { id: ++this.nextId, query, scope, offset, resolve };
      if (this.active) {
        // Keep only the latest unsent query instead of building a typing backlog.
        this.pending?.resolve(undefined);
        this.pending = pending;
      } else this.send(pending);
    });
  }

  private send(request: Pending): void {
    this.active = request;
    this.timer = setTimeout(() => this.fail(), 15000);
    this.post({ type: "search", id: request.id, query: request.query, scope: request.scope, offset: request.offset });
  }

  private post(message: SearchRequest): void {
    // Bun may return a child without an IPC send method after spawn failure.
    if (!this.child || typeof this.child.send !== "function") { this.fail(); return; }
    try { this.child.send(message, (error) => { if (error) this.fail(); }); }
    catch { this.fail(); }
  }

  private fallback(query: string, scope: Scope, offset: number): SearchResult {
    const matches = createSearch(candidates(this.options.records, scope, this.options.cwd, this.options.sessionId))(query);
    return { matches: matches.slice(offset, offset + 100), total: matches.length, offset,
      warning: "Search process unavailable. Using local history only; Node 22.19+ must be on PATH for standalone Pi." };
  }

  private fail(): void {
    if (this.disposed || this.failed) return;
    this.failed = true;
    clearTimeout(this.timer);
    this.child?.kill();
    for (const request of [this.active, this.pending]) {
      if (request) request.resolve(this.fallback(request.query, request.scope, request.offset));
    }
    this.active = this.pending = undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    this.active?.resolve(undefined);
    this.pending?.resolve(undefined);
    this.active = this.pending = undefined;
    this.child?.kill();
  }
}
