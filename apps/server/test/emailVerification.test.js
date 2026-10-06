// Integration tests for UCF-only sign-up and email confirmation (SCRUM-43),
// run against the dev Postgres like auth.test.js. The mailer is mocked so the
// tests read the code and link the way a user reads their inbox.
import "dotenv/config";

import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => []);
vi.mock("../src/email/mailer.js", () => ({
  sendPasswordResetEmail: vi.fn(async () => {}),
  sendVerificationEmail: vi.fn(async (email, link, code) => {
    sent.push({ email, link, code });
  }),
}));

const { authRouter } = await import("../src/routes/auth.js");
const { groupRouter } = await import("../src/routes/groups.js");
const { pool } = await import("../src/db/pool.js");

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/auth", authRouter);
// Any requireAuth-protected router works for checking the gate.
app.use("/api/groups", groupRouter);

const RUN = `${Date.now()}${process.pid}`;
const PASSWORD = "verify-test-pass-1";
const email = (label, domain = "ucf.edu") => `verify-${RUN}-${label}@${domain}`;

// Sends are fire-and-forget, so wait for the mock to record one.
async function inboxFor(address) {
  for (let i = 0; i < 50; i++) {
    const found = sent.filter((m) => m.email === address);
    if (found.length) return found[found.length - 1];
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`no confirmation email for ${address}`);
}

async function signUp(address) {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name: "Verify Tester", email: address, password: PASSWORD });
  return { res, cookie: res.headers["set-cookie"] };
}

afterEach(() => {
  delete process.env.ALLOWED_EMAIL_DOMAINS;
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE $1", [`verify-${RUN}-%`]);
  await pool.end();
});

describe("who can sign up", () => {
  it("rejects a malformed email", async () => {
    const { res } = await signUp("not-an-email");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Enter a valid email address.");
  });

  it("rejects non-UCF addresses", async () => {
    const { res } = await signUp(email("gmail", "gmail.com"));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/UCF email/);
  });

  it("rejects look-alike domains", async () => {
    for (const domain of ["notucf.edu", "ucf.edu.evil.com", "UCF.EDU.co"]) {
      const { res } = await signUp(email(`fake-${domain}`, domain));
      expect(res.status).toBe(400);
    }
  });

  it("accepts ucf.edu and knights.ucf.edu", async () => {
    expect((await signUp(email("plain"))).res.status).toBe(201);
    expect((await signUp(email("knight", "knights.ucf.edu"))).res.status).toBe(201);
  });

  it("follows ALLOWED_EMAIL_DOMAINS when set", async () => {
    process.env.ALLOWED_EMAIL_DOMAINS = "example.test";
    expect((await signUp(email("ucf-blocked"))).res.status).toBe(400);
    expect((await signUp(email("other", "example.test"))).res.status).toBe(201);
  });
});

describe("confirming with the emailed code", () => {
  const address = email("code");
  let cookie;

  it("starts unverified and emails a 6-digit code and a link", async () => {
    const signed = await signUp(address);
    cookie = signed.cookie;
    expect(signed.res.status).toBe(201);
    expect(signed.res.body.user.emailVerified).toBe(false);

    const message = await inboxFor(address);
    expect(message.code).toMatch(/^\d{6}$/);
    expect(message.link).toMatch(/\/verify-email\?token=[0-9a-f]{64}$/);
  });

  it("locks every other API until confirmed", async () => {
    const res = await request(app).get("/api/groups").set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_UNVERIFIED");

    const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.emailVerified).toBe(false);
  });

  it("rejects a wrong code", async () => {
    const { code } = await inboxFor(address);
    const wrong = code === "000000" ? "000001" : "000000";
    const res = await request(app)
      .post("/api/auth/verify-email")
      .set("Cookie", cookie)
      .send({ code: wrong });
    expect(res.status).toBe(400);
  });

  it("confirms with the right code and unlocks the app", async () => {
    const { code } = await inboxFor(address);
    const res = await request(app)
      .post("/api/auth/verify-email")
      .set("Cookie", cookie)
      .send({ code });
    expect(res.status).toBe(200);
    expect(res.body.user.emailVerified).toBe(true);

    const groups = await request(app).get("/api/groups").set("Cookie", cookie);
    expect(groups.status).toBe(200);
  });

  it("stays verified when signing in again", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: address, password: PASSWORD });
    expect(res.body.user.emailVerified).toBe(true);
  });
});

describe("confirming with the emailed link", () => {
  it("works without being signed in, and only once", async () => {
    const address = email("link");
    await signUp(address);
    const token = new URL((await inboxFor(address)).link).searchParams.get("token");

    const first = await request(app).post("/api/auth/verify-email").send({ token });
    expect(first.status).toBe(200);
    expect(first.body.user.emailVerified).toBe(true);

    const again = await request(app).post("/api/auth/verify-email").send({ token });
    expect(again.status).toBe(400);
  });
});

describe("resending and guessing", () => {
  it("refuses an immediate resend, then replaces the old code", async () => {
    const address = email("resend");
    const { cookie } = await signUp(address);
    const oldCode = (await inboxFor(address)).code;

    const tooSoon = await request(app)
      .post("/api/auth/resend-verification")
      .set("Cookie", cookie);
    expect(tooSoon.status).toBe(429);

    // Step past the cooldown instead of sleeping for it.
    await pool.query(
      `UPDATE email_verifications SET created_at = NOW() - INTERVAL '1 minute'
        WHERE user_id = (SELECT user_id FROM users WHERE email = $1)`,
      [address]
    );
    const before = sent.length;
    const resent = await request(app)
      .post("/api/auth/resend-verification")
      .set("Cookie", cookie);
    expect(resent.status).toBe(204);
    for (let i = 0; i < 50 && sent.length === before; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const newCode = (await inboxFor(address)).code;

    if (newCode !== oldCode) {
      const stale = await request(app)
        .post("/api/auth/verify-email")
        .set("Cookie", cookie)
        .send({ code: oldCode });
      expect(stale.status).toBe(400);
    }
    const ok = await request(app)
      .post("/api/auth/verify-email")
      .set("Cookie", cookie)
      .send({ code: newCode });
    expect(ok.status).toBe(200);
  });

  it("burns the code after too many wrong guesses", async () => {
    const address = email("guess");
    const { cookie } = await signUp(address);
    const { code } = await inboxFor(address);
    const wrong = code === "000000" ? "000001" : "000000";

    for (let i = 0; i < 6; i++) {
      await request(app)
        .post("/api/auth/verify-email")
        .set("Cookie", cookie)
        .send({ code: wrong });
    }
    const res = await request(app)
      .post("/api/auth/verify-email")
      .set("Cookie", cookie)
      .send({ code });
    expect(res.status).toBe(400);
  });

  it("refuses to resend once confirmed", async () => {
    const address = email("done");
    const { cookie } = await signUp(address);
    const { code } = await inboxFor(address);
    await request(app)
      .post("/api/auth/verify-email")
      .set("Cookie", cookie)
      .send({ code });

    const res = await request(app)
      .post("/api/auth/resend-verification")
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
  });
});
