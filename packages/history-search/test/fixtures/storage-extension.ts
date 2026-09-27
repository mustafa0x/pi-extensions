import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { HistoryStore } from "../../history-store.ts";

export default function (pi: ExtensionAPI): void {
  // No model/provider calls: this fixture exercises only the real extension loader.
  pi.on("input", () => ({ action: "handled" }));
  pi.on("session_start", async (_event, ctx) => {
    const path = join(ctx.cwd, "history.jsonl");
    const limits = { maxEntries: 3, maxBytes: 10000 };
    const store = new HistoryStore(path, limits);
    for (let i = 0; i < 8; i++) {
      await store.append({ version: 1, id: String(i), text: `before clear ${i}`,
        timestamp: new Date().toISOString(), cwd: ctx.cwd, sessionId: "fixture" });
    }
    await store.clear();
    const reopened = new HistoryStore(path, limits);
    for (let i = 0; i < 4; i++) {
      await reopened.append({ version: 1, id: `after-${i}`, text: `after clear ${i}`,
        timestamp: new Date().toISOString(), cwd: ctx.cwd, sessionId: "fixture" });
    }
  });
}
