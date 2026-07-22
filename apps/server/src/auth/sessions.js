import crypto from "node:crypto";

import { pool } from "../db/pool.js";

export const SESSION_COOKIE = "session";

// Session expiry date
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// httpOnly keeps the cookie unreadable from JavaScript (the whole point of
// choosing cookies over localStorage). sameSite:"lax" blocks the cookie on
// cross-site POSTs, which covers CSRF for our flows.
//
// NOTE: secure:true must be enabled once this is served over HTTPS. It's off
// here because localhost dev is plain HTTP and the browser would drop the
// cookie entirely.
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS,
    path: "/",
  };
}

/// Create a session row for a user and return its opaque token.
export async function createSession(userId, device = null) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_TTL_MS);

  // expires is set explicitly — the column's DEFAULT NOW() would make every
  // session expire the instant it was created.
  await pool.query(
    `INSERT INTO sessions (user_id, session_token, created_at, device, expires)
     VALUES ($1, $2, NOW(), $3, $4)`,
    [userId, token, device, expires]
  );

  return token;
}

/// Look up the user behind a session token, or null if missing/expired.
export async function getUserBySessionToken(token) {
  if (!token) return null;

  const { rows } = await pool.query(
    `SELECT u.user_id, u.email, u.display_name, u.roles
       FROM sessions s
       JOIN users u ON u.user_id = s.user_id
      WHERE s.session_token = $1
        AND s.expires > NOW()`,
    [token]
  );

  return rows[0] ?? null;
}

export async function deleteSession(token) {
  if (!token) return;
  await pool.query(`DELETE FROM sessions WHERE session_token = $1`, [token]);
}

/// Shape sent to clients. Never includes the password hash.
export function publicUser(row) {
  return {
    id: row.user_id,
    email: row.email,
    name: row.display_name,
    roles: row.roles ?? [],
  };
}
