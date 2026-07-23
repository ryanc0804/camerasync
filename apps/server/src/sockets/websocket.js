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

    socket.on(EVENTS.JOIN_SESSION, async ({ sessionId, deviceId } = {}, ack) => {
      if (typeof ack !== "function") return; // client must pass a callback function
      if (!sessionId) return ack({ ok: false, error: "sessionId required" });

      try {
        const { recExists } = await pool.query(
          "SELECT status FROM recordings WHERE rec_id = $1"
          [sessionId]
        )

        if (recExists.length == 0 || recExists[0].status === "closed") {
          return ack({ ok: false, error: "session not found or has been closed." })
        }

        // join socket "room" that will run asynchronously depending on the session
        socket.join(sessionId);
        socket.data.sessionId = sessionId;
        socket.data.deviceId = deviceId ?? socket.id;

        // Fire device-joined event after successful connect and respond with success ACK packet
        socket.to(sessionId).emit(EVENTS.SESSION_JOINED, { deviceId: socket.data.deviceId });
        ack({ ok: true, status: recExists[0].status });
      } catch (err) {
        ack({ ok: false, error: "Internal server error with socket connection." })
      }
    })


    socket.on(EVENTS.LEAVE_SESSION, () => {
      const { sessionid, deviceId } = socket.data;
      if (sessionid) {
        socket.to(sessionid).emit(EVENTS.SESSION_LEFT, { deviceId });
      }
    });

  });

  return io;
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
 * Async so the manager can later back this with a store (Redis/db) that the
 * REST layer awaits before returning to the client.
 *
 * @param {import("socket.io").Server} io   shared Socket.IO server instance
 * @param {string} sessionId
 * @param {object} [options]
 * @returns {Promise<object>} handle describing the created session socket
 */
export async function createRecordingSession(io, sessionId, options = {}) {
  getIO()
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
    devices: sockets.map((socket) => socket.data.deviceId ?? socket.id),
  };
}

/**
 * Broadcast a synchronized recording start to every phone in the session.
 * Picks a single shared future wall-clock instant (Date.now() + lead time).
 * @param {string} sessionId
 * @returns {Promise<{ startAtEpochMs: number }>}
 */
export async function startSessionRecording(sessionId) {
  // TODO: resolve handle, compute startAtEpochMs, emit EVENTS.RECORDING_STARTED.
  const session = getIO();

  session.to(sessionId).emit(EVENTS.RECORDING_STARTED);
}

/**
 * Broadcast a recording stop to every phone in the session.
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function stopSessionRecording(sessionId) {
  // TODO: resolve handle, emit EVENTS.RECORDING_STOPPED.
  const session = getIO();

  session.to(sessionId).emit(EVENTS.RECORDING_STOPPED);
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