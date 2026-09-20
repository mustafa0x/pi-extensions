import { uuidv7 } from "@earendil-works/pi-ai";
import {
	copyToClipboard,
	DynamicBorder,
	generateSummaryWithUsage,
	getMarkdownTheme,
	type ExtensionAPI,
	type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Box, Container, Markdown, matchesKey, Text } from "@earendil-works/pi-tui";

interface LunaSummaryEntry {
	summary: string;
	generatedAt: number;
}

const DEFAULT_LUNA_PROVIDER = "openai-codex";
const DEFAULT_LUNA_MODEL = "gpt-5.6-luna";
const SUMMARY_TOKEN_BUDGET = 16_384;

async function copySummary(summary: string, ctx: ExtensionCommandContext): Promise<void> {
	try {
		await copyToClipboard(summary);
		ctx.ui.notify("Luna summary copied to clipboard", "info");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`Could not copy Luna summary: ${message}`, "error");
	}
}

async function showSummary(summary: string, ctx: ExtensionCommandContext): Promise<void> {
	if (ctx.mode === "rpc") {
		ctx.ui.notify(summary, "info");
		return;
	}
	if (ctx.mode !== "tui") {
		console.log(summary);
		return;
	}

	await ctx.ui.custom((_tui, theme, _keybindings, done) => {
		const container = new Container();
		const border = new DynamicBorder((text: string) => theme.fg("accent", text));
		container.addChild(border);
		container.addChild(new Text(theme.fg("accent", theme.bold("Luna Conversation Summary")), 1, 0));
		container.addChild(new Markdown(summary, 1, 1, getMarkdownTheme()));
		container.addChild(new Text(theme.fg("dim", "Press c to copy · Enter or Esc to close"), 1, 0));
		container.addChild(border);

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (data === "c") void copySummary(summary, ctx);
				if (matchesKey(data, "enter") || matchesKey(data, "escape")) done(undefined);
			},
		};
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerFlag("summarize-luna-provider", {
		description: "Provider used by /summarize-luna",
		type: "string",
	});
	pi.registerFlag("summarize-luna-model", {
		description: "Model used by /summarize-luna",
		type: "string",
	});

	let lunaProvider = DEFAULT_LUNA_PROVIDER;
	let lunaModel = DEFAULT_LUNA_MODEL;
	let latestSummary: string | undefined;

	pi.registerEntryRenderer<LunaSummaryEntry>("luna-summary", (entry, { expanded }, theme) => {
		const data = entry.data;
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		if (!data) {
			box.addChild(new Text(theme.fg("warning", "Luna summary data unavailable"), 0, 0));
			return box;
		}
		box.addChild(
			new Text(
				`${theme.fg("accent", "Luna summary saved")} · /summary-luna-show · /summary-luna-copy`,
				0,
				0,
			),
		);
		if (expanded) box.addChild(new Markdown(data.summary, 0, 1, getMarkdownTheme()));
		return box;
	});

	pi.on("session_start", (_event, ctx) => {
		lunaProvider =
			(pi.getFlag("summarize-luna-provider") as string | undefined) ||
			process.env.PI_SUMMARIZE_LUNA_PROVIDER ||
			DEFAULT_LUNA_PROVIDER;
		lunaModel =
			(pi.getFlag("summarize-luna-model") as string | undefined) ||
			process.env.PI_SUMMARIZE_LUNA_MODEL ||
			DEFAULT_LUNA_MODEL;
		latestSummary = undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== "luna-summary") continue;
			const data = entry.data as LunaSummaryEntry | undefined;
			if (data && typeof data.summary === "string") latestSummary = data.summary;
		}
	});

	pi.registerCommand("summary-luna-show", {
		description: "Show the latest Luna conversation summary",
		handler: async (_args, ctx) => {
			if (!latestSummary) {
				ctx.ui.notify("No Luna summary found in this session", "warning");
				return;
			}
			await showSummary(latestSummary, ctx);
		},
	});

	pi.registerCommand("summary-luna-copy", {
		description: "Copy the latest Luna conversation summary",
		handler: async (_args, ctx) => {
			if (!latestSummary) {
				ctx.ui.notify("No Luna summary found in this session", "warning");
				return;
			}
			await copySummary(latestSummary, ctx);
		},
	});

	pi.registerCommand("summarize-luna", {
		description: "Summarize the current conversation with Luna at xhigh reasoning",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();

			const model = ctx.modelRegistry.find(lunaProvider, lunaModel);
			if (!model) {
				ctx.ui.notify(`Model ${lunaProvider}/${lunaModel} is unavailable`, "error");
				return;
			}
			if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
				ctx.ui.notify(`No authentication configured for ${lunaProvider}/${lunaModel}`, "error");
				return;
			}

			const messages = ctx.sessionManager
				.buildSessionContext()
				.messages.filter((message) => message.role !== "system");
			if (messages.length === 0) {
				ctx.ui.notify("No conversation to summarize", "warning");
				return;
			}

			ctx.ui.notify(`Summarizing with ${lunaModel} at xhigh...`, "info");

			try {
				const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
				if (!auth.ok) throw new Error(auth.error);
				const requestModel = auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model;
				const result = await generateSummaryWithUsage(
					messages,
					requestModel,
					SUMMARY_TOKEN_BUDGET,
					auth.apiKey,
					auth.headers,
					undefined,
					args.trim() || undefined,
					undefined,
					"xhigh",
					undefined,
					auth.env,
					undefined,
					undefined,
					uuidv7(),
				);
				latestSummary = result.text;
				pi.appendEntry<LunaSummaryEntry>("luna-summary", {
					summary: result.text,
					generatedAt: Date.now(),
				});
				await showSummary(result.text, ctx);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Luna summary failed: ${message}`, "error");
			}
		},
	});
}
