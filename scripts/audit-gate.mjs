#!/usr/bin/env node
/**
 * Dependency audit gate (ROADMAP 16.8). Runs `npm audit --omit=dev --json` in the given
 * directory and fails if any HIGH or CRITICAL advisory is not on the allow-list below.
 *
 * Why an allow-list instead of a plain `npm audit --audit-level=high`: the frontend's
 * @neondatabase/auth (still beta) pins better-auth/zod versions with open advisories, and
 * no published SDK version fixes them (0.6.0-beta and 0.7.0-beta still pull better-auth
 * 1.7.6, checked 2026-10-29). A plain gate would be red on every PR. Listing the known ones
 * by advisory id, each with the reason it doesn't affect this app, keeps the gate useful:
 * any NEW high/critical advisory still fails CI, and an entry that stops appearing is
 * reported so the list can be trimmed.
 *
 * Usage: node scripts/audit-gate.mjs [dir]   (default: current directory)
 */
import { execFileSync } from "node:child_process";

// Keyed by the directory argument, so each package only carries its own exceptions.
const ALLOWED_BY_DIR = {
  ".": {},
  frontend: {
    // better-auth server-side flaws. This app only uses the browser client
    // (createAuthClient in frontend/src/neonAuth.js); the auth server is Neon's hosted
    // service. Verified 2026-10-29 that none of the server plugins/adapters (OAuth proxy,
    // drizzle/kysely adapters) appear in the built bundle (their names and routes are absent).
    "GHSA-965c-763c-88jm": "better-auth server: OAuth state reusable as a magic link (Neon-hosted server)",
    "GHSA-r4xp-prcw-77qf": "better-auth server: OAuth Proxy plugin (not used; Neon-hosted server)",
    "GHSA-q84f-53jg-9ppm": "better-auth server: device-login approval UI (not used)",
    // zod: memory exhaustion validating oversized constrained collections. zod IS in the
    // admin chunk (pulled in by the better-auth client; an earlier note here said it wasn't,
    // which was wrong: the grep markers were minified away). It only validates the Neon Auth
    // server's own responses on /admin, never player input, so no attacker-sized input
    // reaches it. Not in the player bundle.
    "GHSA-mrhx-c7xc-m3w5": "zod via better-auth client: admin-only, validates Neon Auth responses only",
  },
};

const dir = process.argv[2] ?? ".";
const ALLOWED = ALLOWED_BY_DIR[dir] ?? {};
let report;
try {
  report = execFileSync("npm", ["audit", "--omit=dev", "--json"], { cwd: dir, encoding: "utf8" });
} catch (error) {
  // npm audit exits non-zero whenever it finds anything; the JSON is still on stdout.
  report = error.stdout;
}
// Fail closed: a registry or network error must not read as "no advisories".
let parsed;
try {
  parsed = JSON.parse(report);
} catch {
  console.error(`npm audit did not return JSON (${dir}); cannot judge advisories.`);
  process.exit(1);
}
if (parsed.error || !parsed.vulnerabilities) {
  console.error(`npm audit failed (${dir}): ${parsed.error?.summary || parsed.error?.code || "no vulnerabilities report"}`);
  process.exit(1);
}
const { vulnerabilities } = parsed;

const found = new Map(); // advisory id -> "severity package: title"
for (const vuln of Object.values(vulnerabilities)) {
  for (const via of vuln.via) {
    if (typeof via !== "object") continue; // a string = "via another package", listed separately
    if (via.severity !== "high" && via.severity !== "critical") continue;
    const id = via.url.split("/").pop();
    found.set(id, `${via.severity} ${via.name}: ${via.title}`);
  }
}

const unexpected = [...found].filter(([id]) => !(id in ALLOWED));
const stale = Object.keys(ALLOWED).filter((id) => !found.has(id));

for (const [id, text] of found) {
  console.log(`${id in ALLOWED ? "allowed " : "NEW     "} ${id}  ${text}`);
}
if (stale.length) {
  console.log(`\nNo longer reported (remove from the allow-list in ${dir}): ${stale.join(", ")}`);
}
if (unexpected.length) {
  console.error(`\n${unexpected.length} high/critical advisory(ies) not on the allow-list. Fix, or allow-list with a reason.`);
  process.exit(1);
}
console.log(`\naudit gate ok (${dir}): ${found.size} high/critical, all allow-listed.`);
