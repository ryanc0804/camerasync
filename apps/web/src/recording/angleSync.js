// Keeps a take's angles on one timeline while they play, so every angle
// shows the same real moment. Each video is untouched: this only decides
// which of its frames is on screen when.
//
// Browsers play each video on its own clock and they drift apart. An angle
// a little off plays slightly faster or slower (speedFor) until it's back in
// line, which can't be seen; one far off (it stalled to load) jumps back.
// Same rules as the phone app's lib/playback/angle_sync.dart.

// Closer than this counts as in line: under half a frame at 30 fps.
export const IN_LINE_MS = 15;
// Further than this is caught up by jumping straight to the right frame.
export const JUMP_BEYOND_MS = 400;
// The most an angle's speed is changed by while catching up (5%).
export const MAX_NUDGE = 0.05;

/// Speed for an angle `driftMs` ahead of where it should be (negative:
/// behind). Corrects about two thirds of the drift each second.
export function speedFor(driftMs) {
  if (Math.abs(driftMs) <= IN_LINE_MS) return 1;
  const nudge = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, (driftMs / 1000) * 0.66));
  return 1 - nudge;
}
