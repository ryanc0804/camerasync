// Single source of truth for Socket.IO event names. The web and mobile
// clients should mirror these strings so the contract never drifts.
export const EVENTS = {
  // --- Time sync (TrueTime-style clock offset) ---
  // Client emits TIME_SYNC with its local send time; server replies with its
  // own time so the client can compute (offset, round-trip delay).
  TIME_SYNC: "time:sync",

  // --- Session membership ---
  JOIN_SESSION: "session:join", // { sessionId, deviceName }
  SESSION_JOINED: "session:device-joined", // {sessionId, deviceId}
  LEAVE_SESSION: "session:leave", // { sessionId }
  DEVICE_LIST: "session:devices", // server -> room: current connected devices
  CLOSE_SESSION: "session:close",

  // SESSION EMITTERS
  SESSION_JOINED: "session:device-joined", // {sessionId, deviceId}
  SESSION_LEFT: "session:device-left", // {deviceId}


  // --- Recording control (admin-initiated, broadcast to whole room) ---
  START_RECORDING: "recording:start", // admin -> server: { sessionId }
  STOP_RECORDING: "recording:stop", // admin -> server: { sessionId }
  RECORDING_STARTED: "recording:started", // server -> room: { sessionId, startAtEpochMs }
  RECORDING_STOPPED: "recording:stopped", // server -> room: { sessionId }
};

// How far in the future a synchronized start is scheduled, giving every device
// time to receive the broadcast and arm its camera before the shared start.
export const RECORDING_LEAD_TIME_MS = 3000;
