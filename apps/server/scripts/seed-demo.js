// Fills the local dev database with a believable demo: UCF teams, members,
// past sessions with multi-angle recordings and timestamped comments, and
// upcoming sessions on the calendar. Safe to re-run; it replaces only its own
// data (the demo users below and their groups).
//
//   node scripts/seed-demo.js                 reset the demo data
//   node scripts/seed-demo.js --collect-clips save clips uploaded by the
//                                             clip helper, then reset
//
// Recordings need real video files. They come from uploads/demo-clips/
// (angle-1.webm, angle-2.webm, ...). When that folder is empty the script
// creates a helper account and session to upload sample clips into, prints
// how, and seeds everything else with "Not uploaded" angles.
//
// Every demo account signs in with DEMO_PASSWORD. The main one is
// demo.ryan@knights.ucf.edu (owner of UCF Cheer).

import "dotenv/config";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import bcrypt from "bcryptjs";
import pg from "pg";

const DEMO_PASSWORD = "8kount-demo";
const SERVER_ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(SERVER_ROOT, "uploads");
const CLIP_DIR = path.join(UPLOAD_DIR, "demo-clips");
const CLIP_SECONDS = 20;

const CLIP_HELPER = {
  key: "clips",
  email: "demo.clips@knights.ucf.edu",
  name: "Demo clip uploader",
};
const CLIP_GROUP = "zzdemoclips";
const CLIP_SESSION = "clips1";

const USERS = [
  { key: "ryan", name: "Ryan Cannon" },
  { key: "coach", name: "Coach Taylor Brooks" },
  { key: "maya", name: "Maya Chen" },
  { key: "jordan", name: "Jordan Reyes" },
  { key: "sofia", name: "Sofia Martinez" },
  { key: "andre", name: "Andre Williams" },
  { key: "priya", name: "Priya Patel" },
  { key: "hannah", name: "Hannah Kim" },
  { key: "marcus", name: "Marcus Johnson" },
  { key: "elijah", name: "Elijah Carter" },
  { key: "diego", name: "Diego Alvarez" },
  { key: "alex", name: "Alex Rivera" },
].map((u) => ({ ...u, email: `demo.${u.key}@knights.ucf.edu` }));

// Joined in this order, so UCF Cheer is Ryan's default group.
const GROUPS = [
  {
    id: "ucfcheer",
    name: "UCF Cheer",
    owner: "ryan",
    color: "#ead217",
    members: { coach: "admin", maya: "member", jordan: "member",
      sofia: "member", andre: "member", alex: "viewer" },
    // Days ago, for members who joined recently (they show in notifications).
    recentJoins: { alex: 1 },
  },
  {
    id: "ucfdance",
    name: "UCF Dance Team",
    owner: "coach",
    color: "#7c3aed",
    members: { ryan: "admin", priya: "member", hannah: "member", sofia: "member" },
    recentJoins: { sofia: 6 },
  },
  {
    id: "knightsvb",
    name: "Knights Club Volleyball",
    owner: "marcus",
    color: "#38bdf8",
    members: { ryan: "member", elijah: "member", diego: "member", andre: "member" },
  },
];

const NOTES = {
  ucfcheer: [
    ["coach", "Left base is late on the dip. Watch the count of 3."],
    ["maya", "Great height on the extension here!"],
    ["coach", "Flyer needs to lock out her knees before the pop."],
    ["jordan", "Back spot hands on the ankles, not the calves."],
    ["ryan", "Cleanest rep so far. Use this one for the highlight reel."],
    ["sofia", "Arms need to hit the high V together on 5."],
    ["coach", "Landing is soft and controlled. Nice."],
    ["andre", "We drift to the right during the transition."],
  ],
  ucfdance: [
    ["coach", "Spacing on stage left is tight. Take one step out."],
    ["priya", "Turn sequence looks sharp from this angle."],
    ["hannah", "I'm a count behind on the arm wave, fixing it."],
    ["ryan", "Formation change is clean here."],
    ["coach", "Hold the final pose a full two counts."],
  ],
  knightsvb: [
    ["marcus", "Platform angle is too flat on this pass."],
    ["elijah", "Good read on the float serve."],
    ["diego", "Need to call it earlier, we both went for it."],
    ["ryan", "Footwork into the pass is much better than last week."],
  ],
};

