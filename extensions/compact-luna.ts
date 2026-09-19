import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { compact } from "@earendil-works/pi-coding-agent";

const LUNA_PROVIDER = "openai-codex";
const LUNA_MODEL = "gpt-5.6-luna";

export default function (pi: ExtensionAPI) {
	let pendingLunaCompaction = false;
	let lunaCompactionError: Error | undefined;

	pi.on("session_before_compact", async (event, ctx) => {
		if (!pendingLunaCompaction || event.reason !== "manual") return;
		pendingLunaCompaction = false;

		const model = ctx.modelRegistry.find(LUNA_PROVIDER, LUNA_MODEL);
		if (!model) {
			lunaCompactionError = new Error(`Model ${LUNA_PROVIDER}/${LUNA_MODEL} is unavailable`);
			return { cancel: true };
		}

		try {
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) throw new Error(auth.error);
			const requestModel = auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model;
			const result = await compact(
				event.preparation,
				requestModel,
				auth.apiKey,
				auth.headers,
				event.customInstructions,
				event.signal,
				"xhigh",
				undefined,
				auth.env,
			);
			return { compaction: result };
		} catch (error) {
			lunaCompactionError = error instanceof Error ? error : new Error(String(error));
			return { cancel: true };
		}
	});

	pi.registerCommand("compact-luna", {
		description: "Compact the current session with Luna at xhigh reasoning",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();

			const model = ctx.modelRegistry.find(LUNA_PROVIDER, LUNA_MODEL);
			if (!model) {
				ctx.ui.notify(`Model ${LUNA_PROVIDER}/${LUNA_MODEL} is unavailable`, "error");
				return;
			}
			if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
				ctx.ui.notify(`No authentication configured for ${LUNA_PROVIDER}/${LUNA_MODEL}`, "error");
				return;
			}

			pendingLunaCompaction = true;
			lunaCompactionError = undefined;
			ctx.ui.notify(`Compacting with ${LUNA_MODEL} at xhigh...`, "info");
			ctx.compact({
				customInstructions: args.trim() || undefined,
				onComplete: () => {
					pendingLunaCompaction = false;
					lunaCompactionError = undefined;
					ctx.ui.notify("Luna compaction completed", "info");
				},
				onError: (error) => {
					pendingLunaCompaction = false;
					const failure = lunaCompactionError ?? error;
					lunaCompactionError = undefined;
					ctx.ui.notify(`Luna compaction failed: ${failure.message}`, "error");
				},
			});
		},
	});
}
