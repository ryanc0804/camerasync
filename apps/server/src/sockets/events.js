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
  // a camera's recording stopped because its app left the screen mid-take
  CAMERA_DROPPED: "recording:dropped",
};
