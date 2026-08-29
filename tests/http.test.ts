/**
 * Unit coverage for the shared HTTP adapter's error path (ROADMAP Batch 10 item 9:
 * structured logging + Sentry). These run everywhere — no deployment needed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { methodHandler } from "../lib/http.js";

function mockRes() {
  const res: any = {};
  res.statusCode = 0;
  res.body = undefined;
  res.headers = {} as Record<string, string>;
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  res.setHeader = vi.fn((k: string, v: string) => {
    res.headers[k] = v;
  });
  return res;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SENTRY_DSN;
});

describe("methodHandler error path", () => {
  it("turns an unexpected throw into a bare 500 and one structured stderr line", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = methodHandler({
      GET: async () => {
        throw new Error("boom");
      },
    });
    const res = mockRes();
    await handler({ method: "GET", url: "/api/v1/thing" } as any, res);

    expect(res.status).toHaveBeenCalledWith(500);
    // The client never sees the error itself — a stack could leak the target word.
    expect(res.body).toEqual({ detail: "Internal error." });

    const line = errSpy.mock.calls.at(-1)?.[0] as string;
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      level: "error",
      event: "unhandled_route_error",
      method: "GET",
      url: "/api/v1/thing",
      err_message: "boom",
    });
    expect(typeof parsed.ts).toBe("string");
  });

  it("does not touch Sentry when SENTRY_DSN is unset (captureException is inert)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = methodHandler({
      GET: async () => {
        throw new Error("boom");
      },
    });
    const res = mockRes();
    // Would throw "Cannot find module '@sentry/node'"-style only if it tried to import it;
    // with no DSN loadSentry() short-circuits before the dynamic import.
    await expect(handler({ method: "GET", url: "/x" } as any, res)).resolves.toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("still serves a normal reply and its headers untouched", async () => {
    const handler = methodHandler({
      GET: async () => ({ status: 200, body: { ok: true }, headers: { "X-Test": "1" } }),
    });
    const res = mockRes();
    await handler({ method: "GET", url: "/x" } as any, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers["X-Test"]).toBe("1");
  });
});
