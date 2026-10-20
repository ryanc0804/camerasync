// How long after Start the shared start time is: long enough for the start
// command to reach the session's slowest device and for its camera to get
// rolling, so every device begins together.
//
// Each connection's round trip comes from Socket.IO's own heartbeat (the
// server pings every client and times the pong), so it works for every
// client without any changes on their side.

import { SYNC_BEEP_DELAY_MS } from "../recordings/syncBeep.js";

// Never shorter than this: plenty on a normal connection, and what a device
// gets before its first heartbeat has been timed.
export const MIN_START_DELAY_MS = 1500;

// Never longer, however bad a connection looks; a device later than this
// still starts as soon as the command arrives and is lined up by the beep.
export const MAX_START_DELAY_MS = 5000;

// What a phone needs to start its camera once the command arrives.
export const CAMERA_START_MS = 800;

// How many recent round trips a connection keeps; the slowest of them is
// used, so one quick heartbeat doesn't hide a patchy connection.
const RECENT_ROUND_TRIPS = 3;

// The start delay for devices with these round trips (ms; unknown ones are
// skipped).
export function startDelayMs(roundTripsMs) {
  const known = roundTripsMs.filter((ms) => Number.isFinite(ms) && ms >= 0);
  const slowest = known.length > 0 ? Math.max(...known) : 0;
  return Math.min(
    MAX_START_DELAY_MS,
    Math.max(MIN_START_DELAY_MS, Math.round(slowest + CAMERA_START_MS))
  );
}

// Times each heartbeat on this socket's connection and keeps the slowest
// recent round trip in socket.data.roundTripMs.
export function trackRoundTrips(socket, now = Date.now) {
  let pingSentAt = null;
  const recent = [];
  socket.conn.on("packetCreate", (packet) => {
    if (packet.type === "ping") pingSentAt = now();
  });
  socket.conn.on("heartbeat", () => {
    if (pingSentAt === null) return;
    recent.push(now() - pingSentAt);
    pingSentAt = null;
    if (recent.length > RECENT_ROUND_TRIPS) recent.shift();
    socket.data.roundTripMs = Math.max(...recent);
  });
}

// How long the cameras keep rolling after the end beep starts: the beep
// itself (240 ms), the playing device's audio latency, and some margin.
export const END_BEEP_TAIL_MS = 800;

// Never closer to the start beep than this, so a very short take still has
// the two beeps apart.
const END_BEEP_AFTER_START_BEEP_MS = 600;

// When a stop takes effect. A take that hasn't reached its shared start yet
// is simply cancelled. Otherwise the device that pressed Stop plays the end
// beep once the command has reached the slowest device, and every camera
// stops END_BEEP_TAIL_MS later, so all of them record it.
export function stopSchedule(roundTripsMs, startAtEpochMs, now) {
  if (now < startAtEpochMs) {
    return { stopAtEpochMs: now, endBeepAtEpochMs: null };
  }
  const known = roundTripsMs.filter((ms) => Number.isFinite(ms) && ms >= 0);
  const slowest = known.length > 0 ? Math.max(...known) : 0;
  const delay = Math.min(MAX_START_DELAY_MS, Math.max(1000, Math.round(slowest + 300)));
  const endBeepAtEpochMs = Math.max(
    now + delay,
    startAtEpochMs + SYNC_BEEP_DELAY_MS + END_BEEP_AFTER_START_BEEP_MS
  );
  return { endBeepAtEpochMs, stopAtEpochMs: endBeepAtEpochMs + END_BEEP_TAIL_MS };
}
