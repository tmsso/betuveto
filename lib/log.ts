/**
 * ROADMAP Batch 10 item 9 — structured logging.
 *
 * One JSON object per line to stdout/stderr, so Vercel's log viewer (and anything that
 * later ingests it) can filter on `event`/`level`/fields instead of grepping prose. This
 * intentionally stays a thin wrapper over console — no transport, no buffering — because
 * on Vercel the platform already captures stdout/stderr per invocation; the only thing
 * missing was structure.
 */

type Level = "info" | "warn" | "error";

function emit(level: Level, event: string, fields: Record<string, unknown>): void {
  let line: string;
  try {
    line = JSON.stringify({ level, event, ts: new Date().toISOString(), ...fields });
  } catch {
    // A field with a circular reference must not turn a log call into a throw.
    line = JSON.stringify({ level, event, ts: new Date().toISOString(), log_serialize_error: true });
  }
  // Route errors to stderr, everything else to stdout — matches how the platform and
  // most log processors split the two.
  (level === "error" ? console.error : console.log)(line);
}

export const log = {
  info: (event: string, fields: Record<string, unknown> = {}) => emit("info", event, fields),
  warn: (event: string, fields: Record<string, unknown> = {}) => emit("warn", event, fields),
  error: (event: string, fields: Record<string, unknown> = {}) => emit("error", event, fields),
};

/** Flatten an unknown thrown value into log-safe fields (Error stack included). */
export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { err_name: err.name, err_message: err.message, err_stack: err.stack };
  }
  return { err_value: typeof err === "string" ? err : JSON.stringify(err) };
}
