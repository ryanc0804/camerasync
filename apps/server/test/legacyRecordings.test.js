// The legacy /api/recordings create/info/update/close routes write to the
// database and drive socket rooms, so they must require a signed-in account.
// Run against the dev Postgres like auth.test.js.
import "dotenv/config";

import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/email/mailer.js", () => ({
  sendPasswordResetEmail: vi.fn(async () => {}),
  sendVerificationEmail: vi.fn(async () => {}),
}));

const { authRouter } = await import("../src/routes/auth.js");
const { recordingsRouter } = await import("../src/routes/recordings.js");
const { pool } = await import("../src/db/pool.js");

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/auth", authRouter);
app.use("/api/recordings", recordingsRouter);

const RUN = `${Date.now()}${process.pid}`;
const EMAIL = `legacy-rec-test-${RUN}@ucf.edu`;

const ROUTES = [
  ["post", "/api/recordings/create", { name: "x" }],
  ["get", "/api/recordings/info?sessionId=x", undefined],
  ["patch", "/api/recordings/update", { sessionId: "x", status: "recording" }],
  ["delete", "/api/recordings/close", { sessionId: "x" }],
];

let cookie;

beforeAll(async () => {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name: "Legacy", email: EMAIL, password: "legacy-test-pass-1" });
  expect(res.status).toBe(201);
  await pool.query("UPDATE users SET email_verified_at = NOW() WHERE email = $1", [EMAIL]);
  cookie = res.headers["set-cookie"];
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE email = $1", [EMAIL]);
  await pool.end();
});

describe("legacy recording routes", () => {
  it.each(ROUTES)("%s %s rejects signed-out requests", async (method, path, body) => {
    const before = await pool.query("SELECT COUNT(*)::int AS n FROM recordings");
    const res = await request(app)[method](path).send(body);
    expect(res.status).toBe(401);
    const after = await pool.query("SELECT COUNT(*)::int AS n FROM recordings");
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("lets a signed-in user through to the route's own validation", async () => {
    const info = await request(app).get("/api/recordings/info").set("Cookie", cookie);
    expect(info.status).toBe(400);

    const update = await request(app)
      .patch("/api/recordings/update")
      .set("Cookie", cookie)
      .send({ sessionId: "x", status: "bogus" });
    expect(update.status).toBe(403);

    const close = await request(app)
      .delete("/api/recordings/close")
      .set("Cookie", cookie)
      .send({});
    expect(close.status).toBe(400);
  });
});
