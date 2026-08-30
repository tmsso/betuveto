/** Admin HTTP surface for lib/config.ts (ROADMAP Batch 5.2 item 2, Batch 10 item 14). */
import { logAdminAction } from "./admin.js";
import {
  type GameConfig,
  type UiConfig,
  coerceUiConfigValue,
  isConfigKey,
  isUiConfigKey,
  listConfig,
  listUiConfig,
  setConfigValue,
  setUiConfigValue,
} from "./config.js";
import type { Reply } from "./game.js";

export async function getConfigList(): Promise<Reply> {
  return { status: 200, body: { config: await listConfig() } };
}

export async function updateConfigValue(key: string, rawValue: unknown): Promise<Reply> {
  if (!isConfigKey(key)) {
    return { status: 404, body: { detail: `Unknown config key: ${key}` } };
  }
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue) || rawValue < 0) {
    return { status: 422, body: { detail: "value must be a non-negative finite number." } };
  }

  await setConfigValue(key as keyof GameConfig, rawValue);
  await logAdminAction("update_config", { key, value: rawValue });
  return { status: 200, body: { key, value: rawValue } };
}

/** ROADMAP Batch 10 item 14 — player-facing control visibility. */
export async function getUiConfigList(): Promise<Reply> {
  return { status: 200, body: { config: await listUiConfig() } };
}

export async function updateUiConfigValue(key: string, rawValue: unknown): Promise<Reply> {
  if (!isUiConfigKey(key)) {
    return { status: 404, body: { detail: `Unknown UI config key: ${key}` } };
  }
  const value = coerceUiConfigValue(key as keyof UiConfig, rawValue);
  if (value === undefined) {
    return {
      status: 422,
      body: {
        detail:
          key === "default_length"
            ? "default_length must be an integer between 5 and 10."
            : key === "default_wordlist"
              ? "default_wordlist must be a known wordlist code."
              : `${key} must be true or false.`,
      },
    };
  }

  await setUiConfigValue(key as keyof UiConfig, value);
  await logAdminAction("update_ui_config", { key, value });
  return { status: 200, body: { key, value } };
}
