// The sync beep: a short two-tone chirp the device that starts a take plays
// SYNC_BEEP_DELAY_MS after the shared start time, like a film clapboard.
// Every camera in the room hears it at the same real instant, so where it
// lands in each video says exactly when that camera really started, whatever
// the network or the phone's camera start-up did. Device-reported start
// times can't see a phone's camera warming up after it says it has started
// (0.7 s on a Galaxy S24+), so this is what lines the angles up.
//
// The web (src/recording/syncBeep.js) and mobile (lib/sync_beep.dart) apps
// play the same tones; keep the three in step.

import { spawn } from "node:child_process";

/// How long after the shared start the beep plays: late enough that every
/// camera is rolling, phones included.
export const SYNC_BEEP_DELAY_MS = 1500;

/// Two tones back to back, each TONE_MS long. A pair at fixed pitches and
/// timing is very unlikely to occur in music or a gym by chance.
export const SYNC_BEEP_TONES_HZ = [2800, 4200];
export const SYNC_BEEP_TONE_MS = 120;

const SAMPLE_RATE = 16000;
const HOP = 80; // 5 ms
const WINDOW = 320; // 20 ms
// How much of a window's energy has to sit at the tone's pitch, averaged
// over a tone, to count. A clean beep scores near 1; speech and music stay
// well under 0.1.
const MIN_SCORE = 0.3;
// Only the start of a video is searched: the beep comes 1.5 s after the
// shared start, and cameras begin within a few seconds of it.
const SEARCH_SECONDS = 10;

// Share of a window's energy at `freq`, from a Goertzel filter: 1 for a pure
// tone at that pitch, near 0 for anything else.
function toneShare(samples, start, freq) {
  const coeff = 2 * Math.cos((2 * Math.PI * freq) / SAMPLE_RATE);
  let s1 = 0;
  let s2 = 0;
  let energy = 0;
  for (let i = start; i < start + WINDOW; i += 1) {
    const x = samples[i];
    const s0 = x + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
    energy += x * x;
  }
  if (energy < 1e-9) return 0;
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return Math.min(1, power / ((energy * WINDOW) / 2));
}

/// Where the sync beep starts in `samples` (mono, 16 kHz), in ms from the
/// start, or null when there isn't a clear one.
export function detectSyncBeep(samples) {
  const frames = Math.floor((samples.length - WINDOW) / HOP) + 1;
  if (frames <= 0) return null;
  const [lowHz, highHz] = SYNC_BEEP_TONES_HZ;
  const low = new Float32Array(frames);
  const high = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    low[f] = toneShare(samples, f * HOP, lowHz);
    high[f] = toneShare(samples, f * HOP, highHz);
  }

  // Frames whose whole window falls inside one tone.
  const toneFrames = Math.round((SYNC_BEEP_TONE_MS * SAMPLE_RATE) / 1000 / HOP);
  const inside = toneFrames - Math.ceil(WINDOW / HOP) + 1;
  const mean = (values, from) => {
    let sum = 0;
    for (let f = from; f < from + inside; f += 1) sum += values[f];
    return sum / inside;
  };

  let best = null;
  for (let f = 0; f + toneFrames + inside <= frames; f += 1) {
    const score = Math.min(mean(low, f), mean(high, f + toneFrames));
    if (score >= MIN_SCORE && (!best || score > best.score)) best = { f, score };
  }
  return best ? Math.round((best.f * HOP * 1000) / SAMPLE_RATE) : null;
}

/// The first seconds of a video's audio as mono 16 kHz samples, via ffmpeg.
/// Null when ffmpeg is missing (local development on Windows), the file has
/// no audio, or decoding takes too long.
export function decodeAudioStart(filePath, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        "ffmpeg",
        ["-v", "error", "-t", String(SEARCH_SECONDS), "-i", filePath,
          "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "pipe:1"],
        { stdio: ["ignore", "pipe", "ignore"] }
      );
    } catch {
      resolve(null);
      return;
    }
    const chunks = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const bytes = Buffer.concat(chunks);
      if (code !== 0 || bytes.length < 4) {
        resolve(null);
        return;
      }
      // Copy into an aligned buffer; a Node Buffer may start at any offset.
      const aligned = new Uint8Array(bytes.length - (bytes.length % 4));
      aligned.set(bytes.subarray(0, aligned.length));
      resolve(new Float32Array(aligned.buffer));
    });
  });
}

/// Where the sync beep is in an uploaded video, in ms, or null. Never
/// throws: an upload must not fail because its audio couldn't be checked.
export async function findSyncBeep(filePath) {
  try {
    const samples = await decodeAudioStart(filePath);
    return samples ? detectSyncBeep(samples) : null;
  } catch {
    return null;
  }
}

/// A video's real start relative to its take's shared start, in ms, from
/// where the beep landed in it: the beep played SYNC_BEEP_DELAY_MS after the
/// shared start, so a camera that heard it `beepAtMs` in started that much
/// earlier than the beep.
export function startOffsetFromBeep(beepAtMs) {
  return SYNC_BEEP_DELAY_MS - beepAtMs;
}
