import { describe, expect, it } from "vitest";
import { planLink } from "../lib/account-link.js";

const anon = (id: string) => ({ id, authUserId: null });

describe("planLink (ROADMAP 8.1)", () => {
  it("links an unlinked device player when the account is new", () => {
    expect(planLink(anon("a"), null)).toEqual({ outcome: "linked", playerId: "a" });
  });
  it("is a no-op when the device is already on the account's player", () => {
    expect(planLink({ id: "a", authUserId: "u" }, { id: "a" })).toEqual({ outcome: "already_linked", playerId: "a" });
  });
  it("merges a new device's anonymous player into the account's player", () => {
    expect(planLink(anon("b"), { id: "a" })).toEqual({ outcome: "merged", playerId: "a", mergeFrom: "b" });
  });
  it("switches without merging when the device belongs to a different account", () => {
    expect(planLink({ id: "b", authUserId: "other" }, { id: "a" })).toEqual({ outcome: "switched", playerId: "a" });
  });
  it("switches when the device has no player yet", () => {
    expect(planLink(null, { id: "a" })).toEqual({ outcome: "switched", playerId: "a" });
  });
  it("creates a player for a new account when the device can't take it", () => {
    expect(planLink(null, null)).toEqual({ outcome: "created" });
    expect(planLink({ id: "b", authUserId: "other" }, null)).toEqual({ outcome: "created" });
  });
});
