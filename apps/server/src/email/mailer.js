import nodemailer from "nodemailer";

// Outgoing mail goes through whatever SMTP server .env points at (SMTP_HOST,
// SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, EMAIL_FROM — see .env.example).
// Any provider with an SMTP endpoint works (Brevo, Resend, SES, Gmail, ...),
// so switching providers is an .env change, not a code change.
//
// Without SMTP_HOST configured there is no transport and messages fall back to
// the server log, which keeps local dev working with zero setup.

let transport;

function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    // Implicit TLS (usually port 465). Port 587 upgrades via STARTTLS instead.
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transport;
}

function from() {
  return process.env.EMAIL_FROM || "8kount <no-reply@8kount.localhost>";
}

export async function sendPasswordResetEmail(email, link, code) {
  const t = getTransport();
  if (!t) {
    console.log(`[password-reset] ${email}: ${link} (code ${code})`);
    return;
  }

  await t.sendMail({
    from: from(),
    to: email,
    subject: `${code} is your 8kount password reset code`,
    text: [
      `Your 8kount password reset code is ${code}.`,
      "",
      `You can also reset your password in the browser: ${link}`,
      "",
      "The code and link expire in one hour. If you didn't request this,",
      "you can ignore this email — your password is unchanged.",
    ].join("\n"),
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#b89f00">8kount password reset</h2>
        <p>Enter this code in the app:</p>
        <p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p>
        <p>Or <a href="${link}">reset your password in the browser</a>.</p>
        <p style="color:#777;font-size:13px">
          The code and link expire in one hour. If you didn't request this,
          you can ignore this email — your password is unchanged.
        </p>
      </div>`,
  });
  console.log(`[password-reset] sent to ${email} via ${process.env.SMTP_HOST}`);
}
