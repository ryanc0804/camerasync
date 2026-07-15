// Thin client for the server's auth endpoints. The token + user are persisted
//
// NOTE: the server routes (/api/auth/login, /api/auth/register) are not built
// yet — see the TODO in apps/server/src/index.js. Until they exist these calls
// will fail and the UI surfaces the error. The request/response contract this
// assumes:
//   POST /api/auth/register { name, email, password } -> { token, user }
//   POST /api/auth/login    { email, password }        -> { token, user }
//   (error responses carry { error } or { message })

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

const TOKEN_KEY = "camerasync.token";
const USER_KEY = "camerasync.user";

async function postJson(path, body) {
  let res;
  try {
    res = await fetch(`${SERVER_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`Can't reach the server at ${SERVER_URL}. Is it running?`);
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    // Non-JSON response (e.g. a 404 HTML page before the route exists).
  }

  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data;
}

//TODO: Change this persist function to handle setting cookies on the server instead of the client

function persist({ token, user }) {
  if (token) setCookie("session", token, 120);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export async function login({ email, password }) {
  const data = await postJson("/api/auth/login", { email: email, password: password });
  persist(data);
  return data;
}

export async function register({ name, email, password }) {
  const data = await postJson("/api/auth/register", { name, email, password });
  persist(data);
  return data;
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// Kick off a password reset. The server (once /api/auth/forgot-password exists)
// should email a reset link. We intentionally ignore the HTTP status and always
// treat a reachable server as success: responding identically whether or not
// the email has an account avoids leaking which emails are registered, and it
// also lets this flow work before the endpoint is implemented. Only a network
// failure surfaces an error to the user.
export async function requestPasswordReset(email) {
  try {
    await fetch(`${SERVER_URL}/api/auth/forgot-password`, {
      method: "POST",
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
//   POST /api/auth/reset-password { token, password } -> {} (200) | { error }
export async function resetPassword({ token, password }) {
  return postJson("/api/auth/reset-password", { token, password });
}

//TODO: Fix logout and loadSession to handle cookies
// Restore a persisted session on app start. Returns { token, user } or null.
export function loadSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  const userRaw = localStorage.getItem(USER_KEY);
  if (!token || !userRaw) return null;
  try {
    return { token, user: JSON.parse(userRaw) };
  } catch {
    return null;
  }
}
