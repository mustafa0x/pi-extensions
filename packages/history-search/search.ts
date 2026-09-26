import { resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { Fzf, type FzfResultItem } from "fzf";
import type { Scope } from "./config.ts";
import type { HistoryRecord } from "./history-store.ts";

export interface Candidate extends HistoryRecord {
  source: "persisted" | "branch";
  label: string;
}
export interface Match { item: Candidate; positions: Set<number> }

export function displayText(text: string): string {
  // Never let stored prompts inject terminal escapes or cursor markers.
  return stripVTControlCharacters(text).replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/gu, " ").trim();
}

export function candidates(records: Candidate[], scope: Scope, cwd: string, sessionId: string): Candidate[] {
  const directory = resolve(cwd);
  const scoped = records.filter((r) => scope === "global" ||
    (scope === "directory" ? resolve(r.cwd) === directory : r.sessionId === sessionId));
  scoped.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) ||
    Number(b.source === "persisted") - Number(a.source === "persisted") || a.id.localeCompare(b.id));
  const persistedText = new Set(scoped.filter((record) => record.source === "persisted").map((record) => record.text));
  const seen = new Set<string>();
  return scoped.filter((record) => {
    if (seen.has(record.text) || (record.source === "branch" && persistedText.has(record.text))) return false;
    seen.add(record.text);
    return true;
  });
}

export function createSearch(items: Candidate[]): (query: string) => Match[] {
  const order = new Map(items.map((item, i) => [item.id, i]));
  const fzf = new Fzf<Candidate[]>(items, {
    selector: (item: Candidate) => item.label,
    tiebreakers: [(a: FzfResultItem<Candidate>, b: FzfResultItem<Candidate>) => (order.get(a.item.id) ?? 0) - (order.get(b.item.id) ?? 0)],
  });
  return (query) => query.trim() ? fzf.find(displayText(query)) : items.map((item) => ({ item, positions: new Set<number>() }));
}
