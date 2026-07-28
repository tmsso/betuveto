/** Admin HTTP surface for lib/config.ts (ROADMAP Batch 5.2 item 2). */
import { logAdminAction } from "./admin.js";
import { type GameConfig, isConfigKey, listConfig, setConfigValue } from "./config.js";
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
