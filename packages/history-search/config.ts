import { readFile } from "node:fs/promises";
import type { KeyId } from "@earendil-works/pi-tui";

export type Scope = "global" | "directory" | "session";

export const DEFAULT_EDITOR_KEYBINDINGS = {
  shortcut: "ctrl+r",
  older: "ctrl+r",
  newer: "ctrl+s",
  cycleScope: "tab",
} satisfies Record<string, KeyId>;

export interface Config {
  capture: boolean;
  scope: Scope;
  shortcut: KeyId;
  older: KeyId;
  newer: KeyId;
  cycleScope: KeyId;
  maxEntries: number;
  maxBytes: number;
  maxVisible: number;
}

export const DEFAULT_CONFIG: Config = {
  capture: true,
  scope: "directory",
  ...DEFAULT_EDITOR_KEYBINDINGS,
  maxEntries: 10000,
  maxBytes: 10 * 1024 * 1024,
  maxVisible: 12,
};

// Keep validation independent of terminal input parsing (parseKey parses bytes, not key IDs).
function isKey(value: unknown): value is KeyId {
  if (typeof value !== "string") return false;
  const parts = value.split("+");
  if (value.endsWith("+")) parts.splice(-2, 2, "+");
  const key = parts.pop() ?? "";
  return new Set(parts).size === parts.length &&
    parts.every((part) => ["ctrl", "alt", "shift", "super"].includes(part)) &&
    (/^[a-z0-9`\-=\[\]\\;',./!@#$%^&*()_+|~{}:<>?]$/.test(key) ||
      /^(escape|esc|enter|return|tab|space|backspace|delete|insert|clear|home|end|pageUp|pageDown|up|down|left|right|f[1-9]|f1[0-2])$/.test(key));
}

export function parseConfig(value: unknown): { config: Config; invalid: boolean } {
  const config = { ...DEFAULT_CONFIG };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { config, invalid: true };
  let invalid = false;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "capture" && typeof entry === "boolean") config.capture = entry;
    else if (key === "scope" && typeof entry === "string" && ["global", "directory", "session"].includes(entry)) config.scope = entry as Scope;
    else if ((key === "shortcut" || key === "older" || key === "newer" || key === "cycleScope") && isKey(entry)) config[key] = entry;
    else if ((key === "maxEntries" || key === "maxBytes" || key === "maxVisible") &&
      typeof entry === "number" && Number.isSafeInteger(entry) && entry > 0 &&
      entry <= (key === "maxEntries" ? 100000 : key === "maxBytes" ? 100 * 1024 * 1024 : 50)) config[key] = entry;
    else invalid = true;
  }
  return { config, invalid };
}

export async function loadConfig(path: string): Promise<{ config: Config; warning?: string }> {
  try {
    const { config, invalid } = parseConfig(JSON.parse(await readFile(path, "utf8")));
    return { config, warning: invalid ? "History search: invalid config values ignored." : undefined };
  } catch (error) {
    return {
      config: { ...DEFAULT_CONFIG },
      warning: (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : "History search: cannot read config; using defaults.",
    };
  }
}
