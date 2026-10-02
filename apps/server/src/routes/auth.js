import crypto from "node:crypto";

import { Router } from "express";
import bcrypt from "bcryptjs";

import { pool } from "../db/pool.js";
import { sendPasswordResetEmail } from "../email/mailer.js";
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

// Reset links die after an hour; a forgotten password is reset within minutes,
// and anything older is more likely a forgotten inbox than a real attempt.
const RESET_TTL_MS = 1000 * 60 * 60;

function hashResetToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

// Start a password reset. The response is identical whether or not the email
// has an account, so this endpoint can't be used to discover which emails are
// registered (the web client ignores the status anyway — see web/api/auth.js).
authRouter.post("/forgot-password", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      return res.status(400).json({ error: "Email is required." });
    }

    const { rows } = await pool.query(
      `SELECT user_id FROM users WHERE email = $1`,
      [email]
    );
    const row = rows[0];

    if (row) {
      const token = crypto.randomBytes(32).toString("hex");
      // The emailed 6-digit code lets the mobile app finish the reset in-app
      // (via /verify-reset-code) instead of following the web link.
      const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
      const expires = new Date(Date.now() + RESET_TTL_MS);

      // A fresh request replaces any earlier link so only the newest works.
      await pool.query(`DELETE FROM password_resets WHERE user_id = $1`, [
        row.user_id,
      ]);
      await pool.query(
        `INSERT INTO password_resets (token_hash, user_id, expires, code_hash)
         VALUES ($1, $2, $3, $4)`,
        [hashResetToken(token), row.user_id, expires, hashResetToken(code)]
      );

      const origin = process.env.WEB_ORIGIN || "http://localhost:5173";
      // Fire-and-forget: the 204 must not wait on (or reveal anything about)
      // the SMTP conversation, so send failures only reach the server log.
      sendPasswordResetEmail(
        email,
        `${origin}/reset-password?token=${token}`,
        code
      ).catch((err) => {
        console.error(`[password-reset] send to ${email} failed:`, err.message);
      });
    }

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// A 6-digit code only has a million possibilities, so each reset row allows a
// handful of guesses before it is deleted and the user must request a new one.
const MAX_CODE_ATTEMPTS = 5;

// Exchange the emailed 6-digit code for a reset token (mobile flow). Every
// failure returns the same message so the endpoint can't be used to discover
// which emails have accounts or pending resets.
authRouter.post("/verify-reset-code", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code ?? "").trim();
    if (!email || !code) {
      return res.status(400).json({ error: "Email and code are required." });
    }

    const invalid = () =>
      res.status(400).json({ error: "That code is invalid or has expired." });

    // Counting the attempt in the same statement as the lookup keeps racing
    // guesses from sharing one attempt.
    const { rows } = await pool.query(
      `UPDATE password_resets pr
          SET attempts = pr.attempts + 1
         FROM users u
        WHERE u.user_id = pr.user_id
          AND u.email = $1
          AND pr.expires > NOW()
        RETURNING pr.user_id, pr.code_hash, pr.attempts`,
      [email]
    );
    const row = rows[0];
    if (!row || !row.code_hash) return invalid();

    if (row.attempts > MAX_CODE_ATTEMPTS) {
      await pool.query(`DELETE FROM password_resets WHERE user_id = $1`, [
        row.user_id,
      ]);
      return invalid();
    }

    const ok = crypto.timingSafeEqual(
      Buffer.from(hashResetToken(code)),
      Buffer.from(row.code_hash)
    );
    if (!ok) return invalid();

    // Rotate the token so this response becomes the only credential that can
    // finish the reset; the emailed link dies with the old hash.
    const token = crypto.randomBytes(32).toString("hex");
    await pool.query(
      `UPDATE password_resets SET token_hash = $1 WHERE user_id = $2`,
      [hashResetToken(token), row.user_id]
    );

    res.json({ token });
  } catch (err) {
    next(err);
  }
});

// Complete a reset with the token from the emailed link. The DELETE doubles as
// the lookup: it atomically consumes the token, so a link can't be used twice
// even by two racing requests.
authRouter.post("/reset-password", async (req, res, next) => {
  try {
    const { token, password } = req.body ?? {};
    if (!token || !password) {
      return res
        .status(400)
        .json({ error: "Token and password are required." });
    }
    if (String(password).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
    }

    const { rows } = await pool.query(
      `DELETE FROM password_resets
        WHERE token_hash = $1
          AND expires > NOW()
        RETURNING user_id`,
      [hashResetToken(token)]
    );
    const row = rows[0];
    if (!row) {
      return res
        .status(400)
        .json({ error: "This reset link is invalid or has expired." });
    }

    const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
    await pool.query(`UPDATE users SET password = $1 WHERE user_id = $2`, [
      passwordHash,
      row.user_id,
    ]);

    // The password just changed hands; every existing session goes with it so
    // whoever prompted the reset is signed out everywhere.
    await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [row.user_id]);

    res.status(204).end();
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
