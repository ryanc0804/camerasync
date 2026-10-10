// socket.io event names shared by the web and mobile clients
export const EVENTS = {
  JOIN_SESSION: "session:join",
  LEAVE_SESSION: "session:leave",
  SESSION_MEMBERS: "session:members",
  CLOSE_SESSION: "session:close",

  START_RECORDING: "recording:start",
  STOP_RECORDING: "recording:stop",
  RECORDING_STARTED: "recording:started",
  RECORDING_STOPPED: "recording:stopped",
};

// Long enough for the start command to reach every device over the internet
// before the shared start time; 50 ms made phones start late.
export const DEFAULT_RECORDING_BUFFER_MS = 1500;