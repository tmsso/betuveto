import type { VercelRequest } from "@vercel/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allowIdentityMint, clientAddress } from "../lib/identity-throttle.js";

const req = (headers: Record<string, string | string[]>) => ({ headers }) as unknown as VercelRequest;

describe("clientAddress (ROADMAP 12.6)", () => {
  it("prefers x-real-ip", () => {
    expect(clientAddress(req({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }))).toBe(
      "203.0.113.7",
    );
  });

  it("falls back to the first x-forwarded-for hop", () => {
    expect(clientAddress(req({ "x-forwarded-for": " 198.51.100.1 , 10.0.0.1" }))).toBe("198.51.100.1");
  });

  it("is null when neither header is present (local dev)", () => {
    expect(clientAddress(req({}))).toBeNull();
  });
});

describe("allowIdentityMint on previews (D-14a)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("lets every mint through on a preview deployment, without touching the database", async () => {
    vi.stubEnv("ANON_SESSION_SECRET", "test-secret");
    vi.stubEnv("VERCEL_ENV", "preview");
    // No DATABASE_URL is configured here: reaching the config or the table would throw,
    // so a `true` answer proves the preview branch returns before any database access.
    await expect(allowIdentityMint(req({ "x-real-ip": "203.0.113.7" }))).resolves.toBe(true);
  });
});
