import { Server } from "socket.io";
import { createAdapter } from "@socket.io/postgres-adapter";

import {
  SESSION_COOKIE,
  getUserBySessionToken,
  publicUser,
} from "../auth/sessions.js";
import { pool } from "../db/pool.js";
import { DEFAULT_RECORDING_BUFFER_MS, EVENTS } from "./events.js";

const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:5173";
const MAX_RECORDING_BUFFER_MS = 60000;
let io = null;
const activeRecordings = new Map();
const recordingNumbers = new Map();

// keeps one socket room for each session
function roomName(sessionId) {
  return `recording:${sessionId}`;
}

// reads the login token from the socket cookie
function readCookie(cookieHeader, name) {
  const cookies = String(cookieHeader || "").split(";");

  for (const cookie of cookies) {
    const [cookieName, ...valueParts] = cookie.trim().split("=");
    if (cookieName === name) {
      return decodeURIComponent(valueParts.join("="));
    }
  }

  return null;
}

// gets each connected user once
async function getRoomMembers(sessionId) {
  const sockets = await getIO().in(roomName(sessionId)).fetchSockets();
  const members = new Map();

  for (const socket of sockets) {
    const user = socket.data.user;
    if (user) members.set(user.id, user);
  }

  return Array.from(members.values());
}

async function sendRoomMembers(sessionId) {
  const members = await getRoomMembers(sessionId);
  getIO().to(roomName(sessionId)).emit(EVENTS.SESSION_MEMBERS, members);
  return members;
}

// keeps the recording buffer safe and numeric
function cleanBuffer(bufferMs) {
  const number = Number(bufferMs);
  if (!Number.isFinite(number)) return DEFAULT_RECORDING_BUFFER_MS;
  return Math.min(MAX_RECORDING_BUFFER_MS, Math.max(0, Math.round(number)));
}

async function isSessionHost(socket, sessionId) {
  if (socket.data.sessionId !== sessionId) return false;

  const result = await pool.query(
    `SELECT 1
       FROM recording_sessions
      WHERE id = $1
        AND created_by = $2
        AND status = 'active'`,
    [sessionId, socket.data.user.id]
  );

  return result.rowCount > 0;
}

