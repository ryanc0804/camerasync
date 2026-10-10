// Settings page routes: PATCH /api/auth/me (name, primary group) and
// POST /api/auth/change-password. Run against the dev Postgres like
// auth.test.js; unique ids per run, cleaned up after.
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
const EMAIL = `account-test-${RUN}@ucf.edu`;
const PASSWORD = "account-test-pass-1";
const GROUP_ID = `acct${RUN}`;

let cookie;

beforeAll(async () => {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name: "Before", email: EMAIL, password: PASSWORD });
  expect(res.status).toBe(201);
  await pool.query("UPDATE users SET email_verified_at = NOW() WHERE email = $1", [EMAIL]);
  cookie = res.headers["set-cookie"];

  const group = await request(app)
    .post("/api/groups")
    .set("Cookie", cookie)
    .send({ id: GROUP_ID, name: "Account Test", isPublic: true });
  expect(group.status).toBe(201);
});

afterAll(async () => {
  await pool.query("DELETE FROM groups WHERE group_id LIKE $1", [`${GROUP_ID}%`]);
  await pool.query(
    "DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM users WHERE email = $1)",
    [EMAIL]
  );
  await pool.query("DELETE FROM users WHERE email = $1", [EMAIL]);
  await pool.end();
});

describe("group order", () => {
  it("lists groups in the order the user dragged them into", async () => {
    for (const suffix of ["x", "y"]) {
      expect((await request(app).post("/api/groups").set("Cookie", cookie)
        .send({ id: `${GROUP_ID}${suffix}`, name: `Order ${suffix}`, isPublic: true })).status).toBe(201);
    }
    const ids = async () =>
      (await request(app).get("/api/groups").set("Cookie", cookie)).body.groups.map((g) => g.id);
    // Newest first until an order is saved.
    expect(await ids()).toEqual([`${GROUP_ID}y`, `${GROUP_ID}x`, GROUP_ID]);

    const saved = await request(app).patch("/api/auth/me").set("Cookie", cookie)
      .send({ groupOrder: [GROUP_ID, `${GROUP_ID}y`, "notmine"] });
    expect(saved.status).toBe(200);
    // Placed ones first in that order; the rest after, newest first.
    expect(await ids()).toEqual([GROUP_ID, `${GROUP_ID}y`, `${GROUP_ID}x`]);
  });

  it("only takes a list of group IDs", async () => {
    for (const groupOrder of ["abc", [1, 2], ["has space"], null]) {
      const res = await request(app).patch("/api/auth/me").set("Cookie", cookie)
        .send({ groupOrder });
      expect(res.status).toBe(400);
    }
  });
});

describe("notification settings", () => {
  it("start with everything on", async () => {
    const res = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(res.body.user.notificationPrefs).toEqual({
      push: true, comments: true, joins: true, sessions: true,
    });
  });

  it("save one switch at a time and keep the rest", async () => {
    await request(app).patch("/api/auth/me").set("Cookie", cookie)
      .send({ notificationPrefs: { joins: false } });
    const res = await request(app).patch("/api/auth/me").set("Cookie", cookie)
      .send({ notificationPrefs: { push: false } });
    expect(res.status).toBe(200);
    expect(res.body.user.notificationPrefs).toEqual({
      push: false, comments: true, joins: false, sessions: true,
    });
  });

  it("only take the known switches, as true or false", async () => {
    for (const notificationPrefs of [{ joins: "no" }, { everything: false }, ["push"], null]) {
      const res = await request(app).patch("/api/auth/me").set("Cookie", cookie)
        .send({ notificationPrefs });
      expect(res.status).toBe(400);
    }
  });
});

describe("PATCH /api/auth/me", () => {
  it("changes the display name", async () => {
    const res = await request(app)
      .patch("/api/auth/me")
      .set("Cookie", cookie)
      .send({ name: "  After  " });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe("After");
  });

  it("rejects an empty or too-long name", async () => {
    for (const name of ["   ", "x".repeat(64)]) {
      const res = await request(app).patch("/api/auth/me").set("Cookie", cookie).send({ name });
      expect(res.status).toBe(400);
    }
  });

  it("saves the primary group on the account, in the group's own capitalization", async () => {
    const res = await request(app)
      .patch("/api/auth/me")
      .set("Cookie", cookie)
      .send({ primaryGroupId: GROUP_ID.toUpperCase() });
    expect(res.status).toBe(200);
    expect(res.body.user.primaryGroupId).toBe(GROUP_ID);

    // Every device reads it back from /me.
    const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(me.body.user.primaryGroupId).toBe(GROUP_ID);
    expect(me.body.user.name).toBe("After");
  });

  it("refuses a group the user isn't in", async () => {
    const res = await request(app)
      .patch("/api/auth/me")
      .set("Cookie", cookie)
      .send({ primaryGroupId: "nosuchgroup" });
    expect(res.status).toBe(400);
  });

  it("clears the primary group with null", async () => {
    const res = await request(app)
      .patch("/api/auth/me")
      .set("Cookie", cookie)
      .send({ primaryGroupId: null });
    expect(res.status).toBe(200);
    expect(res.body.user.primaryGroupId).toBeNull();
  });

  it("needs a signed-in user", async () => {
    const res = await request(app).patch("/api/auth/me").send({ name: "Nobody" });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/change-password", () => {
  it("rejects a wrong current password", async () => {
    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", cookie)
      .send({ currentPassword: "not-it-at-all", newPassword: "brand-new-pass-1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Current password is incorrect.");
  });

  it("rejects a short new password", async () => {
    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", cookie)
      .send({ currentPassword: PASSWORD, newPassword: "short" });
    expect(res.status).toBe(400);
  });

  it("changes it, keeps this session and signs out the others", async () => {
    const other = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAIL, password: PASSWORD });
    expect(other.status).toBe(200);
    const otherCookie = other.headers["set-cookie"];

    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", cookie)
      .send({ currentPassword: PASSWORD, newPassword: "brand-new-pass-1" });
    expect(res.status).toBe(204);

    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(200);
    expect((await request(app).get("/api/auth/me").set("Cookie", otherCookie)).status).toBe(401);

    const oldLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAIL, password: PASSWORD });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAIL, password: "brand-new-pass-1" });
    expect(newLogin.status).toBe(200);
  });
});
