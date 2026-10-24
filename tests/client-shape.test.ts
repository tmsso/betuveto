/**
 * Unit tests for the 11.19 shape checker (tests/client-shape.ts). No network: the live
 * check runs inside the contract suite's call().
 */
import { describe, expect, it } from "vitest";
import { clientInterfaces, clientShapeViolations, missingFields } from "./client-shape.js";

const SOURCE = `
export interface Entry { name: string | null; score: number; note?: string }
export interface Result {
  id: string;
  top: Entry[];
  best: { score: number; at: number } | null;
  extra?: { flag: boolean };
}
`;
const fixture = clientInterfaces(SOURCE);

describe("missingFields", () => {
  it("accepts a complete response, with null and absent optional fields", () => {
    const ok = { id: "x", top: [{ name: null, score: 1 }], best: null };
    expect(missingFields(ok, "Result", fixture)).toEqual([]);
  });

  it("reports a missing required field, including inside arrays and inline objects", () => {
    const bad = { id: "x", top: [{ name: "a", score: 1 }, { name: "b" }], best: { score: 1 } };
    expect(missingFields(bad, "Result", fixture)).toEqual(["top[1].score", "best.at"]);
  });

  it("treats `T | null` as required-but-nullable: the key must exist", () => {
    expect(missingFields({ id: "x", top: [] }, "Result", fixture)).toEqual(["best"]);
  });

  it("walks an optional field when it is present", () => {
    const bad = { id: "x", top: [], best: null, extra: {} };
    expect(missingFields(bad, "Result", fixture)).toEqual(["extra.flag"]);
  });
});

describe("the real client.ts", () => {
  it("parses the interfaces the route table names", () => {
    const interfaces = clientInterfaces();
    const required = interfaces.get("StartGameResult")!.props.filter((p) => !p.optional).map((p) => p.name);
    expect(required).toContain("game_id");
    expect(required).not.toContain("ui"); // optional in client.ts
  });

  it("maps routes (legacy and v1 paths, wrapped room snapshots) and ignores unmapped ones", () => {
    expect(clientShapeViolations("POST", "/api/game/start?target_length=7", {})).toContain("StartGameResult: game_id");
    expect(clientShapeViolations("POST", "/api/v1/rooms", { room: {} })).toContain("RoomSnapshot: room.code");
    expect(clientShapeViolations("GET", "/api/v1/me/preferences", {})).toEqual([]);
  });
});