export async function initSocket(httpServer) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS socket_io (
      id BIGSERIAL UNIQUE PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      payload BYTEA
    )
  `);

  io = new Server(httpServer, {
    cors: {
      origin: WEB_ORIGIN,
      credentials: true,
    },
  });
  io.adapter(createAdapter(pool));

  // socket rooms use the same login cookie as the api
  io.use(async (socket, next) => {
    try {
      const token = readCookie(
        socket.handshake.headers.cookie,
        SESSION_COOKIE
      );
      const userRow = await getUserBySessionToken(token);

      if (!userRow) return next(new Error("Not authenticated"));

      socket.data.user = publicUser(userRow);
      next();
    } catch (err) {
      next(err);
    }
  });

  io.on("connection", (socket) => {
    socket.on(EVENTS.JOIN_SESSION, async ({ sessionId } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!sessionId) {
        return ack({ ok: false, error: "Session ID is required." });
      }

      try {
        const { rows } = await pool.query(
          `SELECT rs.id, rs.name, rs.created_by, rs.status
             FROM recording_sessions rs
             JOIN group_members gm
               ON gm.group_id = rs.group_id
              AND gm.user_id = $2
             JOIN recording_session_members rsm
               ON rsm.session_id = rs.id
              AND rsm.user_id = $2
            WHERE rs.id = $1
              AND rs.status = 'active'`,
          [sessionId, socket.data.user.id]
        );

        if (rows.length === 0) {
          return ack({
            ok: false,
            error: "This session is not live or you have not joined it.",
          });
        }

        const previousSessionId = socket.data.sessionId;
        if (previousSessionId && previousSessionId !== sessionId) {
          await socket.leave(roomName(previousSessionId));
          await sendRoomMembers(previousSessionId);
        }

        socket.data.sessionId = sessionId;
        await socket.join(roomName(sessionId));
        const members = await sendRoomMembers(sessionId);

        ack({
          ok: true,
          members,
          recording: activeRecordings.get(sessionId) ?? null,
          session: {
            id: rows[0].id,
            name: rows[0].name,
            createdBy: Number(rows[0].created_by),
            status: rows[0].status,
          },
        });
      } catch (err) {
        console.error("Unable to join Socket.IO session:", err);
        ack({ ok: false, error: "Unable to join the live session." });
      }
    });

    socket.on(EVENTS.LEAVE_SESSION, async () => {
      const sessionId = socket.data.sessionId;
      if (!sessionId) return;

      socket.data.sessionId = null;
      await socket.leave(roomName(sessionId));
      await sendRoomMembers(sessionId);
    });

    // lets the host send one shared recording start time
    socket.on(
      EVENTS.START_RECORDING,
      async ({ sessionId, bufferMs } = {}, ack = () => {}) => {
        try {
          if (!(await isSessionHost(socket, sessionId))) {
            return ack({
              ok: false,
              error: "Only the session creator can start recording.",
            });
          }

          const recording = await startSessionRecording(
            sessionId,
            cleanBuffer(bufferMs)
          );
          ack({ ok: true, recording });
        } catch (err) {
          ack({ ok: false, error: err.message });
        }
      }
    );

    // sends the stop command to every device in the room
    socket.on(
      EVENTS.STOP_RECORDING,
      async ({ sessionId } = {}, ack = () => {}) => {
        try {
          if (!(await isSessionHost(socket, sessionId))) {
            return ack({
              ok: false,
              error: "Only the session creator can stop recording.",
            });
          }

          const recording = await stopSessionRecording(sessionId);
          ack({ ok: true, recording });
        } catch (err) {
          ack({ ok: false, error: err.message });
        }
      }
    );

    socket.on("disconnect", async () => {
      const sessionId = socket.data.sessionId;
      if (sessionId) await sendRoomMembers(sessionId);
    });
  });

  return io;
}

function getIO() {
  if (!io) throw new Error("Socket server has not been initialized.");
  return io;
}

// keeps this available for parker's later recording work
export async function createRecordingSession(sessionId) {
  return getRecordingSession(sessionId);
}

export async function getRecordingSession(sessionId) {
  const sockets = await getIO().in(roomName(sessionId)).fetchSockets();
  return {
    deviceCount: sockets.length,
    devices: sockets.map((socket) => socket.data.user ?? { id: socket.id }),
    recording: activeRecordings.get(sessionId) ?? null,
  };
}

export async function startSessionRecording(
  sessionId,
  bufferMs = DEFAULT_RECORDING_BUFFER_MS
) {
  if (activeRecordings.has(sessionId)) {
    throw new Error("This session is already recording.");
  }

  const recordingNumber = (recordingNumbers.get(sessionId) ?? 0) + 1;
  const serverSentAtEpochMs = Date.now();
  const safeBufferMs = cleanBuffer(bufferMs);
  const recording = {
    sessionId,
    recordingNumber,
    bufferMs: safeBufferMs,
    serverSentAtEpochMs,
    startAtEpochMs: serverSentAtEpochMs + safeBufferMs,
  };

  recordingNumbers.set(sessionId, recordingNumber);
  activeRecordings.set(sessionId, recording);
  getIO().to(roomName(sessionId)).emit(EVENTS.RECORDING_STARTED, recording);
  return recording;
}

export async function stopSessionRecording(sessionId) {
  const recording = activeRecordings.get(sessionId);
  if (!recording) throw new Error("This session is not recording.");

  const stoppedRecording = {
    ...recording,
    stopAtEpochMs: Date.now(),
  };

  getIO()
    .to(roomName(sessionId))
    .emit(EVENTS.RECORDING_STOPPED, stoppedRecording);
  activeRecordings.delete(sessionId);
  return stoppedRecording;
}

export async function closeSessionSocket(sessionId) {
  const room = roomName(sessionId);
  if (activeRecordings.has(sessionId)) {
    await stopSessionRecording(sessionId);
  }
  getIO().to(room).emit(EVENTS.CLOSE_SESSION, { sessionId });
  getIO().in(room).socketsLeave(room);
}
