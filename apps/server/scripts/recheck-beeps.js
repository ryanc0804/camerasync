// Finds the start and end beeps again in recordings already uploaded, with
// the current detector, and corrects what's stored. Uploads before
// 2026-10-21 measured the beep from the start of the sound track rather
// than the video, which put about a third of iPhone angles 50-70 ms off.
//
//   node scripts/recheck-beeps.js            list what would change
//   node scripts/recheck-beeps.js --apply    and save it
//
// On the production host:
//   docker compose --env-file deploy/prod.env -f deploy/docker-compose.prod.yml \
//     exec server node scripts/recheck-beeps.js [--apply]
//
// Each video is copied to a temp file one at a time and removed after.

import "dotenv/config";

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { pool } from "../src/db/pool.js";
import { findEndBeep, findSyncBeep } from "../src/recordings/syncBeep.js";
import { UPLOAD_DIR, storage } from "../src/storage/index.js";

const apply = process.argv.includes("--apply");

const { rows } = await pool.query(
  `SELECT session_id, user_id, started_at_ms, file_id, beep_at_ms, end_beep_at_ms
     FROM recording_session_videos
    WHERE file_id IS NOT NULL
    ORDER BY started_at_ms`
);

const tempDir = path.join(UPLOAD_DIR, "incoming");
await fsp.mkdir(tempDir, { recursive: true });

let changed = 0;
let failed = 0;
for (const row of rows) {
  const tempPath = path.join(tempDir, `recheck-${row.file_id}`);
  try {
    await pipeline(await storage.open(row.file_id), fs.createWriteStream(tempPath));
    const beepAtMs = await findSyncBeep(tempPath);
    const endBeepAtMs = await findEndBeep(tempPath);
    const before = [row.beep_at_ms, row.end_beep_at_ms].map((v) => (v == null ? null : Number(v)));
    if (before[0] === beepAtMs && before[1] === endBeepAtMs) continue;

    changed += 1;
    console.log(
      `${row.session_id} user ${row.user_id} take ${row.started_at_ms}: ` +
        `start beep ${before[0]} -> ${beepAtMs}, end beep ${before[1]} -> ${endBeepAtMs}`
    );
    if (apply) {
      await pool.query(
        `UPDATE recording_session_videos SET beep_at_ms = $5, end_beep_at_ms = $6
          WHERE session_id = $1 AND user_id = $2 AND started_at_ms = $3 AND file_id = $4`,
        [row.session_id, row.user_id, row.started_at_ms, row.file_id, beepAtMs, endBeepAtMs]
      );
    }
  } catch (err) {
    failed += 1;
    console.error(`${row.file_id}: ${err.message}`);
  } finally {
    await fsp.rm(tempPath, { force: true });
  }
}

console.log(
  `${rows.length} videos checked, ${changed} ${apply ? "updated" : "would change"}` +
    `${failed ? `, ${failed} could not be read` : ""}.` +
    `${!apply && changed ? " Run with --apply to save." : ""}`
);
await pool.end();
