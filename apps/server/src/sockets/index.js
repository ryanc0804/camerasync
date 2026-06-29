import { EVENTS, RECORDING_LEAD_TIME_MS } from "./events.js";

// In-memory view of who is connected to each session room.
// Map<sessionId, Map<socketId, { deviceName }>>
// NOTE: in-memory only — fine for a single server during early development.
// Move to Redis (or the Socket.IO Redis adapter) when scaling past one node.
const sessions = new Map();

function roomFor(sessionId) {
  return `session:${sessionId}`;
}

function deviceListFor(sessionId) {
  const devices = sessions.get(sessionId);
  if (!devices) return [];
  return [...devices.entries()].map(([socketId, info]) => ({
    socketId,
    deviceName: info.deviceName,
  }));
}

export function registerSocketHandlers(io) {
  io.on("connection", (socket) => {
    console.log(`[socket] connected: ${socket.id}`);

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

    socket.on(EVENTS.JOIN_SESSION, ({ sessionId, deviceName } = {}) => {
      if (!sessionId) return;
      socket.join(roomFor(sessionId));
      socket.data.sessionId = sessionId;

      if (!sessions.has(sessionId)) sessions.set(sessionId, new Map());
      sessions.get(sessionId).set(socket.id, {
        deviceName: deviceName || "Unnamed device",
      });

      io.to(roomFor(sessionId)).emit(EVENTS.DEVICE_LIST, deviceListFor(sessionId));
      console.log(`[socket] ${socket.id} joined session ${sessionId}`);
    });

    socket.on(EVENTS.LEAVE_SESSION, ({ sessionId } = {}) => {
      leaveSession(socket, sessionId);
    });

    // Admin starts recording. The server picks a single future wall-clock
    // moment and broadcasts it; every device starts at that shared instant
    // (corrected by its own clock offset from TIME_SYNC).
    // TODO: verify this socket belongs to a session admin before broadcasting.
    socket.on(EVENTS.START_RECORDING, ({ sessionId } = {}) => {
      if (!sessionId) return;
      const startAtEpochMs = Date.now() + RECORDING_LEAD_TIME_MS;
      io.to(roomFor(sessionId)).emit(EVENTS.RECORDING_STARTED, {
        sessionId,
        startAtEpochMs,
      });
      console.log(`[socket] recording start for ${sessionId} @ ${startAtEpochMs}`);
    });

    socket.on(EVENTS.STOP_RECORDING, ({ sessionId } = {}) => {
      if (!sessionId) return;
      io.to(roomFor(sessionId)).emit(EVENTS.RECORDING_STOPPED, { sessionId });
      console.log(`[socket] recording stop for ${sessionId}`);
    });

    socket.on("disconnect", () => {
      leaveSession(socket, socket.data.sessionId);
      console.log(`[socket] disconnected: ${socket.id}`);
    });
  });

  function leaveSession(socket, sessionId) {
    if (!sessionId) return;
    socket.leave(roomFor(sessionId));
    const devices = sessions.get(sessionId);
    if (devices) {
      devices.delete(socket.id);
      if (devices.size === 0) sessions.delete(sessionId);
      else io.to(roomFor(sessionId)).emit(EVENTS.DEVICE_LIST, deviceListFor(sessionId));
    }
  }
}
