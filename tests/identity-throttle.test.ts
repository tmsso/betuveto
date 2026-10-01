import type { VercelRequest } from "@vercel/node";
import { describe, expect, it } from "vitest";
import { clientAddress } from "../lib/identity-throttle.js";

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
