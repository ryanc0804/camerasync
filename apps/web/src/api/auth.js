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

// Complete a password reset using the token from the emailed link. Unlike the
// request step, this surfaces real errors — an invalid/expired token must tell
// the user, so they can request a fresh link.
export async function resetPassword({ token, password }) {
  return request("/api/auth/reset-password", {
    method: "POST",
    body: { token, password },
  });
}
