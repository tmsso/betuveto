/**
 * ROADMAP Batch 10 item 9 — error tracking (Sentry), wired so it is completely inert
 * until someone sets SENTRY_DSN.
 *
 * `@sentry/node` is a heavy dependency (it pulls in OpenTelemetry), so it is loaded with
 * a dynamic `import()` on the *first* captured error rather than at module scope — a
 * cold start on the happy path never pays for it. With no DSN configured, `capture()` is
 * a couple of `if` checks and returns. The DSN itself is a normal manual env-var step for
 * the project owner (see .env.example); nothing here needs it to ship.
 */
import { log, serializeError } from "./log.js";

type SentryModule = typeof import("@sentry/node");

let sentryPromise: Promise<SentryModule | null> | null = null;

function loadSentry(): Promise<SentryModule | null> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return Promise.resolve(null);
  if (!sentryPromise) {
    sentryPromise = import("@sentry/node")
      .then((Sentry) => {
        Sentry.init({
          dsn,
          environment: process.env.VERCEL_ENV ?? "development",
          // No performance tracing — this is error tracking only, and tracing would add
          // per-request overhead to a 10s-budget serverless function.
          tracesSampleRate: 0,
        });
        return Sentry;
      })
      .catch((err) => {
        log.error("sentry_init_failed", serializeError(err));
        return null;
      });
  }
  return sentryPromise;
}

/**
 * Report an unexpected error. Awaitable and flushes with a short deadline, because a
 * serverless function can freeze the moment its response is sent — a fire-and-forget
 * send would often never leave the box. Safe to call unconditionally: a no-op when
 * SENTRY_DSN is unset.
 */
export async function captureException(
  err: unknown,
  context?: Record<string, unknown>,
): Promise<void> {
  const Sentry = await loadSentry();
  if (!Sentry) return;
  try {
    Sentry.captureException(err, context ? { extra: context } : undefined);
    await Sentry.flush(2000);
  } catch (flushErr) {
    log.error("sentry_capture_failed", serializeError(flushErr));
  }
}
