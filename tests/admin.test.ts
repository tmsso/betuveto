/**
 * ROADMAP 11.8 — authorizeAdmin must tell "denied" (null) apart from "authorized by the
 * shared token" ({ adminId: null }), and attribute a Magic Link session to its players.id.
 * The Neon Auth verifier and the DB are stubbed: a real session token can't be minted in
 * a test, so the Magic Link path is covered here and not by the contract suite.
 */
import type { VercelRequest } from "@vercel/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyNeonAuthToken = vi.fn();
const playerRows: { id: string; is_admin: boolean }[][] = [];

vi.mock("../lib/neon-auth.js", () => ({ verifyNeonAuthToken }));
vi.mock("../lib/db.js", () => ({
  // The tagged-template `sql` only needs to hand back the next queued result set.
  db: () => async () => playerRows.shift() ?? [],
}));

const { authorizeAdmin } = await import("../lib/admin.js");

const ADMIN_PLAYER_ID = "11111111-1111-4111-8111-111111111111";

function request(headers: Record<string, string>): VercelRequest {
  return { headers } as unknown as VercelRequest;
}

describe("authorizeAdmin", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_TOKEN", "the-shared-token");
    verifyNeonAuthToken.mockReset();
    playerRows.length = 0;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("denies a request with no credentials", async () => {
    expect(await authorizeAdmin(request({}))).toBeNull();
  });

  it("denies a wrong shared token", async () => {
    expect(await authorizeAdmin(request({ "x-admin-token": "nope" }))).toBeNull();
  });

  it("authorizes the shared token with no per-admin identity", async () => {
    expect(await authorizeAdmin(request({ "x-admin-token": "the-shared-token" }))).toEqual({
      adminId: null,
    });
    // No Bearer header, so the session branch never calls the verifier.
    expect(verifyNeonAuthToken).not.toHaveBeenCalled();
  });

  it("attributes a Magic Link session to the linked admin player", async () => {
    verifyNeonAuthToken.mockResolvedValue({ userId: "neon-user-1" });
    playerRows.push([{ id: ADMIN_PLAYER_ID, is_admin: true }]);
    expect(await authorizeAdmin(request({ authorization: "Bearer jwt" }))).toEqual({
      adminId: ADMIN_PLAYER_ID,
    });
  });

  it("denies a valid session whose player is not an admin", async () => {
    verifyNeonAuthToken.mockResolvedValue({ userId: "neon-user-2" });
    playerRows.push([{ id: ADMIN_PLAYER_ID, is_admin: false }]);
    expect(await authorizeAdmin(request({ authorization: "Bearer jwt" }))).toBeNull();
  });

  it("prefers the named session over the shared token when both are sent", async () => {
    verifyNeonAuthToken.mockResolvedValue({ userId: "neon-user-1" });
    playerRows.push([{ id: ADMIN_PLAYER_ID, is_admin: true }]);
    const admin = await authorizeAdmin(
      request({ authorization: "Bearer jwt", "x-admin-token": "the-shared-token" }),
    );
    expect(admin).toEqual({ adminId: ADMIN_PLAYER_ID });
  });

  it("falls back to the token when the session is invalid", async () => {
    verifyNeonAuthToken.mockResolvedValue(null);
    const admin = await authorizeAdmin(
      request({ authorization: "Bearer expired", "x-admin-token": "the-shared-token" }),
    );
    expect(admin).toEqual({ adminId: null });
  });
});
