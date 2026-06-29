import pg from "pg";

// Shared Postgres connection pool. Import `pool` and call pool.query(...).
// Connection string comes from DATABASE_URL (see .env.example).
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function pingDb() {
  const { rows } = await pool.query("SELECT 1 AS ok");
  return rows[0].ok === 1;
}
