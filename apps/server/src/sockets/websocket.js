// Session WebSocket manager.
//
// Creates and hosts one logical websocket "channel" per recording session so
// phones can be synced independently of each other. This sits on top of the
// shared Socket.IO server (see ../sockets/index.js) and tracks the lifecycle of
// each session's room: create -> host/broadcast -> close.

import { EVENTS, RECORDING_LEAD_TIME_MS } from "./events.js";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/postgres-adapter";
import { pool } from '../db/pool.js';

const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:5173";
let io = null;

/**
 * Init server on module startup
 */
export async function initSocket(httpServer) {

  await pool.query(`
    CREATE TABLE IF NOT EXISTS socket_io (
    id BIGSERIAL UNIQUE PRIMARY KEY,
    created_at timestamptz DEFAULT NOW(),
    payload bytea
    );
  `);

  io = new Server(httpServer, {
    cors: { origin: WEB_ORIGIN }
  });

  // Initializes to postgres socket.io adapter
  io.adapter(createAdapter(pool));

  io.on('connection', (socket) => {
    // Event called after device connection

    // Clock sync: echo the client's send time alongside the server time so the
    // client can estimate its offset from the shared server clock.
    socket.on(EVENTS.TIME_SYNC, (clientSentAtEpochMs, ack) => {
      const reply = {
        clientSentAtEpochMs,
        serverTimeEpochMs: Date.now(),
      };
      if (typeof ack === "function") ack(reply);
      else socket.emit(EVENTS.TIME_SYNC, reply);
    });

    // Clients may pass a deviceName (web/mobile) or a deviceId; accept either.
    // The ack callback is optional — not every client supplies one, and a
    // missing callback must not prevent the device from joining.
    socket.on(EVENTS.JOIN_SESSION, async (payload = {}, ack) => {
      const { sessionId, deviceId, deviceName } = payload;
      const reply = typeof ack === "function" ? ack : () => {};

      if (!sessionId) return reply({ ok: false, error: "sessionId required" });

      try {
        const { rows } = await pool.query(
          "SELECT status FROM recordings WHERE id = $1",
          [sessionId]
        );

        if (rows.length === 0 || rows[0].status === "closed") {
          return reply({
            ok: false,
            error: "session not found or has been closed.",
          });
        }

        // join socket "room" that will run asynchronously depending on the session
        socket.join(sessionId);
        socket.data.sessionId = sessionId;
        socket.data.deviceId = deviceId ?? socket.id;
        socket.data.deviceName = deviceName ?? deviceId ?? "Unnamed device";

        // Fire device-joined event after successful connect and respond with success ACK packet
        socket.to(sessionId).emit(EVENTS.SESSION_JOINED, {
          deviceId: socket.data.deviceId,
          deviceName: socket.data.deviceName,
        });
        await broadcastDeviceList(sessionId);

        reply({ ok: true, status: rows[0].status });
      } catch (err) {
        console.error("[socket] join failed:", err.message);
        reply({ ok: false, error: "Internal server error with socket connection." });
      }
    });

    socket.on(EVENTS.LEAVE_SESSION, async () => {
      await handleDeparture(socket);
    });

    // Admin asks the server to start every camera in the room. The command is
    // deliberately not applied locally by the caller — it round-trips through
    // here so the host starts on the same shared timestamp as everyone else.
    socket.on(EVENTS.START_RECORDING, async (payload = {}, ack) => {
      const sessionId = payload.sessionId ?? socket.data.sessionId;
      const reply = typeof ack === "function" ? ack : () => {};

      if (!sessionId) return reply({ ok: false, error: "sessionId required" });

      try {
        const result = await startSessionRecording(sessionId);
        reply({ ok: true, ...result });
      } catch (err) {
        console.error("[socket] start failed:", err.message);
        reply({ ok: false, error: "could not start recording" });
      }
    });

    socket.on(EVENTS.STOP_RECORDING, async (payload = {}, ack) => {
      const sessionId = payload.sessionId ?? socket.data.sessionId;
      const reply = typeof ack === "function" ? ack : () => {};

      if (!sessionId) return reply({ ok: false, error: "sessionId required" });

      try {
        await stopSessionRecording(sessionId);
        reply({ ok: true });
      } catch (err) {
        console.error("[socket] stop failed:", err.message);
        reply({ ok: false, error: "could not stop recording" });
      }
    });

    // A phone that walks out of range, crashes, or force-quits never sends
    // LEAVE_SESSION, so without this the room's device list goes stale and an
    // admin sees cameras that are no longer there.
    socket.on("disconnect", async () => {
      await handleDeparture(socket);
    });
  });

  return io;
}

