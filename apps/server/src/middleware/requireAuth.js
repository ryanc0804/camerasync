import {
  SESSION_COOKIE,
  UNVERIFIED_ERROR,
  getUserBySessionToken,
  isUnverified,
  publicUser,
} from "../auth/sessions.js";

/// Gate for protected routes. Reads the httpOnly session cookie, resolves the
/// user, and attaches it as req.user — or 401s. Accounts that haven't
/// confirmed their email get a 403 with code EMAIL_UNVERIFIED.
///
/// Usage: router.get("/mine", requireAuth, handler)
export async function requireAuth(req, res, next) {
  try {
    const row = await getUserBySessionToken(req.cookies?.[SESSION_COOKIE]);
    if (!row) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (isUnverified(row)) {
      return res.status(403).json(UNVERIFIED_ERROR);
    }
    req.user = publicUser(row);
    next();
  } catch (err) {
    next(err);
  }
}
