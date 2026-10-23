// A still picture from each video, for the session lists (Sessions, recent
// sessions on Home), which otherwise show a gray box.
//
// One frame a second or so in (past the first frame, which is often dark
// while the camera settles), 480 px on its longer side, as a JPEG. Made in
// the background after the upload, from the small preview when there is
// one, one at a time. Videos from before thumbnails existed are worked
// through when the server starts. Without ffmpeg nothing is made and the
// lists keep their gray boxes.

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { pool } from "../db/pool.js";
import { storage } from "../storage/index.js";
import { run } from "./previews.js";

export const THUMBNAIL_SIZE = 480;

// The ffmpeg arguments for a thumbnail [atSeconds] into [input].
export function thumbnailArgs(input, output, atSeconds) {
  return [
    "-v", "error", "-y", "-ss", String(atSeconds), "-i", input,
    "-frames:v", "1",
    "-vf", `scale='if(gte(iw,ih),min(${THUMBNAIL_SIZE},iw),-2)':'if(gte(iw,ih),-2,min(${THUMBNAIL_SIZE},ih))'`,
    "-q:v", "4", "-f", "image2", output,
  ];
}

let ffmpegMissing = false;

// Makes the thumbnail for one stored video (by its original's file id) and
// records it on the video's row.
export async function makeThumbnail(fileId) {
  const { rows } = await pool.query(
    `SELECT preview_file_id FROM recording_session_videos
      WHERE file_id = $1 AND thumbnail_file_id IS NULL`,
    [fileId]
  );
  if (rows.length === 0) return "skipped";
  // The preview is the same picture, smaller to fetch.
  const sourceId = rows[0].preview_file_id || fileId;
  const work = path.join(storage.incomingDir, `thumb-${crypto.randomUUID()}`);
  const source = `${work}-source${path.extname(sourceId)}`;
  const output = `${work}.jpg`;
  try {
    await pipeline(await storage.open(sourceId), fs.createWriteStream(source));
    let made = false;
    // A second in, or the very start for a take shorter than that.
    for (const at of [1, 0]) {
      const result = await run("ffmpeg", thumbnailArgs(source, output, at), { timeoutMs: 120_000 });
      if (result.missing) {
        ffmpegMissing = true;
        return "missing";
      }
      const size = result.ok ? (await fsp.stat(output).catch(() => ({ size: 0 }))).size : 0;
      if (size > 0) {
        made = true;
        break;
      }
    }
    if (!made) throw new Error("ffmpeg made no picture");

    const thumbnailId = `${crypto.randomUUID().replace(/-/g, "")}.jpg`;
    await storage.put({ fileId: thumbnailId, tempPath: output, contentType: "image/jpeg" });
    const { rowCount } = await pool.query(
      `UPDATE recording_session_videos SET thumbnail_file_id = $2
        WHERE file_id = $1 AND thumbnail_file_id IS NULL`,
      [fileId, thumbnailId]
    );
    // The video was deleted (or got a thumbnail) meanwhile.
    if (rowCount === 0) await storage.remove([thumbnailId]);
    return "made";
  } catch (err) {
    console.error(`[thumbnails] ${fileId}: ${err.message}`);
    await pool.query(
      "UPDATE recording_session_videos SET thumbnail_failed = TRUE WHERE file_id = $1",
      [fileId]
    ).catch(() => {});
    return "failed";
  } finally {
    await fsp.rm(source, { force: true }).catch(() => {});
    await fsp.rm(output, { force: true }).catch(() => {});
  }
}

const queue = [];
const queued = new Set();
let draining = false;

export function queueThumbnail(fileId) {
  if (ffmpegMissing || !fileId || queued.has(fileId)) return;
  queued.add(fileId);
  queue.push(fileId);
  if (!draining) drain();
}

async function drain() {
  draining = true;
  while (queue.length > 0 && !ffmpegMissing) {
    const fileId = queue.shift();
    try {
      await makeThumbnail(fileId);
    } finally {
      queued.delete(fileId);
    }
  }
  queue.length = 0;
  queued.clear();
  draining = false;
}

// Videos without a thumbnail yet, newest first, once the server is up.
export function startThumbnailBackfill({ delayMs = 20_000 } = {}) {
  const timer = setTimeout(async () => {
    try {
      const { rows } = await pool.query(
        `SELECT file_id FROM recording_session_videos
          WHERE file_id IS NOT NULL AND thumbnail_file_id IS NULL AND NOT thumbnail_failed
          ORDER BY started_at_ms DESC`
      );
      if (rows.length > 0) console.log(`[thumbnails] ${rows.length} video(s) to do`);
      for (const { file_id: fileId } of rows) queueThumbnail(fileId);
    } catch (err) {
      console.error("[thumbnails] backfill failed:", err);
    }
  }, delayMs);
  timer.unref();
  return timer;
}
