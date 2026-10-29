// A phone sends a small preview of a take before the full video, so the take
// can be watched within seconds on a slow connection. Run against the dev
// Postgres like the other route tests; needs ffmpeg to make the test videos.
import "dotenv/config";

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/email/mailer.js", () => ({
  sendPasswordResetEmail: vi.fn(async () => {}),
  sendVerificationEmail: vi.fn(async () => {}),
}));
// The server's own preview is made in the background after a full upload;
// not needed here.
vi.mock("../src/recordings/previews.js", () => ({
  queuePreview: vi.fn(),
  startPreviewBackfill: vi.fn(),
}));

const { authRouter } = await import("../src/routes/auth.js");
const { groupRouter } = await import("../src/routes/groups.js");
const { recordingsRouter } = await import("../src/routes/recordings.js");
const { fileRouter } = await import("../src/routes/file.js");
const { pool } = await import("../src/db/pool.js");

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/auth", authRouter);
app.use("/api/groups", groupRouter);
app.use("/api/recordings", recordingsRouter);
app.use("/api/files", fileRouter);

const RUN = `${Date.now()}${process.pid}`;
const GROUP_ID = `preview${RUN}`;
const EMAIL = `preview-test-${RUN}@ucf.edu`;

let hasFfmpeg = true;
try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch { hasFfmpeg = false; }

let cookie;
let sessionId;
let dir;
let preview;
let full;

beforeAll(async () => {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name: "Coach", email: EMAIL, password: "preview-test-pass-1" });
  expect(res.status).toBe(201);
  await pool.query("UPDATE users SET email_verified_at = NOW() WHERE email = $1", [EMAIL]);
  cookie = res.headers["set-cookie"];

  const group = await request(app)
    .post("/api/groups")
    .set("Cookie", cookie)
    .send({ id: GROUP_ID, name: "Previews", isPublic: true });
  expect(group.status).toBe(201);
  const live = await request(app)
    .post("/api/recordings/sessions/live")
    .set("Cookie", cookie)
    .send({ groupId: GROUP_ID, name: "Preview check" });
  sessionId = live.body.session.id;

  if (!hasFfmpeg) return;
  dir = mkdtempSync(path.join(tmpdir(), "preview-"));
  const make = (name, size) => {
    const file = path.join(dir, name);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i",
      `testsrc=size=${size}:rate=30:duration=2`, "-c:v", "libx264", "-preset", "ultrafast", file]);
    return file;
  };
  preview = make("preview.mp4", "320x240");
  full = make("full.mp4", "640x480");
});

afterAll(async () => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  await pool.query("DELETE FROM groups WHERE group_id = $1", [GROUP_ID]);
  await pool.query(
    "DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM users WHERE email = $1)",
    [EMAIL]
  );
  await pool.query("DELETE FROM users WHERE email = $1", [EMAIL]);
  await pool.end();
});

describe("preview first", () => {
  const upload = (file, startedAt, kind) =>
    request(app)
      .post(`/api/files/upload?sessionId=${sessionId}&startedAt=${startedAt}` +
        `&actualStartedAt=${startedAt + 120}&startClock=frame${kind ? `&kind=${kind}` : ""}`)
      .set("Cookie", cookie)
      .attach("file", file);
  const angle = async (startedAt) => {
    const res = await request(app)
      .get(`/api/recordings/sessions/${sessionId}/videos`)
      .set("Cookie", cookie);
    return res.body.recordings.find((r) => r.startedAt === startedAt).videos[0];
  };

  it("plays the preview until the full video arrives, then the full one", async () => {
    if (!hasFfmpeg) return;
    const startedAt = Date.now() - 5_000;

    expect((await upload(preview, startedAt, "preview")).status).toBe(201);
    const early = await angle(startedAt);
    expect(early.previewOnly).toBe(true);
    expect(early.url).toBe(early.previewUrl);
    // Lined up already, from the first-frame time sent with the preview.
    expect(early).toMatchObject({ startOffsetMs: 120, syncedBy: "clock" });

    const fullRes = await upload(full, startedAt);
    expect(fullRes.status).toBe(201);
    const later = await angle(startedAt);
    expect(later.previewOnly).toBe(false);
    expect(later.url).toBe(`/api/files/get/${fullRes.body.file.id}`);
    // The phone's preview gives way to the server's (made in the background).
    expect(later.previewUrl).toBeNull();
  });

  it("shows the uploading device's progress until the full video is in", async () => {
    if (!hasFfmpeg) return;
    const startedAt = Date.now() - 3_000;
    const report = (stage, fraction) => request(app)
      .post(`/api/recordings/sessions/${sessionId}/upload-progress`)
      .set("Cookie", cookie)
      .send({ startedAt, stage, fraction });
    await request(app).post(`/api/recordings/sessions/${sessionId}/videos`)
      .set("Cookie", cookie).send({ startedAt });

    expect((await report("full", 0.4)).status).toBe(204);
    expect((await angle(startedAt)).upload).toEqual({ stage: "full", fraction: 0.4, stalled: false });

    expect((await upload(full, startedAt)).status).toBe(201);
    expect((await angle(startedAt)).upload).toBeNull();
    expect((await report("bogus", 0.4)).status).toBe(400);
  });

  it("ignores a preview that arrives after the full video", async () => {
    if (!hasFfmpeg) return;
    const startedAt = Date.now() - 4_000;
    const fullRes = await upload(full, startedAt);
    expect(fullRes.status).toBe(201);

    const late = await upload(preview, startedAt, "preview");
    expect(late.status).toBe(200);
    const after = await angle(startedAt);
    expect(after.url).toBe(`/api/files/get/${fullRes.body.file.id}`);
    expect(after.previewOnly).toBe(false);
  });
});
