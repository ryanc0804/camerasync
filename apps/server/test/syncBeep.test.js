// Finding the sync beep in a video's audio, on synthetic 16 kHz audio.
import { describe, expect, it } from "vitest";

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  END_BEEP_TONES_HZ,
  SYNC_BEEP_DELAY_MS,
  SYNC_BEEP_TONES_HZ,
  SYNC_BEEP_TONE_MS,
  detectSyncBeep,
  findEndBeep,
  findSyncBeep,
  startOffsetFromBeep,
  startOffsetFromEndBeep,
} from "../src/recordings/syncBeep.js";

const RATE = 16000;

// Repeatable noise, so a failure can be reproduced.
function random(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function silence(seconds) {
  return new Float32Array(Math.round(seconds * RATE));
}

function addNoise(samples, level, seed = 1) {
  const next = random(seed);
  for (let i = 0; i < samples.length; i += 1) samples[i] += (next() * 2 - 1) * level;
  return samples;
}

// Music-like sound: a new three-note chord every 250 ms at random pitches.
function addMusic(samples, level, seed = 2) {
  const next = random(seed);
  const chord = Math.round(0.25 * RATE);
  for (let start = 0; start < samples.length; start += chord) {
    const pitches = [0, 1, 2].map(() => 110 + next() * 1800);
    for (let i = start; i < Math.min(samples.length, start + chord); i += 1) {
      for (const hz of pitches) samples[i] += (level / 3) * Math.sin((2 * Math.PI * hz * i) / RATE);
    }
  }
  return samples;
}

function addBeep(samples, atMs, level, tones = SYNC_BEEP_TONES_HZ) {
  const toneLength = Math.round((SYNC_BEEP_TONE_MS * RATE) / 1000);
  const start = Math.round((atMs * RATE) / 1000);
  tones.forEach((hz, t) => {
    for (let n = 0; n < toneLength; n += 1) {
      const i = start + t * toneLength + n;
      if (i < samples.length) samples[i] += level * Math.sin((2 * Math.PI * hz * n) / RATE);
    }
  });
  return samples;
}

describe("detectSyncBeep", () => {
  it("finds the beep in a noisy room to within 10 ms", () => {
    const audio = addBeep(addNoise(silence(6), 0.1), 1234, 0.3);
    expect(Math.abs(detectSyncBeep(audio) - 1234)).toBeLessThanOrEqual(10);
  });

  it("finds it under music", () => {
    const audio = addBeep(addMusic(addNoise(silence(6), 0.02), 0.3), 2710, 0.4);
    expect(Math.abs(detectSyncBeep(audio) - 2710)).toBeLessThanOrEqual(10);
  });

  it("finds nothing in music or noise without a beep", () => {
    expect(detectSyncBeep(addMusic(addNoise(silence(6), 0.05), 0.4))).toBeNull();
    expect(detectSyncBeep(addNoise(silence(6), 0.3))).toBeNull();
    expect(detectSyncBeep(silence(6))).toBeNull();
  });

  it("ignores a single tone at one of the beep's pitches", () => {
    const audio = addBeep(addNoise(silence(6), 0.05), 1000, 0.3, [2800, 2800]);
    expect(detectSyncBeep(audio)).toBeNull();
  });

  it("handles audio too short to hold a beep", () => {
    expect(detectSyncBeep(silence(0.1))).toBeNull();
    expect(detectSyncBeep(new Float32Array(0))).toBeNull();
  });
});

describe("startOffsetFromBeep", () => {
  it("turns where the beep landed into how late the camera started", () => {
    // A camera that heard the beep 0.7 s in started 0.8 s after the shared
    // start; one that heard it 1.5 s in started right on time.
    expect(startOffsetFromBeep(700)).toBe(SYNC_BEEP_DELAY_MS - 700);
    expect(startOffsetFromBeep(SYNC_BEEP_DELAY_MS)).toBe(0);
  });
});

describe("the end beep", () => {
  it("is found by its own tones and not taken for the start beep", () => {
    const audio = addBeep(addNoise(silence(6), 0.05), 3100, 0.3, END_BEEP_TONES_HZ);
    expect(Math.abs(detectSyncBeep(audio, END_BEEP_TONES_HZ) - 3100)).toBeLessThanOrEqual(10);
    expect(detectSyncBeep(audio)).toBeNull();
  });

  it("keeps the two apart in a short take that holds both", () => {
    const audio = addBeep(addNoise(silence(5), 0.05), 1500, 0.3);
    addBeep(audio, 2400, 0.3, END_BEEP_TONES_HZ);
    expect(Math.abs(detectSyncBeep(audio) - 1500)).toBeLessThanOrEqual(10);
    expect(Math.abs(detectSyncBeep(audio, END_BEEP_TONES_HZ) - 2400)).toBeLessThanOrEqual(10);
  });

  it("lines up a camera from where the end beep landed", () => {
    // The end beep played 20 s after the shared start and landed 18.3 s
    // into this video, so the camera started 1.7 s late.
    expect(startOffsetFromEndBeep(18300, 1_000_020_000, 1_000_000_000)).toBe(1700);
  });
});

// Through ffmpeg, as an upload is checked: a 25 s "video" whose start beep
// and end beep sit at known places.
describe("finding the beeps in a file", () => {
  let dir;
  function writeAudio(samples) {
    dir = mkdtempSync(path.join(tmpdir(), "beep-"));
    const raw = path.join(dir, "audio.f32");
    const file = path.join(dir, "take.m4a");
    writeFileSync(raw, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "f32le", "-ar", String(RATE),
      "-ac", "1", "-i", raw, "-c:a", "aac", file]);
    return file;
  }

  it("finds both, at the right places", async () => {
    let hasFfmpeg = true;
    try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch { hasFfmpeg = false; }
    if (!hasFfmpeg) return;
    const audio = addBeep(addNoise(silence(25), 0.05), 1500, 0.3);
    addBeep(audio, 23250, 0.3, END_BEEP_TONES_HZ);
    try {
      const file = writeAudio(audio);
      // AAC adds a little priming delay, well under a frame.
      expect(Math.abs((await findSyncBeep(file)) - 1500)).toBeLessThanOrEqual(30);
      expect(Math.abs((await findEndBeep(file)) - 23250)).toBeLessThanOrEqual(30);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

