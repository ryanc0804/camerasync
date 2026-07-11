import { Router } from "express";
import {
  createUser,
  loginUser,
  createSession,
  destroySession,
  getSessionToken,
} from "../middleware/auth.js";

export const authRouter = Router();

// Options for the session cookie. httpOnly so JS can't read it, sameSite=lax
// mitigates CSRF
// TODO: Handle HTTPS only in production
const SESSION_COOKIE = "session";
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 1000 * 60 * 60 * 24 * 30, // same as TLS; 30 days
};

authRouter.post("/register", async (req, res, next) => {
  const { name, email, password } = req.body ?? {};
  if (!email || !password) {
    return res
      .status(400)
      .json({ error: "email and password are required" });
  }

  try {
    const user = await createUser(name, email, password);
    const { sessionToken, csrfToken } = await createSession(
      user.user_id,
      req.get("user-agent")
    );
    res.cookie(SESSION_COOKIE, sessionToken, COOKIE_OPTIONS);
    res.status(201).json({ user, csrfToken });
  } catch (err) {
    if (err.status === 409) {
      return res.status(409).json({ error: err.message });
    }
    next(err);
  }
});

authRouter.post("/login", async (req, res, next) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res
      .status(400)
      .json({ error: "email and password are required" });
  }

  try {
    const user = await loginUser(email, password);
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const { sessionToken, csrfToken } = await createSession(
      user.user_id,
      req.get("user-agent")
    );
    res.cookie(SESSION_COOKIE, sessionToken, COOKIE_OPTIONS);
    res.json({ user, csrfToken });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const token = getSessionToken(req);
    await destroySession(token);
    res.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