// days: offset from today; recordings: [angle user keys per recording].
// A key ending in "?" is a member who joined but never uploaded.
const SESSIONS = [
  { group: "ucfcheer", name: "Stunt practice", days: -2, hour: 18, by: "ryan",
    recordings: [["ryan", "maya", "jordan", "sofia"], ["ryan", "maya", "jordan", "sofia"]] },
  { group: "ucfcheer", name: "Pyramid run-through", days: -5, hour: 17, by: "coach",
    recordings: [["coach", "andre", "maya"], ["coach", "andre", "maya"], ["coach", "andre", "maya"]] },
  { group: "ucfcheer", name: "Tumbling passes", days: -9, hour: 16, by: "ryan",
    recordings: [["ryan", "sofia"]] },
  { group: "ucfcheer", name: "Full-out routine", days: -14, hour: 18, by: "coach",
    recordings: [["coach", "ryan", "jordan", "andre?"], ["coach", "ryan", "jordan", "andre"]] },
  { group: "ucfcheer", name: "Game day warm-up", days: 2, hour: 15, by: "ryan" },
  { group: "ucfcheer", name: "Stunt practice", days: 4, hour: 18, by: "ryan" },
  { group: "ucfcheer", name: "Full-out routine", days: 8, hour: 18, by: "coach" },
  { group: "ucfcheer", name: "Morning conditioning", days: 1, hour: 7, by: "coach",
    status: "cancelled" },

  { group: "ucfdance", name: "Jazz combo", days: -3, hour: 19, by: "coach",
    recordings: [["coach", "priya", "hannah"], ["coach", "priya", "ryan"]] },
  { group: "ucfdance", name: "Pom routine run-through", days: -7, hour: 19, by: "ryan",
    recordings: [["ryan", "priya", "sofia"]] },
  { group: "ucfdance", name: "Halftime rehearsal", days: 3, hour: 19, by: "coach" },
  { group: "ucfdance", name: "Choreo cleaning", days: 6, hour: 20, by: "ryan" },

  { group: "knightsvb", name: "Serve receive drills", days: -4, hour: 20, by: "marcus",
    recordings: [["marcus", "elijah", "ryan"], ["marcus", "diego", "ryan"]] },
  { group: "knightsvb", name: "Scrimmage vs. FSU club", days: 5, hour: 20, by: "marcus" },
];

function sessionId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.randomBytes(6), (b) => chars[b % chars.length]).join("");
}

function atLocal(days, hour) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function clipFiles() {
  if (!fs.existsSync(CLIP_DIR)) return [];
  return fs.readdirSync(CLIP_DIR)
    .filter((f) => /^angle-\d+\.\w+$/.test(f))
    .sort((a, b) => parseInt(a.slice(6), 10) - parseInt(b.slice(6), 10))
    .map((f) => path.join(CLIP_DIR, f));
}

// Each video row gets its own file (a hard link where the disk allows), so
// deleting one session in the app never breaks another's playback.
function placeClip(source) {
  const fileId = `${crypto.randomBytes(16).toString("hex")}${path.extname(source)}`;
  const target = path.join(UPLOAD_DIR, fileId);
  try {
    fs.linkSync(source, target);
  } catch {
    fs.copyFileSync(source, target);
  }
  return fileId;
}

