/**
 * Unit coverage for the shared HTTP adapter's error path (ROADMAP Batch 10 item 9:
 * structured logging + Sentry). These run everywhere — no deployment needed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isCrossSiteWrite, methodHandler } from "../lib/http.js";

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

describe("isCrossSiteWrite (pre-Play hardening)", () => {
  const req = (method: string, headers: Record<string, string>) => ({ method, headers });
  const host = { host: "betuveto.tmsso.com" };

  it("never refuses a read", () => {
    expect(isCrossSiteWrite(req("GET", { "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isCrossSiteWrite(req("HEAD", { origin: "https://example.com", ...host }))).toBe(false);
  });

  it("trusts the browser's own label when there is one", () => {
    expect(isCrossSiteWrite(req("POST", { "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(isCrossSiteWrite(req("POST", { "sec-fetch-site": "none" }))).toBe(false);
    expect(isCrossSiteWrite(req("POST", { "sec-fetch-site": "cross-site" }))).toBe(true);
    // The case SameSite=Lax does not cover: a sibling subdomain.
    expect(isCrossSiteWrite(req("DELETE", { "sec-fetch-site": "same-site" }))).toBe(true);
    // E2E: the page is on localhost and vite's proxy forwards to the deployment, so Origin
    // and host disagree — but the browser said same-origin, and that is what counts.
    expect(
      isCrossSiteWrite(req("POST", { "sec-fetch-site": "same-origin", origin: "http://localhost:4173", ...host })),
    ).toBe(false);
  });

  it("falls back to Origin vs. host, and lets header-less clients through", () => {
    expect(isCrossSiteWrite(req("POST", { origin: "https://betuveto.tmsso.com", ...host }))).toBe(false);
    expect(isCrossSiteWrite(req("POST", { origin: "https://other.tmsso.com", ...host }))).toBe(true);
    expect(isCrossSiteWrite(req("PATCH", { origin: "null", ...host }))).toBe(true);
    expect(isCrossSiteWrite(req("POST", { origin: "https://a.example", "x-forwarded-host": "a.example", host: "internal" }))).toBe(false);
    expect(isCrossSiteWrite(req("POST", { ...host }))).toBe(false); // curl, the contract suite
  });
});
