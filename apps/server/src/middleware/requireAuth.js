import {
  SESSION_COOKIE,
  getUserBySessionToken,
  publicUser,
} from "../auth/sessions.js";

/// Gate for protected routes. Reads the httpOnly session cookie, resolves the
/// user, and attaches it as req.user — or 401s.
///
/// Usage: router.get("/mine", requireAuth, handler)
export async function requireAuth(req, res, next) {
  try {
    const row = await getUserBySessionToken(req.cookies?.[SESSION_COOKIE]);
    if (!row) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    req.user = publicUser(row);
    next();
  } catch (err) {
    next(err);
  }
}
