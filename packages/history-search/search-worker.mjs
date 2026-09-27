import { readAgentsView } from "./agentsview.mjs";
import { candidates, createSearch } from "./search-core.mjs";
/** @import { Candidate, SearchOptions, SearchRequest, SearchResponse, Match } from "./search.ts" */
/** @import { Scope } from "./config.ts" */

/** @type {SearchOptions | undefined} */
let options;
/** @type {Scope | undefined} */
let currentScope;
/** @type {Candidate[]} */
let items = [];
/** @type {((query: string) => Match[]) | undefined} */
let search;
/** @type {Match[]} */
let matches = [];
let previousQuery = "";
/** @type {string | undefined} */
let warning;

process.on("disconnect", () => process.exit(0));
process.on("message", (data) => {
  const message = /** @type {SearchRequest} */ (data);
  if (message.type === "init") {
    options = message.options;
    const archive = readAgentsView(options);
    options.records = options.records.concat(archive.records);
    warning = archive.warning;
    return;
  }
  if (message.type !== "search" || !options) return;
  /** @type {SearchResponse} */
  let response;
  try {
    if (currentScope !== message.scope) {
      items = candidates(options.records, message.scope, options.cwd, options.sessionId);
      search = undefined;
      matches = [];
      previousQuery = "";
      currentScope = message.scope;
    }
    const offset = Math.max(0, Math.floor(message.offset));
    if (!message.query.trim()) {
      // Opening history needs only recency, not an expensive fuzzy index.
      response = { id: message.id, warning, total: items.length, offset,
        matches: items.slice(offset, offset + 100).map((item) => ({ item, positions: [] })) };
    } else {
      if (!search) search = createSearch(items);
      if (message.query !== previousQuery) {
        matches = search(message.query);
        previousQuery = message.query;
      }
      response = { id: message.id, warning, total: matches.length, offset,
        matches: matches.slice(offset, offset + 100).map((match) => ({ item: match.item, positions: [...match.positions] })) };
    }
  } catch {
    response = { id: message.id, matches: [], total: 0, offset: 0, error: "History search failed. Close and reopen the selector." };
  }
  process.send?.(response);
});
