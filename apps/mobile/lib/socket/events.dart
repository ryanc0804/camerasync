// Mirror of apps/server/src/sockets/events.js — keep these strings in sync
// with the server so the contract never drifts.
class Events {
  static const timeSync = 'time:sync';

  static const joinSession = 'session:join';
  static const leaveSession = 'session:leave';
  static const deviceList = 'session:devices';

  static const startRecording = 'recording:start';
  static const stopRecording = 'recording:stop';
  static const recordingStarted = 'recording:started';
  static const recordingStopped = 'recording:stopped';
}
