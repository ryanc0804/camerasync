// Where the API and the sync socket live, from this page's point of view.
//
// VITE_SERVER_URL wins when it's set, with one exception: if it points at
// localhost but the page itself was opened from some other host — a phone
// loading http://192.168.1.x:5173 over the LAN — then "localhost" would mean
// the phone, not the dev machine. In that case keep the port and swap in the
// host the page came from, so LAN testing works without per-device config.

const CONFIGURED = (import.meta.env.VITE_SERVER_URL || "").trim();
const DEFAULT_PORT = import.meta.env.VITE_SERVER_PORT || "4000";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function resolveServerUrl() {
  const { protocol, hostname } = window.location;

  if (!CONFIGURED) return `${protocol}//${hostname}:${DEFAULT_PORT}`;

  try {
    const url = new URL(CONFIGURED);
    if (LOOPBACK_HOSTS.has(url.hostname) && !LOOPBACK_HOSTS.has(hostname)) {
      url.hostname = hostname;
      return url.origin;
    }
    return url.origin;
  } catch {
    return CONFIGURED.replace(/\/$/, "");
  }
}

export const SERVER_URL = resolveServerUrl();
