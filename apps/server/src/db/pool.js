import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Shared postgres connection pool that will handle AWS RDS or local docker postgres connection

// uses pg to handle queries
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} (production database)`);
  return value;
}

function buildConfig() {
  if (!IS_PRODUCTION) {
    return { connectionString: process.env.DATABASE_URL };
  }

  // RDS_SSL_CA: optional path to the AWS RDS CA bundle
  const caPath = process.env.RDS_SSL_CA
    ? path.resolve(__dirname, process.env.RDS_SSL_CA)
    : null;
  return {
    host: required("RDS_HOST"),
    port: Number(process.env.RDS_PORT || 5432),
    user: required("RDS_USER"),
    password: required("RDS_PASSWORD"),
    database: required("RDS_DB"),
    ssl: caPath
      ? { ca: fs.readFileSync(caPath, "utf8"), rejectUnauthorized: true }
      : { rejectUnauthorized: false },
    max: Number(process.env.RDS_POOL_MAX || 10),
  };
}

export const pool = new pg.Pool(buildConfig());

export async function pingDb() {
  const { rows } = await pool.query("SELECT 1 AS ok");
  return rows[0].ok === 1;
}