async function removeDemo(db) {
  const emails = [...USERS, CLIP_HELPER].map((u) => u.email);
  const groupIds = [...GROUPS.map((g) => g.id), CLIP_GROUP];
  const { rows: files } = await db.query(
    `SELECT v.file_id FROM recording_session_videos v
       JOIN recording_sessions rs ON rs.id = v.session_id
      WHERE rs.group_id = ANY($1) AND v.file_id IS NOT NULL`,
    [groupIds]
  );
  for (const { file_id: fileId } of files) {
    if (/^[0-9a-f]{32}\.[a-z0-9]{2,4}$/.test(fileId)) {
      fs.rmSync(path.join(UPLOAD_DIR, fileId), { force: true });
    }
  }
  await db.query("DELETE FROM groups WHERE group_id = ANY($1)", [groupIds]);
  await db.query(
    "DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM users WHERE email = ANY($1))",
    [emails]
  );
  await db.query("DELETE FROM users WHERE email = ANY($1)", [emails]);
}

async function insertUser(db, user, hash) {
  const { rows } = await db.query(
    `INSERT INTO users (email, display_name, password, email_verified_at)
     VALUES ($1, $2, $3, NOW()) RETURNING user_id`,
    [user.email, user.name, hash]
  );
  return Number(rows[0].user_id);
}

async function collectClips(db) {
  const { rows } = await db.query(
    `SELECT file_id FROM recording_session_videos
      WHERE session_id = $1 AND file_id IS NOT NULL ORDER BY started_at_ms`,
    [CLIP_SESSION]
  );
  if (rows.length === 0) {
    throw new Error("No uploaded clips found in the helper session.");
  }
  fs.rmSync(CLIP_DIR, { recursive: true, force: true });
  fs.mkdirSync(CLIP_DIR, { recursive: true });
  rows.forEach(({ file_id: fileId }, i) => {
    fs.copyFileSync(
      path.join(UPLOAD_DIR, fileId),
      path.join(CLIP_DIR, `angle-${i + 1}${path.extname(fileId)}`)
    );
  });
  console.log(`Saved ${rows.length} clips to ${CLIP_DIR}`);
}

