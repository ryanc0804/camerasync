import { useState } from "react";

import { resetPassword } from "../api/auth.js";

// The page users land on from the password-reset email link:
//   /reset-password?token=<token>
// Reads the token from the URL, collects a new password, and submits it.
export function ResetPasswordScreen({ token }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // No token in the link → nothing we can do. Tell the user to start over.
  const missingToken = !token;

  const validate = () => {
    if (!password) return "Please enter a new password.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (password !== confirm) return "Passwords do not match.";
    return null;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await resetPassword({ token, password });
      setDone(true);
    } catch (err) {
      setError(err.message || "This reset link is invalid or has expired.");
    } finally {
      setSubmitting(false);
    }
  };

  const goToSignIn = () => {
    // Drop the token from the URL and return to the app root / sign-in.
    window.location.href = "/";
  };

  return (
    <div style={styles.page}>
      <style>{css}</style>

      <form style={styles.card} onSubmit={onSubmit} noValidate>
        <h1 style={styles.brand}>KnightHyve</h1>
        <p style={styles.subtitle}>Choose a new password</p>

        {missingToken ? (
          <>
            <div style={styles.error}>
              This password reset link is missing or invalid. Please request a
              new one from the sign-in page.
            </div>
            <p style={styles.switch}>
              <button type="button" className="cs-link" onClick={goToSignIn}>
                Back to sign in
              </button>
            </p>
          </>
        ) : done ? (
          <>
            <div style={styles.success}>
              Your password has been reset. You can now sign in with your new
              password.
            </div>
            <button className="cs-button" type="button" onClick={goToSignIn}>
              Go to sign in
            </button>
          </>
        ) : (
          <>
            {error && <div style={styles.error}>{error}</div>}

            <label style={styles.label}>
              New password
              <input
                className="cs-input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </label>

            <label style={styles.label}>
              Confirm new password
              <input
                className="cs-input"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter your new password"
              />
            </label>

            <button className="cs-button" type="submit" disabled={submitting}>
              {submitting ? "Please wait…" : "Reset password"}
            </button>

            <p style={styles.switch}>
              <button type="button" className="cs-link" onClick={goToSignIn}>
                Back to sign in
              </button>
            </p>
          </>
        )}
      </form>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0d0d0d",
    fontFamily: "system-ui, sans-serif",
    padding: "1rem",
  },
  card: {
    width: "100%",
    maxWidth: 380,
    background: "#1a1a1a",
    border: "1px solid #2a2a2a",
    borderRadius: 12,
    padding: "2rem",
    boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  brand: {
    margin: 0,
    fontSize: "1.8rem",
    textAlign: "center",
    color: "#ffc72c",
    letterSpacing: "0.5px",
  },
  subtitle: { margin: "0 0 0.5rem", textAlign: "center", color: "#999" },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: "0.85rem",
    fontWeight: 600,
    color: "#e0e0e0",
  },
  error: {
    background: "#2a1a1a",
    color: "#ff8a80",
    border: "1px solid #5a2a2a",
    borderRadius: 8,
    padding: "0.6rem 0.8rem",
    fontSize: "0.85rem",
    lineHeight: 1.4,
  },
  success: {
    background: "#1e2a1a",
    color: "#b5e6a0",
    border: "1px solid #2f5a2a",
    borderRadius: 8,
    padding: "0.7rem 0.8rem",
    fontSize: "0.85rem",
    lineHeight: 1.4,
  },
  switch: {
    margin: "0.5rem 0 0",
    textAlign: "center",
    fontSize: "0.85rem",
    color: "#999",
  },
};

const css = `
  .cs-input {
    font: inherit;
    padding: 0.6rem 0.7rem;
    background: #262626;
    color: #f0f0f0;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .cs-input::placeholder { color: #777; }
  .cs-input:focus {
    border-color: #ffc72c;
    box-shadow: 0 0 0 3px rgba(255,199,44,0.2);
  }
  .cs-button {
    font: inherit;
    font-weight: 700;
    margin-top: 0.5rem;
    padding: 0.7rem;
    border: none;
    border-radius: 8px;
    background: #ffc72c;
    color: #0d0d0d;
    cursor: pointer;
    transition: background 0.15s;
  }
  .cs-button:hover:not(:disabled) { background: #ffd75e; }
  .cs-button:disabled { opacity: 0.5; cursor: default; }
  .cs-link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: #ffc72c;
    font-weight: 600;
    cursor: pointer;
    text-decoration: underline;
  }
`;
