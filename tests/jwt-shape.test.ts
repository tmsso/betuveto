import { afterEach, describe, expect, it, vi } from "vitest";
import { isJwtShaped } from "../lib/jwt-shape.js";
// The frontend copy (plain JS, no build step needed for vitest). Both must agree.
import { isJwtShaped as isJwtShapedFrontend } from "../frontend/src/admin/jwtShape.js";

const JWT = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJlXy0";
const CASES: [unknown, boolean][] = [
  [JWT, true],
  // Better Auth's opaque session token: one segment, the case seen in production.
  ["Q2x1dGNoU2Vzc2lvblRva2VuMTIzNDU2Nzg5MA", false],
  ["a.b", false],
  ["a.b.c.d", false],
  ["a..c", false],
  ["a.b.c=", false],
  ["a.b.c ", false],
  ["", false],
  [null, false],
  [undefined, false],
  [42, false],
];

describe("isJwtShaped", () => {
  it.each(CASES)("server: %j -> %s", (value, expected) => {
    expect(isJwtShaped(value)).toBe(expected);
  });
  it.each(CASES)("frontend copy agrees: %j -> %s", (value, expected) => {
    expect(isJwtShapedFrontend(value)).toBe(expected);
  });
});

describe("verifyNeonAuthToken with a non-JWT bearer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.NEON_AUTH_JWKS_URL;
  });

  it("returns null and logs a warning without the token value", async () => {
    // A JWKS URL makes the verifier "configured"; jose fetches it lazily, and the shape
    // check returns before any fetch, so nothing goes over the network.
    process.env.NEON_AUTH_JWKS_URL = "https://auth.invalid/jwks";
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { verifyNeonAuthToken } = await import("../lib/neon-auth.js");

    const opaque = "opaqueSessionTokenValue123";
    expect(await verifyNeonAuthToken(opaque)).toBeNull();

    expect(err).not.toHaveBeenCalled();
    const lines = out.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("neon_auth_not_jwt") && l.includes('"warn"'))).toBe(true);
    expect(lines.join("\n")).not.toContain(opaque);
  });
});