async function seed(db) {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const ids = {};
  for (const user of USERS) ids[user.key] = await insertUser(db, user, hash);

  let joined = Date.now() - 60 * 24 * 3600 * 1000;
  for (const group of GROUPS) {
    await db.query(
      `INSERT INTO groups (group_id, name, is_public, owner_id, primary_color)
       VALUES ($1, $2, TRUE, $3, $4)`,
      [group.id, group.name, ids[group.owner], group.color]
    );
    const roles = { [group.owner]: "admin", ...group.members };
    for (const [key, role] of Object.entries(roles)) {
      joined += 60 * 1000;
      const daysAgo = group.recentJoins?.[key];
      const joinedAt = daysAgo
        ? new Date(Date.now() - daysAgo * 24 * 3600 * 1000 - 3 * 3600 * 1000)
        : new Date(joined);
      await db.query(
        `INSERT INTO group_members (group_id, user_id, role, joined_at)
         VALUES ($1, $2, $3, $4)`,
        [group.id, ids[key], role, joinedAt]
      );
    }
  }

  const clips = clipFiles();
  let videoCount = 0;
  let noteCount = 0;
  for (const s of SESSIONS) {
    const id = sessionId();
    const scheduledAt = atLocal(s.days, s.hour);
    const status = s.status ?? (s.days < 0 ? "complete" : "scheduled");
    await db.query(
      `INSERT INTO recording_sessions (id, group_id, name, scheduled_at, created_at, created_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, s.group, s.name, scheduledAt,
        new Date(scheduledAt.getTime() - 3 * 24 * 3600 * 1000), ids[s.by], status]
    );
    if (!s.recordings) continue;

    const participants = new Set(s.recordings.flat().map((k) => k.replace("?", "")));
    for (const key of participants) {
      await db.query(
        `INSERT INTO recording_session_participants (session_id, user_id) VALUES ($1, $2)`,
        [id, ids[key]]
      );
    }
    // Whoever scheduled it started it at the scheduled time; the rest joined
    // over the next few minutes. The first row is the "started" notification.
    const joiners = [s.by, ...[...participants].filter((key) => key !== s.by)];
    for (const [i, key] of joiners.entries()) {
      await db.query(
        `INSERT INTO recording_session_members (session_id, user_id, joined_at)
         VALUES ($1, $2, $3)`,
        [id, ids[key], new Date(scheduledAt.getTime() + i * 2 * 60 * 1000)]
      );
    }
    const usedNotes = new Set();

    const notes = NOTES[s.group];
    for (const [r, angles] of s.recordings.entries()) {
      const startedAtMs = scheduledAt.getTime() + (10 + r * 12) * 60 * 1000;
      await db.query(
        `INSERT INTO session_recordings (session_id, started_at_ms, recording_number)
         VALUES ($1, $2, $3)`,
        [id, startedAtMs, r + 1]
      );
      for (const [a, angleKey] of angles.entries()) {
        const missing = angleKey.endsWith("?");
        const key = angleKey.replace("?", "");
        const fileId = !missing && clips.length > 0
          ? placeClip(clips[a % clips.length])
          : null;
        await db.query(
          `INSERT INTO recording_session_videos (session_id, user_id, started_at_ms, file_id)
           VALUES ($1, $2, $3, $4)`,
          [id, ids[key], startedAtMs, fileId]
        );
        videoCount += 1;
      }
      // A few comments per recording, spread through the clip.
      const count = 2 + ((r + s.name.length) % 3);
      for (let n = 0; n < count; n += 1) {
        // Each comment once per session, until the group's list runs out.
        let pick = (r * 3 + n + s.days * -1) % notes.length;
        for (let tries = 0; usedNotes.has(pick) && tries < notes.length; tries += 1) {
          pick = (pick + 1) % notes.length;
        }
        usedNotes.add(pick);
        const [author, body] = notes[pick];
        const atMs = Math.round(((n + 1) / (count + 1)) * CLIP_SECONDS * 1000);
        // Written while watching back that evening, not all at seed time.
        const writtenAt = new Date(startedAtMs + (90 + r * 25 + n * 9) * 60 * 1000);
        await db.query(
          `INSERT INTO session_notes
             (session_id, started_at_ms, user_id, body, video_time_ms, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, startedAtMs, ids[author], body, atMs, writtenAt]
        );
        noteCount += 1;
      }
    }
  }

  console.log(
    `Seeded ${USERS.length} users, ${GROUPS.length} groups, ${SESSIONS.length} sessions, ` +
    `${videoCount} angles (${clips.length ? "with video" : "no clips yet"}), ${noteCount} comments.`
  );
  return clips.length;
}

async function prepareClipUpload(db) {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const helper = await insertUser(db, CLIP_HELPER, hash);
  await db.query(
    `INSERT INTO groups (group_id, name, is_public, owner_id) VALUES ($1, 'Demo clips', TRUE, $2)`,
    [CLIP_GROUP, helper]
  );
  await db.query(
    `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'admin')`,
    [CLIP_GROUP, helper]
  );
  await db.query(
    `INSERT INTO recording_sessions (id, group_id, name, scheduled_at, created_by, status)
     VALUES ($1, $2, 'Demo clips', NOW(), $3, 'active')`,
    [CLIP_SESSION, CLIP_GROUP, helper]
  );
  await db.query(
    `INSERT INTO recording_session_participants (session_id, user_id) VALUES ($1, $2)`,
    [CLIP_SESSION, helper]
  );
  console.log(
    `No clips in ${CLIP_DIR}. Sign in as ${CLIP_HELPER.email}, upload clips to ` +
    `/api/files/upload?sessionId=${CLIP_SESSION}&startedAt=1 (then 2, 3, ...), ` +
    "and run this script again with --collect-clips."
  );
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  if (process.argv.includes("--collect-clips")) await collectClips(db);
  await removeDemo(db);
  const clips = await seed(db);
  if (clips === 0) await prepareClipUpload(db);
  await db.query("COMMIT");
} catch (err) {
  await db.query("ROLLBACK");
  console.error(err);
  process.exitCode = 1;
} finally {
  await db.end();
}
