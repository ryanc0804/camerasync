// Integration tests for editing a group's team colors (SCRUM-71), run against
// the dev Postgres like auth.test.js. Unique ids per run, cleaned up after.
import "dotenv/config";

import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { authRouter } = await import("../src/routes/auth.js");
const { groupRouter } = await import("../src/routes/groups.js");
const { pool } = await import("../src/db/pool.js");

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/auth", authRouter);
app.use("/api/groups", groupRouter);

const RUN = `${Date.now()}${process.pid}`;
const GROUP_ID = `colors${RUN}`;

// Registers a user and returns their session cookie.
async function signUp(label) {
  const res = await request(app)
    .post("/api/auth/register")
    .send({
      name: label,
      email: `groups-test-${RUN}-${label}@example.test`,
      password: "groups-test-pass-1",
    });
  expect(res.status).toBe(201);
  return res.headers["set-cookie"];
}

let owner;
let member;
let outsider;

beforeAll(async () => {
  owner = await signUp("owner");
  member = await signUp("member");
  outsider = await signUp("outsider");

  const created = await request(app)
    .post("/api/groups")
    .set("Cookie", owner)
    .send({ id: GROUP_ID, name: "Color Test", isPublic: true });
  expect(created.status).toBe(201);

  const joined = await request(app)
    .post(`/api/groups/${GROUP_ID}/join`)
    .set("Cookie", member)
    .send({});
  expect(joined.status).toBe(201);
});

afterAll(async () => {
  await pool.query("DELETE FROM groups WHERE group_id = $1", [GROUP_ID]);
  await pool.query("DELETE FROM users WHERE email LIKE $1", [
    `groups-test-${RUN}-%`,
  ]);
  await pool.end();
});

describe("PATCH /api/groups/:id (team colors)", () => {
  it("lets the owner change both colors", async () => {
    const res = await request(app)
      .patch(`/api/groups/${GROUP_ID}`)
      .set("Cookie", owner)
      .send({ primaryColor: "#002d72", secondaryColor: "#ffffff" });
    expect(res.status).toBe(200);
    expect(res.body.group.primaryColor).toBe("#002d72");
    expect(res.body.group.secondaryColor).toBe("#ffffff");
  });

  it("keeps the color that was not sent", async () => {
    const res = await request(app)
      .patch(`/api/groups/${GROUP_ID}`)
      .set("Cookie", owner)
      .send({ primaryColor: "#e53935" });
    expect(res.status).toBe(200);
    expect(res.body.group.primaryColor).toBe("#e53935");
    expect(res.body.group.secondaryColor).toBe("#ffffff");
  });

  it("shows the new colors in the group list", async () => {
    const res = await request(app).get("/api/groups").set("Cookie", member);
    const group = res.body.groups.find((g) => g.id === GROUP_ID);
    expect(group.primaryColor).toBe("#e53935");
  });

  it("refuses plain members", async () => {
    const res = await request(app)
      .patch(`/api/groups/${GROUP_ID}`)
      .set("Cookie", member)
      .send({ primaryColor: "#000000" });
    expect(res.status).toBe(403);
  });

  it("refuses people outside the group", async () => {
    const res = await request(app)
      .patch(`/api/groups/${GROUP_ID}`)
      .set("Cookie", outsider)
      .send({ primaryColor: "#000000" });
    expect(res.status).toBe(403);
  });

  it("rejects colors that are not six-digit hex", async () => {
    for (const bad of ["red", "#fff", "#12345g", "rgb(0,0,0)"]) {
      const res = await request(app)
        .patch(`/api/groups/${GROUP_ID}`)
        .set("Cookie", owner)
        .send({ primaryColor: bad });
      expect(res.status).toBe(400);
    }
  });

  it("rejects an empty update", async () => {
    const res = await request(app)
      .patch(`/api/groups/${GROUP_ID}`)
      .set("Cookie", owner)
      .send({});
    expect(res.status).toBe(400);
  });
});
