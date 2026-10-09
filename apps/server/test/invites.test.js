// Invite links: every group carries one, and the preview behind it shows the
// group before joining. Runs against the dev Postgres like auth.test.js.
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
const { groupRouter } = await import("../src/routes/groups.js");
const { pool } = await import("../src/db/pool.js");

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/auth", authRouter);
app.use("/api/groups", groupRouter);

const RUN = `${Date.now()}${process.pid}`;
const GROUP = `invite${RUN}`;
let owner;
let guest;

async function signUp(label) {
  const email = `invite-test-${RUN}-${label}@ucf.edu`;
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name: label, email, password: "invite-test-pass-1" });
  expect(res.status).toBe(201);
  await pool.query("UPDATE users SET email_verified_at = NOW() WHERE email = $1", [email]);
  return res.headers["set-cookie"];
}

beforeAll(async () => {
  owner = await signUp("owner");
  guest = await signUp("guest");
  const created = await request(app)
    .post("/api/groups")
    .set("Cookie", owner)
    .send({ id: GROUP, name: "Invite Test", isPublic: false, password: "team-pass", primaryColor: "#7c3aed" });
  expect(created.status).toBe(201);
});

afterAll(async () => {
  await pool.query("DELETE FROM groups WHERE group_id = $1", [GROUP]);
  await pool.query("DELETE FROM users WHERE email LIKE $1", [`invite-test-${RUN}-%`]);
  await pool.end();
});

describe("invite links", () => {
  it("come with every group, pointing at the web join page", async () => {
    const res = await request(app).get("/api/groups").set("Cookie", owner);
    const group = res.body.groups.find((g) => g.id === GROUP);
    expect(group.inviteUrl).toMatch(new RegExp(`/join/${GROUP}$`));
  });

  it("preview the group for someone not in it yet, in any letter case", async () => {
    const res = await request(app)
      .get(`/api/groups/${GROUP.toUpperCase()}/invite`)
      .set("Cookie", guest);
    expect(res.status).toBe(200);
    expect(res.body.group).toEqual({
      id: GROUP,
      name: "Invite Test",
      isPublic: false,
      primaryColor: "#7c3aed",
      isMember: false,
    });
  });

  it("still need the password for a private group", async () => {
    const wrong = await request(app)
      .post(`/api/groups/${GROUP}/join`)
      .set("Cookie", guest)
      .send({ password: "nope" });
    expect(wrong.status).toBeGreaterThanOrEqual(400);

    const right = await request(app)
      .post(`/api/groups/${GROUP}/join`)
      .set("Cookie", guest)
      .send({ password: "team-pass" });
    expect(right.status).toBe(201);

    const after = await request(app).get(`/api/groups/${GROUP}/invite`).set("Cookie", guest);
    expect(after.body.group.isMember).toBe(true);
  });

  it("locks someone out for 15 minutes after 5 wrong passwords", async () => {
    const guesser = await signUp("guesser");
    const tryJoin = (password) =>
      request(app).post(`/api/groups/${GROUP}/join`).set("Cookie", guesser).send({ password });

    for (const left of [4, 3, 2, 1]) {
      const res = await tryJoin("wrong");
      expect(res.status).toBe(403);
      expect(res.body.error).toBe(
        `Incorrect group password. ${left} ${left === 1 ? "try" : "tries"} left.`
      );
    }
    const fifth = await tryJoin("wrong");
    expect(fifth.status).toBe(403);
    expect(fifth.body.error).toBe("Incorrect group password. Try again in 15 minutes.");

    // Locked: even the right password is refused for now.
    const locked = await tryJoin("team-pass");
    expect(locked.status).toBe(429);
    expect(locked.body.error).toMatch(/Try again in 1[45] minutes\./);

    // Once the lock runs out, the right password works.
    await pool.query(
      `UPDATE group_join_attempts SET locked_until = NOW() - interval '1 second'
        WHERE group_id = $1`,
      [GROUP]
    );
    const after = await tryJoin("team-pass");
    expect(after.status).toBe(201);
    const { rowCount } = await pool.query(
      `SELECT 1 FROM group_join_attempts a JOIN users u USING (user_id)
        WHERE a.group_id = $1 AND u.email LIKE $2`,
      [GROUP, `invite-test-${RUN}-guesser%`]
    );
    expect(rowCount).toBe(0);
  });

  it("404 for a group that doesn't exist", async () => {
    const res = await request(app).get("/api/groups/nosuchgroup123/invite").set("Cookie", guest);
    expect(res.status).toBe(404);
  });
});
