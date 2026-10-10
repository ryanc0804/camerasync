// Rewrites an uploaded video so it starts playing quickly and can be seeked,
// without re-encoding (the picture and sound are copied as they are):
//
//   - Phones write the MP4's index (the moov box) at the end of the file, so
//     a player has to fetch the end before it can show the first frame.
//     -movflags +faststart moves it to the front.
//   - Chrome's recorder writes WebM with no seek index (Cues) and no length,
//     so the first seek (playback skips each angle ahead to line them up)
//     stalls. Copying it through ffmpeg writes both.
//
// Needs ffmpeg (in the server image). Without it, or if ffmpeg fails, the
// upload keeps its original file and plays as before.

import { spawn } from "node:child_process";
import fsp from "node:fs/promises";

const FORMATS = {
  ".mp4": { format: "mp4", args: ["-movflags", "+faststart"] },
  ".m4v": { format: "mp4", args: ["-movflags", "+faststart"] },
  ".mov": { format: "mov", args: ["-movflags", "+faststart"] },
  ".3gp": { format: "3gp", args: ["-movflags", "+faststart"] },
  ".webm": { format: "webm", args: [] },
  ".mkv": { format: "matroska", args: [] },
};

function run(args, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("ffmpeg", args, { stdio: "ignore" });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

/// Rewrites the file at `filePath` in place for streaming. Returns whether it
/// did; never throws.
export async function remuxForStreaming(filePath, extension, { timeoutMs = 120000 } = {}) {
  const target = FORMATS[extension?.toLowerCase()];
  if (!target) return false;
  const output = `${filePath}.remux`;
  try {
    const ok = await run(
      ["-v", "error", "-y", "-i", filePath, "-map", "0", "-c", "copy",
        ...target.args, "-f", target.format, output],
      timeoutMs
    );
    if (!ok) return false;
    // An empty result means ffmpeg had nothing to copy; keep the original.
    const { size } = await fsp.stat(output);
    if (size === 0) return false;
    await fsp.rename(output, filePath);
    return true;
  } catch {
    return false;
  } finally {
    await fsp.rm(output, { force: true }).catch(() => {});
  }
}
