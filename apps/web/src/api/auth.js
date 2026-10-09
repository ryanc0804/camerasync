// Thin client for the server's auth endpoints.
//
// Auth is cookie-based: the server sets an httpOnly `session` cookie that
// JavaScript deliberately cannot read. So there is no token to store here —
// every request just needs `credentials: "include"` so the browser attaches
// the cookie, and the signed-in user is recovered by calling /me.
//
//   POST /api/auth/register { name, email, password } -> { user }
//   POST /api/auth/login    { email, password }       -> { user }
//   GET  /api/auth/me                                 -> { user } | 401
//   POST /api/auth/logout                             -> 204
//   PATCH /api/auth/me   { name?, primaryGroupId? }   -> { user }
//   POST /api/auth/change-password { currentPassword, newPassword } -> 204

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

async function request(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`${SERVER_URL}${path}`, {
      method,
      credentials: "include", // send/receive the session cookie
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`Can't reach the server at ${SERVER_URL}. Is it running?`);
  }

  if (res.status === 204) return null;

  let data = {};
  try {
    data = await res.json();
  } catch {
    // Non-JSON response (e.g. an HTML error page).
  }

  if (!res.ok) {
    const err = new Error(
      data.error || data.message || `Request failed (${res.status})`
    );
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function login({ email, password }) {
  return request("/api/auth/login", { method: "POST", body: { email, password } });
}

export async function register({ name, email, password }) {
  return request("/api/auth/register", {
    method: "POST",
    body: { name, email, password },
  });
}

export async function logout() {
  return request("/api/auth/logout", { method: "POST" });
}

/// Restore the signed-in user on app start. Returns the user or null when the
/// cookie is missing/expired (a 401 here is the normal signed-out case).
export async function fetchMe() {
  try {
    const data = await request("/api/auth/me");
    return data?.user ?? null;
  } catch (err) {
    if (err.status === 401) return null;
    throw err;
  }
}

// Kick off a password reset. We intentionally ignore the HTTP status and always
// treat a reachable server as success: responding identically whether or not
// the email has an account avoids leaking which emails are registered, and it
// also lets this flow work before the endpoint is implemented. Only a network
// failure surfaces an error to the user.
export async function requestPasswordReset(email) {
  try {
    await fetch(`${SERVER_URL}/api/auth/forgot-password`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch {
    throw new Error(`Can't reach the server at ${SERVER_URL}. Is it running?`);
  }
}

// Exchange the emailed 6-digit code for a reset token (the in-app flow, as an
// alternative to following the emailed link). Errors surface so the user knows
// to retype or re-request the code.
export async function verifyResetCode({ email, code }) {
  const data = await request("/api/auth/verify-reset-code", {
    method: "POST",
    body: { email, code },
  });
  return data.token;
}

// Complete a password reset using the token from the emailed link (or from
// verifyResetCode). Unlike the request step, this surfaces real errors — an
// invalid/expired token must tell the user, so they can request a fresh link.
export async function resetPassword({ token, password }) {
  return request("/api/auth/reset-password", {
    method: "POST",
    body: { token, password },
  });
}

// Confirm a new account (SCRUM-43) with the 6-digit code from the email (needs
// the session) or the link's token (works signed out). Returns the user.
export async function verifyEmail({ code, token }) {
  const data = await request("/api/auth/verify-email", {
    method: "POST",
    body: code ? { code } : { token },
  });
  return data.user;
}

// Email a fresh confirmation code to the signed-in, unconfirmed user.
export async function resendVerification() {
  return request("/api/auth/resend-verification", { method: "POST" });
}

// Settings page: change the display name and/or the primary group (the group
// whose color the apps take; null falls back to the first joined group).
export async function updateProfile(changes) {
  const data = await request("/api/auth/me", { method: "PATCH", body: changes });
  return data.user;
}

// Change the password while signed in; other devices get signed out.
export async function changePassword({ currentPassword, newPassword }) {
  return request("/api/auth/change-password", {
    method: "POST",
    body: { currentPassword, newPassword },
  });
}
