/**
 * Apply SQL migrations to the Neon Postgres (ROADMAP Batch 1.5).
 *
 * Applies every `migrations/*.sql` file, in filename order, that has not been applied
 * yet — tracked in a `schema_migrations` table so re-runs are no-ops. Each file runs as a
 * single simple-protocol query (Postgres wraps a multi-statement simple query in one
 * implicit transaction), then its version is recorded.
 *
 *   DATABASE_URL='<neon pooled connection string>' npm run db:migrate
 *
 * Use Neon's *pooled* connection string. `prepare: false` keeps this working through the
 * pooler (PgBouncer transaction mode cannot hold named prepared statements).
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postgres from "postgres";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "ERROR: set DATABASE_URL to the Neon pooled connection string, e.g.\n" +
        "  DATABASE_URL='postgresql://<user>:<pw>@<endpoint>-pooler.<region>.aws.neon.tech/<db>?sslmode=require' \\\n" +
        "    npm run db:migrate",
    );
    process.exit(1);
  }

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    console.log("No migrations found.");
    return;
  }

  const sql = postgres(databaseUrl, { onnotice: () => {}, prepare: false });
  try {
    await sql`
      create table if not exists schema_migrations (
        version    text primary key,
        applied_at timestamptz not null default now()
      )
    `;
    const applied = new Set(
      (await sql<{ version: string }[]>`select version from schema_migrations`).map(
        (r) => r.version,
      ),
    );

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  skip   ${file} (already applied)`);
        continue;
      }
      const content = await readFile(path.join(MIGRATIONS_DIR, file), "utf-8");
      // Simple protocol so a file may contain multiple statements; Postgres runs the
      // whole thing as one implicit transaction, so a failure leaves nothing half-applied.
      await sql.unsafe(content).simple();
      await sql`insert into schema_migrations (version) values (${file})`;
      console.log(`  apply  ${file}`);
      ran++;
    }
    console.log(ran === 0 ? "Up to date — nothing to apply." : `Applied ${ran} migration(s).`);
  } finally {
    await sql.end();
  }
}

// Only run when executed directly (so helpers could be imported for tests).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
