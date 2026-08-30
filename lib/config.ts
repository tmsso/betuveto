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
  // sql.json(), not a manual JSON.stringify(...)::jsonb cast: postgres.js's own jsonb
  // serialization already JSON-encodes the parameter, so stringifying it first would
  // double-encode — the column would end up holding the *string* "99" instead of the
  // number 99 (caught by querying the table directly after a PATCH silently no-op'd on
  // read). lib/admin.ts's logAdminAction uses the same helper for its jsonb column.
  await sql`
    insert into config (key, value) values (${key}, ${sql.json(value)})
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

/* --------------------------------------------------------------------------
 * UI config (ROADMAP Batch 10 item 14): admin-controlled visibility of the
 * player-facing start-screen controls, so a given audience can get a simplified
 * game without a redeploy. Stored in the same `config` table under `ui.`-prefixed
 * keys; kept as a separate interface/reader because the values are booleans and a
 * string, not the numbers-only shape GameConfig assumes.
 *
 * "Hidden also forces a default" (product decision): when a control is hidden,
 * `startGame` ignores the client's value (and any saved per-player preference) and
 * pins the configured default — a hidden control is a fixed axis for everyone, not
 * just a removed widget. The forcing lives in lib/game.ts's startGame().
 * ------------------------------------------------------------------------ */

const UI_WORDLIST_CODES = ["hu", "en"] as const;

export interface UiConfig {
  show_length_selector: boolean;
  show_wordlist_selector: boolean;
  show_easy_mode: boolean;
  /** Forced when show_length_selector is false. Any 5–10 board is currently available
   *  for both wordlists (ROADMAP 6.1), so the range check alone keeps startGame safe;
   *  a future wordlist with length gaps would need an availability check there too. */
  default_length: number;
  /** Forced when show_wordlist_selector is false. */
  default_wordlist: (typeof UI_WORDLIST_CODES)[number];
}

/** Also the fallback for any `ui.*` row missing or malformed in the table — same
 *  degrade-to-default behaviour as getConfig(). Defaults are "show everything", so an
 *  un-seeded / not-yet-migrated environment behaves exactly as before this feature. */
export const UI_CONFIG_DEFAULTS: UiConfig = {
  show_length_selector: true,
  show_wordlist_selector: true,
  show_easy_mode: true,
  default_length: 7,
  default_wordlist: "hu",
};

const UI_CONFIG_KEYS = Object.keys(UI_CONFIG_DEFAULTS) as (keyof UiConfig)[];
const UI_KEY_PREFIX = "ui.";

export function isUiConfigKey(key: string): key is keyof UiConfig {
  return (UI_CONFIG_KEYS as string[]).includes(key);
}

/** Per-key validation: a boolean key rejects a non-boolean, default_length must be an
 *  integer 5–10, default_wordlist must be a known code. Anything else → the compiled-in
 *  default for that one key (never a throw — a bad edit must not 500 game/start). */
function coerceUiValue<K extends keyof UiConfig>(key: K, raw: unknown): UiConfig[K] | undefined {
  if (key === "default_length") {
    return typeof raw === "number" && Number.isInteger(raw) && raw >= 5 && raw <= 10
      ? (raw as UiConfig[K])
      : undefined;
  }
  if (key === "default_wordlist") {
    return typeof raw === "string" && (UI_WORDLIST_CODES as readonly string[]).includes(raw)
      ? (raw as UiConfig[K])
      : undefined;
  }
  // the three show_* booleans
  return typeof raw === "boolean" ? (raw as UiConfig[K]) : undefined;
}

let uiCache: { value: UiConfig; expiresAt: number } | null = null;

export async function getUiConfig(): Promise<UiConfig> {
  const now = Date.now();
  if (uiCache && uiCache.expiresAt > now) return uiCache.value;

  const sql = db();
  const rows = await sql<{ key: string; value: unknown }[]>`
    select key, value from config where key like ${UI_KEY_PREFIX + "%"}
  `;
  const value = { ...UI_CONFIG_DEFAULTS };
  for (const row of rows) {
    const bare = row.key.slice(UI_KEY_PREFIX.length);
    if (!isUiConfigKey(bare)) continue;
    const coerced = coerceUiValue(bare, row.value);
    if (coerced !== undefined) (value[bare] as UiConfig[typeof bare]) = coerced;
  }
  uiCache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

export async function setUiConfigValue<K extends keyof UiConfig>(
  key: K,
  value: UiConfig[K],
): Promise<void> {
  const sql = db();
  await sql`
    insert into config (key, value) values (${UI_KEY_PREFIX + key}, ${sql.json(value)})
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
  uiCache = null;
}

export function coerceUiConfigValue<K extends keyof UiConfig>(
  key: K,
  raw: unknown,
): UiConfig[K] | undefined {
  return coerceUiValue(key, raw);
}

export async function listUiConfig(): Promise<
  Array<{ key: keyof UiConfig; value: UiConfig[keyof UiConfig]; default: UiConfig[keyof UiConfig] }>
> {
  const current = await getUiConfig();
  return UI_CONFIG_KEYS.map((key) => ({
    key,
    value: current[key],
    default: UI_CONFIG_DEFAULTS[key],
  }));
}
