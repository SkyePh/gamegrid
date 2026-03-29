import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolved from `api/dist` or `api/src` → repo `db/migrations`. */
function migrationsDir(): string {
  return join(__dirname, "../../db/migrations");
}

export async function runMigrations(pool: Pool): Promise<void> {
  const dir = migrationsDir();
  if (!existsSync(dir)) {
    throw new Error(`Migrations directory not found: ${dir}`);
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const path = join(dir, file);
    const sql = readFileSync(path, "utf8");
    await pool.query(sql);
    console.log(`migration applied: ${file}`);
  }
}
