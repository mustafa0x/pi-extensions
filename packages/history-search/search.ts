import type { Scope } from "./config.ts";
import type { HistoryRecord } from "./history-store.ts";

// The implementation is plain ESM so the Node search process also works when
// installed under node_modules, where Node refuses to strip TypeScript.
export { candidates, createSearch, displayText } from "./search-core.mjs";

export interface Candidate extends HistoryRecord {
  source: "persisted" | "branch" | "agentsview";
  label: string;
}
export interface Match { item: Candidate; positions: Set<number> }
export interface SearchResult { matches: Match[]; total: number; offset: number; warning?: string }
export interface SearchService {
  search(query: string, scope: Scope, offset?: number): Promise<SearchResult | undefined>;
  dispose(): void;
}

export interface SearchOptions {
  records: Candidate[];
  cwd: string;
  sessionId: string;
  databasePath?: string;
  // Known boundary in the active branch. Avoid its expanded post-capture text.
  branchCutoff?: string;
}
export type SearchRequest = { type: "init"; options: SearchOptions } |
  { type: "search"; id: number; query: string; scope: Scope; offset: number };
export interface SearchResponse {
  id: number;
  matches: { item: Candidate; positions: number[] }[];
  total: number;
  offset: number;
  warning?: string;
  error?: string;
}