/**
 * Shared cleanup for both an explicit leave and an unexpected disconnect.
 * @param {import("socket.io").Socket} socket
 */
async function handleDeparture(socket) {
  const { sessionId, deviceId } = socket.data ?? {};
  if (!sessionId) return;

  socket.leave(sessionId);
  socket.data.sessionId = undefined;

  socket.to(sessionId).emit(EVENTS.SESSION_LEFT, { deviceId });
  await broadcastDeviceList(sessionId);
}

/**
 * Push the room's current membership to everyone in it. Clients render this
 * directly, so it is sent on every join and departure rather than leaving them
 * to reconstruct the list from individual joined/left events.
 * @param {string} sessionId
 */
async function broadcastDeviceList(sessionId) {
  const { devices } = await getRecordingSession(sessionId);
  getIO().to(sessionId).emit(EVENTS.DEVICE_LIST, devices);
}

/**
 * 
 * @returns {import("socket.io").Server}
 */
function getIO() {
  if (!io) {
    throw new Error("socket server has not been initialized.");
  }

  return io;
}

/**
 * Stand up a new websocket channel for a recording session.
 *
 * Socket.IO rooms are created implicitly on first join, so there is nothing to
 * allocate here — this asserts the server is up so the REST layer fails loudly
 * at create time rather than when the first phone tries to connect.
 *
 * @param {string} sessionId
 * @param {object} [options]
 * @returns {Promise<object>} handle describing the created session socket
 */
export async function createRecordingSession(sessionId, options = {}) {
  getIO();
  return { sessionId, deviceCount: 0, devices: [] };
}

/**
 * Look up the live handle for a session, or undefined if none is hosted.
 * @param {string} sessionId
 * @returns {object | undefined}
 */
export async function getRecordingSession(sessionId) {
  // fetch all current sockets in the newest session
  const sockets = await getIO().in(sessionId).fetchSockets();
  return {
    deviceCount: sockets.length,
    devices: sockets.map((socket) => ({
      socketId: socket.id,
      deviceId: socket.data.deviceId ?? socket.id,
      deviceName: socket.data.deviceName ?? "Unnamed device",
    })),
  };
}

/**
 * Broadcast a synchronized recording start to every phone in the session.
 * Picks a single shared future wall-clock instant (Date.now() + lead time).
 * @param {string} sessionId
 * @returns {Promise<{ startAtEpochMs: number }>}
 */
export async function startSessionRecording(sessionId) {
  // The lead time is what makes this synchronized: rather than "start now",
  // every device is given the same wall-clock instant a few seconds out and
  // counts down to it against its own measured clock offset. Without this
  // payload each phone would simply start whenever the packet happened to
  // arrive, which is the problem the whole design exists to avoid.
  const startAtEpochMs = Date.now() + RECORDING_LEAD_TIME_MS;

  getIO().to(sessionId).emit(EVENTS.RECORDING_STARTED, {
    sessionId,
    startAtEpochMs,
  });

  return { startAtEpochMs };
}

/**
 * Broadcast a recording stop to every phone in the session.
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function stopSessionRecording(sessionId) {
  getIO().to(sessionId).emit(EVENTS.RECORDING_STOPPED, { sessionId });
}

/**
 * Tear down a session's websocket channel and free its registry entry.
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function closeSessionSocket(sessionId) {
  // TODO: disconnect room members, delete from sessionSockets.
  const server = getIO();

  server.to(sessionId).emit(EVENTS.CLOSE_SESSION);
  const sockets = await server.in(sessionId).fetchSockets();
  for (const socket of sockets) {
    socket.leave(sessionId);
  }
}