import pg from "pg";
import type { Env } from "./env.js";

const { Pool } = pg;

export function createPool(env: Env) {
  return new Pool({ connectionString: env.DATABASE_URL });
}
