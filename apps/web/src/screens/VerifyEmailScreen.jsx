import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext.jsx";
import { resendVerification, verifyEmail } from "../api/auth.js";
import {
  CODE_LENGTH,
  CodeBoxes,
  codePageCss as css,
  codePageStyles as styles,
} from "./ForgotPasswordScreen.jsx";

// "Confirm your email" (SCRUM-43). Shown in place of the whole app to a
// signed-in user who hasn't confirmed yet; they type the 6-digit code from
// the sign-up email, ask for a new one, or sign out.
export function VerifyEmailScreen() {
  const { user, confirmEmail, logout } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (value) => {
    if (value.length !== CODE_LENGTH) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      // Success flips user.emailVerified and the app takes over.
      await confirmEmail(value);
    } catch (err) {
      setError(err.message);
      setCode("");
      setSubmitting(false);
    }
  };

  const resend = async () => {
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await resendVerification();
      setCode("");
      setNotice(`A new code is on its way to ${user.email}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.page}>
      <style>{css}</style>
      <div style={styles.column}>
        <h1 style={styles.title}>Confirm your email</h1>
        <p style={styles.subtitle}>
          We sent a 6-digit code to <strong style={{ color: "#fff" }}>{user.email}</strong>.
          Enter it below, or use the link in the email.
        </p>

        {error && <div style={styles.error} role="alert">{error}</div>}
        {notice && <div style={styles.notice}>{notice}</div>}

        <form
          style={styles.form}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit(code);
          }}
        >
          <CodeBoxes
            code={code}
            onChange={(next) => {
              setCode(next);
              // Typing or pasting the last digit submits straight away.
              if (next.length === CODE_LENGTH && !submitting) submit(next);
            }}
          />
          <button className="fp-button" type="submit" disabled={submitting}>
            {submitting ? "Checking…" : "Confirm"}
          </button>
          <button type="button" className="fp-link" onClick={resend} disabled={submitting}>
            Resend code
          </button>
          <button type="button" className="fp-link" onClick={logout} disabled={submitting}
            style={{ color: "#8e8e93" }}>
            Use a different account
          </button>
        </form>
      </div>
    </div>
  );
}

// The page the email's "confirm in the browser" link opens:
//   /verify-email?token=<token>
// Works signed in or out, and on a different device from the one that signed
// up.
export function VerifyEmailLinkScreen({ token }) {
  const { isAuthenticated, user, refreshUser } = useAuth();
  const navigate = useNavigate();
  // Someone who already confirmed with the code may still click the link;
  // its token is gone by then, so just tell them they're done.
  const alreadyConfirmed = Boolean(user?.emailVerified);
  const [state, setState] = useState(
    alreadyConfirmed ? "done" : token ? "checking" : "invalid"
  );
  const [error, setError] = useState(
    alreadyConfirmed || token ? null : "This confirmation link is missing its code."
  );
  // StrictMode runs effects twice in development; the token is single-use.
  const sent = useRef(false);

  useEffect(() => {
    if (alreadyConfirmed || !token || sent.current) return;
    sent.current = true;
    verifyEmail({ token })
      .then(async () => {
        setState("done");
        if (isAuthenticated) {
          await refreshUser();
          navigate("/", { replace: true });
        }
      })
      .catch((err) => {
        setState("invalid");
        setError(err.message);
      });
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={styles.page}>
      <style>{css}</style>
      <div style={styles.column}>
        <h1 style={styles.title}>
          {state === "done" ? "Email confirmed" : "Confirm your email"}
        </h1>
        {state === "checking" && <p style={styles.subtitle}>Confirming…</p>}
        {state === "done" && (
          <p style={styles.subtitle}>Your 8kount account is ready.</p>
        )}
        {error && <div style={styles.error} role="alert">{error}</div>}
        {state !== "checking" && (
          <button
            className="fp-button"
            type="button"
            onClick={() => navigate(isAuthenticated ? "/" : "/login", { replace: true })}
          >
            {isAuthenticated ? "Open 8kount" : "Go to Sign In"}
          </button>
        )}
      </div>
    </div>
  );
}
