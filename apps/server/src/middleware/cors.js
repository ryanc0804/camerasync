// Which browser origins are allowed to call the API.
//
// WEB_ORIGIN is the deployed web app's origin and accepts a comma-separated
// list. Outside production we additionally accept any loopback or private
// network origin, so a phone on the same Wi-Fi can load the dev server by LAN
// IP (http://192.168.1.x:5173) without anyone having to edit .env first.
//
// Shared by the REST API (../index.js) and Socket.IO (../sockets/websocket.js)
// so both stay in sync — a mismatch shows up as a websocket that silently
// refuses to connect while REST calls work.

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const CONFIGURED_ORIGINS = (process.env.WEB_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

// localhost, 127.x, ::1, and the RFC 1918 private ranges.
const PRIVATE_HOSTNAME =
  /^(localhost|\[::1\]|127(\.\d{1,3}){3}|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})$/;

export function isAllowedOrigin(origin) {
  // Requests without an Origin header aren't cross-origin browser requests
  // (curl, the mobile app, same-origin navigations) — nothing to block.
  if (!origin) return true;

  if (CONFIGURED_ORIGINS.includes(origin.replace(/\/$/, ""))) return true;
  if (IS_PRODUCTION) return false;

  try {
    return PRIVATE_HOSTNAME.test(new URL(origin).hostname);
  } catch {
    return false;
  }
}

// credentials:true is required for the browser to send/accept the httpOnly
// session cookie cross-origin (Vite on :5173 -> API on :4000).
export const corsOptions = {
  credentials: true,
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
};
