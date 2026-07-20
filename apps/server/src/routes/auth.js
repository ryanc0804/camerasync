import { Router } from "express";
import bcrypt from "bcryptjs";

import { pool } from "../db/pool.js";
import {
  SESSION_COOKIE,
  createSession,
  deleteSession,
  getUserBySessionToken,
  publicUser,
  sessionCookieOptions,
} from "../auth/sessions.js";

export const authRouter = Router();

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

// Postgres unique-constraint violation. Turns a race on the users_email_key
// index into a clean 409 instead of a 500.
const PG_UNIQUE_VIOLATION = "23505";

function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

authRouter.post("/register", async (req, res, next) => {
  try {
    const { name, password } = req.body ?? {};
    const email = normalizeEmail(req.body?.email);

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }
    if (String(password).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
    }

    const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);

    let row;
    try {
      const result = await pool.query(
        `INSERT INTO users (email, display_name, password)
         VALUES ($1, $2, $3)
         RETURNING user_id, email, display_name, roles`,
        [email, name?.trim() || null, passwordHash]
      );
      row = result.rows[0];
    } catch (err) {
      if (err.code === PG_UNIQUE_VIOLATION) {
        return res
          .status(409)
          .json({ error: "An account with that email already exists." });
      }
      throw err;
    }

    const token = await createSession(row.user_id);
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
    res.status(201).json({ user: publicUser(row) });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const { password } = req.body ?? {};
    const email = normalizeEmail(req.body?.email);

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const { rows } = await pool.query(
      `SELECT user_id, email, display_name, roles, password
         FROM users
        WHERE email = $1`,
      [email]
    );
    const row = rows[0];

    // Same response whether the email is unknown or the password is wrong, so
    // this endpoint can't be used to discover which emails have accounts.
    const ok = row && (await bcrypt.compare(String(password), row.password));
    if (!ok) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }

    const token = await createSession(row.user_id);
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
    res.json({ user: publicUser(row) });
  } catch (err) {
    next(err);
  }
});

// Who am I? The browser can't read the httpOnly cookie, so the web app calls
// this on start-up to restore the signed-in user.
authRouter.get("/me", async (req, res, next) => {
  try {
    const row = await getUserBySessionToken(req.cookies?.[SESSION_COOKIE]);
    if (!row) return res.status(401).json({ error: "Not authenticated" });
    res.json({ user: publicUser(row) });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    await deleteSession(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, {
      ...sessionCookieOptions(),
      maxAge: undefined,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
