import { DatabaseSync } from "node:sqlite";
import { displayText } from "./search-core.mjs";
/** @import { Candidate, SearchOptions } from "./search.ts" */

// Bound an unexpectedly large archive without changing the user's database.
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 100000;

/** @param {SearchOptions} options @returns {{ records: Candidate[]; warning?: string }} */
export function readAgentsView(options) {
  if (!options.databasePath) return { records: [] };
  /** @type {DatabaseSync | undefined} */
  let db;
  try {
    db = new DatabaseSync(options.databasePath, { readOnly: true });
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=500; PRAGMA cache_size=-4096;");
    // A prepare failure is also the schema compatibility check. Never migrate or
    // create indexes. AgentsView 0.44 maps native IDs to pi:<header-id>.
    const statement = db.prepare(`
      SELECT m.source_uuid, m.content, m.timestamp, s.cwd, s.id AS session_id
      FROM sessions s JOIN messages m ON m.session_id = s.id
      WHERE s.agent = 'pi' AND s.deleted_at IS NULL
        AND m.role = 'user' AND m.source_type = 'user' AND m.is_system = 0
      ORDER BY m.timestamp DESC, m.id DESC
      LIMIT ?
    `);
    /** @type {Candidate[]} */
    const records = [];
    let bytes = 0;
    let skipped = 0;
    let scanned = 0;
    for (const row of statement.iterate(MAX_ENTRIES + 1)) {
      if (++scanned > MAX_ENTRIES) return { records, warning: "AgentsView history limited to 100,000 messages / 64 MiB." };
      if (typeof row.content !== "string" || !row.content.trim()) continue;
      if (typeof row.session_id !== "string" || !row.session_id.startsWith("pi:") ||
        typeof row.source_uuid !== "string" || !row.source_uuid ||
        typeof row.cwd !== "string" || !row.cwd || typeof row.timestamp !== "string" ||
        !Number.isFinite(Date.parse(row.timestamp))) { skipped++; continue; }
      const sessionId = row.session_id.slice(3);
      if (sessionId === options.sessionId && options.branchCutoff && Date.parse(row.timestamp) >= Date.parse(options.branchCutoff)) continue;
      bytes += Buffer.byteLength(row.content);
      if (bytes > MAX_BYTES) {
        return { records, warning: "AgentsView history limited to 100,000 messages / 64 MiB." };
      }
      records.push({ version: 1, id: `agentsview:${row.session_id}:${row.source_uuid}`, text: row.content,
        timestamp: row.timestamp, cwd: row.cwd, sessionId, source: "agentsview", label: displayText(row.content) });
    }
    return { records, warning: skipped ? "Some AgentsView messages have missing or incompatible metadata." : undefined };
  } catch {
    return { records: [], warning: "AgentsView unavailable or incompatible; using raw history and current branch." };
  } finally { db?.close(); }
}
