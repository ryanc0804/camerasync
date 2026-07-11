import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { pool } from "../db/pool.js";

const SALT_ROUNDS = 12;

// Session expiry
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// Columns safe to return to the client (never includes `password`).
const PUBLIC_USER_COLUMNS =
  "user_id, email, display_name, profile_picture, roles, settings";

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

// Register a new user. Hashes the password with bcrypt before storing it.
// Throws an error with `.status = 409` if the email is already taken.
export async function createUser(name, email, password) {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (email, display_name, password)
       VALUES ($1, $2, $3)
       RETURNING ${PUBLIC_USER_COLUMNS}`,
      [email.trim().toLowerCase(), name ?? null, passwordHash]
    );
    return rows[0];
  } catch (err) {
    if (err.code === "23505") {
      // unique_violation on the email column
      const conflict = new Error("Email already registered");
      conflict.status = 409;
      throw conflict;
    }
    throw err;
  }
}

// Validate user/password on login, returns null if not valid or user doesn't exist
export async function loginUser(email, password) {
  const { rows } = await pool.query(
    `SELECT ${PUBLIC_USER_COLUMNS}, password
     FROM users WHERE email = $1`,
    [email.trim().toLowerCase()]
  );
  const user = rows[0];
  if (!user) {
    // Compare against a dummy hash anyway to keep timing roughly constant
    // avoid leaks
    await bcrypt.compare(password, "$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva");
    return null;
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return null;

  delete user.password;
  return user;
}

// Issue a new server-side session for a user and return its tokens.
export async function createSession(userId, device) {
  const sessionToken = generateToken();
  const csrfToken = generateToken();
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    `INSERT INTO sessions (user_id, session_token, csrf_token, device, expires)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, sessionToken, csrfToken, device ? device.slice(0, 32) : null, expires]
  );
  return { sessionToken, csrfToken, expires };
}

// Revoke a session (logout).
export async function destroySession(sessionToken) {
  if (!sessionToken) return;
  await pool.query("DELETE FROM sessions WHERE session_token = $1", [
    sessionToken,
  ]);
}

// Extract the session token from the request: prefers the `session` cookie,
// falls back to an `Authorization: Bearer <token>` header (mobile client).
export function getSessionToken(req) {
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(";")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      const name = part.slice(0, eq).trim();
      if (name === "session") {
        return decodeURIComponent(part.slice(eq + 1).trim());
      }
    }
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  return null;
}

// Express middleware: rejects the request with 401 unless it carries a valid,
// unexpired session. On success attaches `req.user` and `req.sessionToken`.
export async function authenticate(req, res, next) {
  try {
    const token = getSessionToken(req);
    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { rows } = await pool.query(
      `SELECT s.user_id, s.csrf_token, s.expires,
              u.email, u.display_name, u.profile_picture, u.roles, u.settings
       FROM sessions s
       JOIN users u ON u.user_id = s.user_id
       WHERE s.session_token = $1`,
      [token]
    );

    const session = rows[0];
    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (new Date(session.expires) < new Date()) {
      await destroySession(token);
      return res.status(401).json({ error: "Session expired" });
    }

    req.user = {
      user_id: session.user_id,
      email: session.email,
      display_name: session.display_name,
      profile_picture: session.profile_picture,
      roles: session.roles,
      settings: session.settings,
    };
    req.csrfToken = session.csrf_token;
    req.sessionToken = token;
    next();
  } catch (err) {
    next(err);
  }
}
