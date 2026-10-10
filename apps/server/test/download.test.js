// GET /api/recordings/sessions/:id/download: a zip of every uploaded angle,
// a folder per recording. Run against the dev Postgres and the local-disk
// storage driver, like the other route tests.
import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/email/mailer.js", () => ({
  sendPasswordResetEmail: vi.fn(async () => {}),
  sendVerificationEmail: vi.fn(async () => {}),
}));

const { authRouter } = await import("../src/routes/auth.js");
const { groupRouter } = await import("../src/routes/groups.js");
const { recordingsRouter } = await import("../src/routes/recordings.js");
const { UPLOAD_DIR, storage } = await import("../src/storage/index.js");
const { pool } = await import("../src/db/pool.js");

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/auth", authRouter);
app.use("/api/groups", groupRouter);
app.use("/api/recordings", recordingsRouter);

const RUN = `${Date.now()}${process.pid}`;
const GROUP_ID = `zip${RUN}`;
const FILES = [`${RUN}a`.padEnd(32, "0") + ".mp4", `${RUN}b`.padEnd(32, "0") + ".webm"];

async function signUp(label) {
  const email = `download-test-${RUN}-${label}@ucf.edu`;
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name: label === "coach" ? "Coach Taylor" : "Stranger", email, password: "download-pass-1" });
  expect(res.status).toBe(201);
  await pool.query("UPDATE users SET email_verified_at = NOW() WHERE email = $1", [email]);
  return { cookie: res.headers["set-cookie"], id: res.body.user.id };
}

// Collects a binary response body as one Buffer.
function binary(res, done) {
  const chunks = [];
  res.on("data", (chunk) => chunks.push(chunk));
  res.on("end", () => done(null, Buffer.concat(chunks)));
}

let coach;
let stranger;
let sessionId;

beforeAll(async () => {
  coach = await signUp("coach");
  stranger = await signUp("stranger");
  expect((await request(app).post("/api/groups").set("Cookie", coach.cookie)
    .send({ id: GROUP_ID, name: "Zip Test", isPublic: true })).status).toBe(201);
  const live = await request(app).post("/api/recordings/sessions/live")
    .set("Cookie", coach.cookie).send({ groupId: GROUP_ID, name: "Stunt practice" });
  sessionId = live.body.session.id;

  // Two takes by the coach, stored straight on local disk.
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  for (const [i, fileId] of FILES.entries()) {
    fs.writeFileSync(path.join(UPLOAD_DIR, fileId), `video bytes ${i}`);
    await pool.query(
      `INSERT INTO recording_session_videos (session_id, user_id, started_at_ms, file_id)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, coach.id, 1_790_000_000_000 + i * 60_000, fileId]
    );
  }
});

afterAll(async () => {
  for (const fileId of FILES) fs.rmSync(path.join(UPLOAD_DIR, fileId), { force: true });
  await pool.query("DELETE FROM groups WHERE group_id = $1", [GROUP_ID]);
  await pool.query(
    "DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM users WHERE email LIKE $1)",
    [`download-test-${RUN}-%`]
  );
  await pool.query("DELETE FROM users WHERE email LIKE $1", [`download-test-${RUN}-%`]);
  await pool.end();
});

describe("GET /api/recordings/sessions/:id/download", () => {
  it("zips each recording's angles into its own folder", async () => {
    if (!storage.describe().startsWith("local")) return; // needs the local driver
    const res = await request(app)
      .get(`/api/recordings/sessions/${sessionId}/download`)
      .set("Cookie", coach.cookie)
      .buffer(true)
      .parse(binary);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="Stunt practice \d{4}-\d{2}-\d{2}\.zip"/);

    const zip = res.body;
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const text = zip.toString("latin1");
    expect(text).toContain("Recording 001/Coach Taylor.mp4");
    expect(text).toContain("Recording 002/Coach Taylor.webm");
    // Stored as-is, not recompressed.
    expect(text).toContain("video bytes 0");
    expect(text).toContain("video bytes 1");
  });

  it("is only for members of the session's group", async () => {
    const res = await request(app)
      .get(`/api/recordings/sessions/${sessionId}/download`)
      .set("Cookie", stranger.cookie);
    expect(res.status).toBe(404);
  });
});
