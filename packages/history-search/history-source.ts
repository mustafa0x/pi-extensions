import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { type Candidate, displayText } from "./search.ts";

export const CAPTURE_BOUNDARY = "history-search-boundary-v1";

export function branchFallback(entries: SessionEntry[], cwd: string, sessionId: string): Candidate[] {
  const records: Candidate[] = [];
  for (const entry of entries) {
    // A durable marker survives reload/resume. Never offer expanded messages from
    // after capture started, even if a raw-history write failed or was pruned.
    if (entry.type === "custom" && entry.customType === CAPTURE_BOUNDARY) break;
    if (entry.type !== "message" || entry.message.role !== "user") continue;
    const content = entry.message.content;
    const text = typeof content === "string" ? content : content
      .filter((block) => block.type === "text").map((block) => block.text).join("\n");
    if (!text.trim()) continue;
    records.push({ version: 1, id: `branch:${entry.id}`, timestamp: entry.timestamp, cwd, sessionId, text, label: displayText(text), source: "branch" });
  }
  return records;
}
