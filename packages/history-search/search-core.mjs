import { resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { Fzf } from "fzf";
/** @import { Candidate, Match } from "./search.ts" */
/** @import { Scope } from "./config.ts" */

/** @param {string} text */
export function displayText(text) {
  return stripVTControlCharacters(text).replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/gu, " ").trim();
}

/** @param {Candidate[]} records @param {Scope} scope @param {string} cwd @param {string} sessionId */
export function candidates(records, scope, cwd, sessionId) {
  const directory = resolve(cwd);
  const scoped = records.filter((r) => scope === "global" ||
    (scope === "directory" ? resolve(r.cwd) === directory : r.sessionId === sessionId));
  scoped.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) ||
    Number(b.source === "persisted") - Number(a.source === "persisted") || a.id.localeCompare(b.id));
  const persistedText = new Set(scoped.filter((record) => record.source === "persisted").map((record) => record.text));
  const seen = new Set();
  return scoped.filter((record) => {
    if (seen.has(record.text) || (record.source !== "persisted" && persistedText.has(record.text))) return false;
    seen.add(record.text);
    return true;
  });
}

/** @param {Candidate[]} items @returns {(query: string) => Match[]} */
export function createSearch(items) {
  const order = new Map(items.map((item, i) => [item.id, i]));
  const fzf = new Fzf(items, {
    selector: (/** @type {Candidate} */ item) => item.label,
    tiebreakers: [(/** @type {Match} */ a, /** @type {Match} */ b) => (order.get(a.item.id) ?? 0) - (order.get(b.item.id) ?? 0)],
  });
  return (query) => query.trim() ? fzf.find(displayText(query)) : items.map((item) => ({ item, positions: new Set() }));
}
