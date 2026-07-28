/**
 * Admin-editable gameplay knobs (ROADMAP Batch 5.2 item 2): hint cost, completion bonus
 * multiplier, the anti-cheat guess rate limit, minimum word length, and the timer
 * formula's two constants. These used to be plain `const`s in lib/game.ts, lib/hints.ts
 * and lib/words.ts; they now live in the `config` table (migrations/0005_config.sql) so
 * an admin can tune them without a redeploy.
 *
 * Read path is cached at module scope for CACHE_TTL_MS: `getConfig()` is called on every
 * guess/hint/game-start, and a DB round trip on every single guess would be a needless
 * hot-path cost for values that change rarely. The honest cost of this: a warm serverless
 * instance can hold a stale value for up to CACHE_TTL_MS after an admin edit — an edit
 * only invalidates the *one* instance that happened to serve the PATCH, every other warm
 * instance still catches up on its own schedule. "Takes effect without redeploy" (the
 * ROADMAP's own acceptance bar) is satisfied — just on the order of tens of seconds, not
 * instantly everywhere.
 */
import { db } from "./db.js";

export interface GameConfig {
  hint_cost: number;
  completion_bonus_multiplier: number;
  guess_rate_limit_per_second: number;
  min_word_length: number;
  timer_base_seconds: number;
  timer_seconds_per_extra_length: number;
}

/** Also the seed values in migrations/0005_config.sql — keep the two in sync if either changes. */
export const CONFIG_DEFAULTS: GameConfig = {
  hint_cost: 10,
  completion_bonus_multiplier: 1,
  guess_rate_limit_per_second: 3,
  min_word_length: 3,
  timer_base_seconds: 120,
  timer_seconds_per_extra_length: 15,
};

const CONFIG_KEYS = Object.keys(CONFIG_DEFAULTS) as (keyof GameConfig)[];

export function isConfigKey(key: string): key is keyof GameConfig {
  return (CONFIG_KEYS as string[]).includes(key);
}

const CACHE_TTL_MS = 30_000;
let cache: { value: GameConfig; expiresAt: number } | null = null;

/**
 * Falls back to the compiled-in default for any key missing or malformed in the table —
 * a bad edit (or a not-yet-migrated environment) degrades one knob to its old constant
 * value rather than 500ing every guess in the game.
 */
export async function getConfig(): Promise<GameConfig> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;

  const sql = db();
  const rows = await sql<{ key: string; value: unknown }[]>`select key, value from config`;
  const value = { ...CONFIG_DEFAULTS };
  for (const row of rows) {
    if (isConfigKey(row.key) && typeof row.value === "number" && Number.isFinite(row.value)) {
      value[row.key] = row.value;
    }
  }
  cache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

/** Admin write path: upserts one key. Only clears *this* warm instance's cache — see the
 *  module doc comment for why other instances still take up to CACHE_TTL_MS to catch up. */
export async function setConfigValue(key: keyof GameConfig, value: number): Promise<void> {
  const sql = db();
  await sql`
    insert into config (key, value) values (${key}, ${JSON.stringify(value)}::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
  cache = null;
}

export async function listConfig(): Promise<
  Array<{ key: keyof GameConfig; value: number; default: number }>
> {
  const current = await getConfig();
  return CONFIG_KEYS.map((key) => ({ key, value: current[key], default: CONFIG_DEFAULTS[key] }));
}
