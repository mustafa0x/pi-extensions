import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, type Scope } from "./config.ts";
import { branchFallback, CAPTURE_BOUNDARY } from "./history-source.ts";
import { HistoryStore } from "./history-store.ts";
import { displayText, type Candidate } from "./search.ts";
import { HistorySelector } from "./selector.ts";

export default async function historySearch(pi: ExtensionAPI): Promise<void> {
  const directory = join(getAgentDir(), "history-search");
  const { config, warning } = await loadConfig(join(directory, "config.json"));
  const store = new HistoryStore(join(directory, "history.jsonl"), config);
  let open = false;
  let warned = false;

  function warn(ctx: ExtensionContext, message: string): void {
    if (warned || !ctx.hasUI) return;
    warned = true;
    ctx.ui.notify(`History search: ${message}`, "warning");
  }

  function ensureBoundary(ctx: ExtensionContext): void {
    if (!ctx.sessionManager.getBranch().some((entry) => entry.type === "custom" && entry.customType === CAPTURE_BOUNDARY)) {
      pi.appendEntry(CAPTURE_BOUNDARY, {});
    }
  }

  pi.on("session_start", (_event, ctx) => {
    if (warning && ctx.hasUI) ctx.ui.notify(warning, "warning");
    if (ctx.mode === "tui") ensureBoundary(ctx);
  });

  pi.on("input", (event, ctx) => {
    if (config.capture && event.source === "interactive" && event.text.trim()) {
      try {
        // Tree navigation can put the active branch before its previous boundary.
        ensureBoundary(ctx);
        // Never await disk/lock operations on the prompt submission path.
        void store.append({ version: 1, id: randomUUID(), timestamp: new Date().toISOString(),
          cwd: ctx.cwd, sessionId: ctx.sessionManager.getSessionId(), text: event.text })
          .catch(() => warn(ctx, "could not save a prompt (storage unavailable or prompt over 64 KiB). Submission is unaffected."));
      } catch { warn(ctx, "could not capture a prompt. Submission is unaffected."); }
    }
    return { action: "continue" };
  });
  pi.on("session_shutdown", async () => { await store.flush(); });

  async function show(ctx: ExtensionContext, scope: Scope = config.scope): Promise<void> {
    if (ctx.mode !== "tui") { ctx.ui.notify("History search requires interactive terminal mode.", "warning"); return; }
    if (open) return;
    open = true;
    const sessionId = ctx.sessionManager.getSessionId();
    const draft = ctx.ui.getEditorText();
    try {
      await store.flush();
      let records: Candidate[] = [];
      try { records = (await store.read()).map((record) => ({ ...record, source: "persisted", label: displayText(record.text) })); }
      catch { warn(ctx, "cannot read stored history; showing transcript fallback only."); }
      if (ctx.sessionManager.getSessionId() !== sessionId) return;
      records.push(...branchFallback(ctx.sessionManager.getBranch(), ctx.cwd, sessionId));
      let requestRender: (() => void) | undefined;
      const selected = await ctx.ui.custom<string | undefined>(
        (tui, theme, keys, done) => {
          requestRender = () => tui.requestRender();
          return new HistorySelector(tui, theme, keys, done, records, { ...config, scope }, ctx.cwd, sessionId);
        },
        { overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "100%" } },
      );
      if (selected !== undefined && ctx.sessionManager.getSessionId() === sessionId) {
        // An extension or dequeue action may have replaced the composer while loading.
        if (ctx.ui.getEditorText() !== draft) ctx.ui.notify("History search: draft changed; selection was not applied.", "warning");
        else {
          ctx.ui.setEditorText(selected);
          // setEditorText does not schedule a render after the overlay closes.
          requestRender?.();
        }
      }
    } finally { open = false; }
  }

  pi.registerShortcut(config.shortcut, { description: "Search prompt history", handler: (ctx) => show(ctx) });
  pi.registerCommand("history-search", {
    description: "Search prompt history [directory|session|global]",
    handler: async (args, ctx) => {
      const scope = args.trim();
      if (scope && scope !== "directory" && scope !== "session" && scope !== "global") {
        ctx.ui.notify("Usage: /history-search [directory|session|global]", "warning");
        return;
      }
      await show(ctx, scope ? scope as Scope : config.scope);
    },
  });
  pi.registerCommand("history-search-clear", {
    description: "Clear stored raw history globally (does not delete Pi transcripts)",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI || !await ctx.ui.confirm("Clear prompt history?", "Delete all stored raw prompts, across directories and sessions? Pi transcripts are not deleted.")) return;
      try {
        await store.clear();
        ctx.ui.notify("Stored prompt history cleared. Transcript fallback is still available.", "info");
      } catch { ctx.ui.notify("History search: could not clear stored history.", "error"); }
    },
  });
}
