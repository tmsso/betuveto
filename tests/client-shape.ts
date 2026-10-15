/**
 * ROADMAP 11.19 — check the frontend's response interfaces (frontend/src/api/client.ts)
 * against real API responses. `tsc` can't: every handler returns `Reply.body: unknown`
 * (lib/game-core.ts), and client.ts's only callers are .jsx, so nothing links the two
 * sides (the PR #37 lesson). Instead this reads client.ts with the TypeScript compiler
 * API, and the contract suite's `call()` checks every 2xx response of a mapped route
 * against the interface the frontend expects — no extra requests, so it costs nothing on
 * production.
 *
 * What is checked: every *required* property (no `?`) is present, recursively through
 * nested interfaces, inline object types and arrays. `T | null` must still be present as
 * a key; its contents are only walked when non-null. Value types aren't checked: the
 * known failure mode is a renamed or dropped field, not a number turning into a string.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const CLIENT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../frontend/src/api/client.ts",
);

type Shape = { props: { name: string; optional: boolean; type: ts.TypeNode | undefined }[] };

function loadInterfaces(source: string): Map<string, Shape> {
  const file = ts.createSourceFile("client.ts", source, ts.ScriptTarget.ES2022, true);
  const interfaces = new Map<string, Shape>();
  file.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node)) interfaces.set(node.name.text, shapeOf(node.members));
  });
  return interfaces;
}

function shapeOf(members: ts.NodeArray<ts.TypeElement>): Shape {
  return {
    props: members.filter(ts.isPropertySignature).map((m) => ({
      name: m.name.getText(),
      optional: m.questionToken !== undefined,
      type: m.type,
    })),
  };
}

let cached: Map<string, Shape> | undefined;
export function clientInterfaces(source?: string): Map<string, Shape> {
  if (source !== undefined) return loadInterfaces(source);
  cached ??= loadInterfaces(readFileSync(CLIENT_PATH, "utf8"));
  return cached;
}

/** Paths of required properties missing from `value`, e.g. ["members[0].is_host"]. */
export function missingFields(
  value: unknown,
  interfaceName: string,
  interfaces: Map<string, Shape> = clientInterfaces(),
): string[] {
  const shape = interfaces.get(interfaceName);
  if (!shape) throw new Error(`client.ts has no interface ${interfaceName}`);
  return walkShape(value, shape, "", interfaces);
}

function walkShape(value: unknown, shape: Shape, at: string, interfaces: Map<string, Shape>): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [at || "(root)"];
  const record = value as Record<string, unknown>;
  const missing: string[] = [];
  for (const prop of shape.props) {
    const here = at ? `${at}.${prop.name}` : prop.name;
    if (!(prop.name in record)) {
      if (!prop.optional) missing.push(here);
      continue;
    }
    missing.push(...walkType(record[prop.name], prop.type, here, interfaces));
  }
  return missing;
}

function walkType(
  value: unknown,
  type: ts.TypeNode | undefined,
  at: string,
  interfaces: Map<string, Shape>,
): string[] {
  if (!type || value === null || value === undefined) return [];
  if (ts.isParenthesizedTypeNode(type)) return walkType(value, type.type, at, interfaces);
  if (ts.isUnionTypeNode(type)) {
    // `X | null`: walk the one non-null member when it's the only structured one.
    const structured = type.types.filter((t) => !isNullish(t));
    return structured.length === 1 ? walkType(value, structured[0], at, interfaces) : [];
  }
  if (ts.isArrayTypeNode(type)) {
    if (!Array.isArray(value)) return [at];
    return value.flatMap((item, i) => walkType(item, type.elementType, `${at}[${i}]`, interfaces));
  }
  if (ts.isTypeLiteralNode(type)) return walkShape(value, shapeOf(type.members), at, interfaces);
  if (ts.isTypeReferenceNode(type)) {
    const shape = interfaces.get(type.typeName.getText());
    return shape ? walkShape(value, shape, at, interfaces) : []; // Record<…>, type aliases
  }
  return [];
}

function isNullish(type: ts.TypeNode): boolean {
  return (
    (ts.isLiteralTypeNode(type) && type.literal.kind === ts.SyntaxKind.NullKeyword) ||
    type.kind === ts.SyntaxKind.UndefinedKeyword
  );
}

/** Which client.ts interface a 2xx response of each route must satisfy. Routes the
 *  frontend types inline (preferences, report, suggest, …) aren't listed. Legacy
 *  `/api/game/...` and `/api/v1/game/...` paths share one handler. */
const ROUTES: [method: string, pattern: RegExp, interfaceName: string, field?: string][] = [
  ["GET", /^\/api(\/v1)?\/words\/lengths$/, "LengthsResponse"],
  ["POST", /^\/api(\/v1)?\/game\/start$/, "StartGameResult"],
  ["POST", /^\/api\/v1\/daily\/start$/, "StartGameResult"],
  ["GET", /^\/api\/v1\/daily$/, "DailyView"],
  ["POST", /^\/api(\/v1)?\/game\/[^/]+\/guess$/, "GameResult"],
  ["GET", /^\/api(\/v1)?\/game\/[^/]+$/, "GameState"],
  ["POST", /^\/api(\/v1)?\/game\/[^/]+\/give_up$/, "GiveUpResult"],
  ["POST", /^\/api(\/v1)?\/game\/[^/]+\/hint$/, "HintResult"],
  ["GET", /^\/api\/v1\/scores\/top$/, "TopScoresResult"],
  ["GET", /^\/api\/v1\/me\/stats$/, "MyStats"],
  ["GET", /^\/api\/v1\/me\/achievements$/, "MyAchievements"],
  ["GET", /^\/api\/v1\/rooms\/[^/]+$/, "RoomSnapshot"],
  ["POST", /^\/api\/v1\/rooms\/[^/]+\/start$/, "RoomSnapshot"],
  // create/join are typed inline as { code, room } / { room } — check the snapshot inside.
  ["POST", /^\/api\/v1\/rooms$/, "RoomSnapshot", "room"],
  ["POST", /^\/api\/v1\/rooms\/[^/]+\/join$/, "RoomSnapshot", "room"],
];

/** Missing-field paths for a 2xx response of `route`, or [] when the route isn't mapped. */
export function clientShapeViolations(method: string, route: string, body: unknown): string[] {
  const pathOnly = route.split("?")[0];
  const match = ROUTES.find(([m, re]) => m === method && re.test(pathOnly));
  if (!match) return [];
  const [, , interfaceName, field] = match;
  const value = field ? (body as Record<string, unknown> | null)?.[field] : body;
  return missingFields(value, interfaceName).map((p) => `${interfaceName}: ${field ? `${field}.` : ""}${p}`);
}
