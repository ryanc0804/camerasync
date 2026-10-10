// The sync beep: a short two-tone chirp the device that starts a take plays
// a moment after the shared start, like a film clapboard. The server finds
// it in every angle's audio and lines the angles up by it (see
// apps/server/src/recordings/syncBeep.js, which listens for these tones;
// keep them in step, and with the mobile app's lib/sync_beep.dart).
export const SYNC_BEEP_TONES_HZ = [2800, 4200];
export const SYNC_BEEP_TONE_MS = 120;

/// Plays the beep through `audioContext` at `whenSeconds` on its clock.
export function playSyncBeep(audioContext, whenSeconds) {
  const toneSeconds = SYNC_BEEP_TONE_MS / 1000;
  const ramp = 0.005;
  SYNC_BEEP_TONES_HZ.forEach((hz, index) => {
    const start = whenSeconds + index * toneSeconds;
    const end = start + toneSeconds;
    const tone = audioContext.createOscillator();
    tone.type = "sine";
    tone.frequency.value = hz;
    // Short ramps so the tones don't click, which would smear their pitch.
    const volume = audioContext.createGain();
    volume.gain.setValueAtTime(0, start);
    volume.gain.linearRampToValueAtTime(0.7, start + ramp);
    volume.gain.setValueAtTime(0.7, end - ramp);
    volume.gain.linearRampToValueAtTime(0, end);
    tone.connect(volume).connect(audioContext.destination);
    tone.start(start);
    tone.stop(end + ramp);
  });
}
