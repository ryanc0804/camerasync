// Integration tests for the auth routes, run against the dev Postgres from
// docker-compose (same DATABASE_URL as `npm run dev` — see .env.example).
// Each run uses unique emails and deletes its own users afterwards, so it is
// safe against a database that also holds manual dev data.
import "dotenv/config";

import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Capture reset emails instead of sending/logging them, so tests can read the
// code and link the way a user would read their inbox.
const sentEmails = vi.hoisted(() => []);
vi.mock("../src/email/mailer.js", () => ({
  sendPasswordResetEmail: vi.fn(async (email, link, code) => {
    sentEmails.push({ email, link, code });
  }),
}));

const { authRouter } = await import("../src/routes/auth.js");
const { pool } = await import("../src/db/pool.js");

// The router under the same middleware index.js mounts it with.
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/auth", authRouter);

const RUN = `${Date.now()}-${process.pid}`;
const EMAIL = `auth-test-${RUN}@example.test`;
const PASSWORD = "original-pass-1";

const lastEmail = () => sentEmails[sentEmails.length - 1];

// The reset send is fire-and-forget, so the 204 can land before the mailer
// mock has run. Wait for the capture instead of racing it.
async function waitForEmailCount(n) {
  for (let i = 0; i < 50 && sentEmails.length < n; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  expect(sentEmails.length).toBeGreaterThanOrEqual(n);
}

beforeAll(async () => {
  await pool.query("SELECT 1"); // fail fast with a clear error if no DB
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE $1", [
    `auth-test-${RUN}%`,
  ]);
  await pool.end();
});

describe("register and login", () => {
  it("registers a new account and signs it in", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Auth Tester", email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(EMAIL);
    expect(res.headers["set-cookie"][0]).toMatch(/^session=/);
  });

  it("rejects a duplicate email with 409", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Dupe", email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(409);
  });

  it("rejects a short password with 400", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: `auth-test-${RUN}-short@example.test`, password: "short" });
    expect(res.status).toBe(400);
  });

  it("logs in with the right password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(EMAIL);
  });

  it("gives the same 401 for a wrong password and an unknown email", async () => {
    const wrongPass = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAIL, password: "not-the-password" });
    const unknown = await request(app)
      .post("/api/auth/login")
      .send({ email: `nobody-${RUN}@example.test`, password: "whatever-1" });
    expect(wrongPass.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrongPass.body);
  });

  it("answers /me with the session cookie and 401 without", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAIL, password: PASSWORD });
    const cookie = login.headers["set-cookie"];

    const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(EMAIL);

    const anon = await request(app).get("/api/auth/me");
    expect(anon.status).toBe(401);
  });

  it("logs out and the cookie stops working", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAIL, password: PASSWORD });
    const cookie = login.headers["set-cookie"];

    const out = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookie);
    expect(out.status).toBe(204);

    const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(me.status).toBe(401);
  });
});

describe("password reset", () => {
  const NEW_PASSWORD = "brand-new-pass-1";

  it("always answers 204, and only emails real accounts", async () => {
    const known = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: EMAIL });
    expect(known.status).toBe(204);
    await waitForEmailCount(1);
    expect(lastEmail().email).toBe(EMAIL);
    expect(lastEmail().code).toMatch(/^\d{6}$/);

    const before = sentEmails.length;
    const unknown = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: `nobody-${RUN}@example.test` });
    expect(unknown.status).toBe(204);
    await new Promise((r) => setTimeout(r, 100));
    expect(sentEmails.length).toBe(before); // no email for unknown accounts
  });

  it("rejects a wrong code with a generic message", async () => {
    const wrongCode = lastEmail().code === "000000" ? "000001" : "000000";
    const res = await request(app)
      .post("/api/auth/verify-reset-code")
      .send({ email: EMAIL, code: wrongCode });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("That code is invalid or has expired.");
  });

  it("completes the code flow and kills the emailed link token", async () => {
    const { code, link } = lastEmail();
    const emailedToken = new URL(link).searchParams.get("token");

    const verify = await request(app)
      .post("/api/auth/verify-reset-code")
      .send({ email: EMAIL, code });
    expect(verify.status).toBe(200);
    const token = verify.body.token;
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    // The verify rotated the token, so the emailed link is dead now.
    const oldLink = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: emailedToken, password: NEW_PASSWORD });
    expect(oldLink.status).toBe(400);

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: NEW_PASSWORD });
    expect(reset.status).toBe(204);

    const oldPass = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAIL, password: PASSWORD });
    expect(oldPass.status).toBe(401);

    const newPass = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAIL, password: NEW_PASSWORD });
    expect(newPass.status).toBe(200);
  });

  it("burns the reset after too many wrong guesses", async () => {
    const before = sentEmails.length;
    await request(app).post("/api/auth/forgot-password").send({ email: EMAIL });
    await waitForEmailCount(before + 1);
    const { code } = lastEmail();
    const wrongCode = code === "000000" ? "000001" : "000000";

    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post("/api/auth/verify-reset-code")
        .send({ email: EMAIL, code: wrongCode });
      expect(res.status).toBe(400);
    }

    // Even the real code is refused once the attempt cap is blown.
    const res = await request(app)
      .post("/api/auth/verify-reset-code")
      .send({ email: EMAIL, code });
    expect(res.status).toBe(400);
  });
});
