import { useState } from "react";

import { useAuth } from "../auth/AuthContext.jsx";
import { requestPasswordReset } from "../api/auth.js";

// Combined auth screen with three modes — sign in, create account, and forgot
// password — sharing one card + theme so the fields aren't duplicated.
export function AuthScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState("login"); // "login" | "signup" | "forgot"
  const isSignup = mode === "signup";
  const isForgot = mode === "forgot";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // Switch modes, clearing transient state but keeping the typed email so the
  // user doesn't retype it when moving between sign in and reset.
  const go = (nextMode) => {
    setMode(nextMode);
    setError(null);
    setPassword("");
    setConfirm("");
    setResetSent(false);
  };

  // Client-side checks so we don't bother the server with obviously bad input.
  const validate = () => {
    if (!email.trim()) return "Please enter your email.";
    if (isForgot) return null; // reset only needs an email
    if (isSignup && !name.trim()) return "Please enter your name.";
    if (!password) return "Please enter your password.";
    if (isSignup && password.length < 8)
      return "Password must be at least 8 characters.";
    if (isSignup && password !== confirm) return "Passwords do not match.";
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
      if (isForgot) {
        await requestPasswordReset(email.trim());
        setResetSent(true);
      } else if (isSignup) {
        await register({ name: name.trim(), email: email.trim(), password });
      } else {
        await login({ email: email.trim(), password });
      }
      // On login/register success the AuthProvider updates and App swaps UI.
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const subtitle = isForgot
    ? "Reset your password"
    : isSignup
      ? "Create your account"
      : "Sign in to your account";

  const submitLabel = submitting
    ? "Please wait…"
    : isForgot
      ? "Send reset link"
      : isSignup
        ? "Create account"
        : "Sign in";

  return (
    <div style={styles.page}>
      {/* Focus/placeholder states can't be expressed inline, so scope a tiny
          stylesheet to this screen. */}
      <style>{css}</style>

      <form style={styles.card} onSubmit={onSubmit} noValidate>
        <h1 style={styles.brand}>KnightHyve</h1>
        <p style={styles.subtitle}>{subtitle}</p>

        {error && <div style={styles.error}>{error}</div>}

        {/* Forgot-password confirmation replaces the form once submitted. */}
        {isForgot && resetSent ? (
          <>
            <div style={styles.success}>
              If an account exists for <strong>{email.trim()}</strong>, we've
              sent password reset instructions. Check your inbox.
            </div>
            <p style={styles.switch}>
              <button type="button" className="cs-link" onClick={() => go("login")}>
                Back to sign in
              </button>
            </p>
          </>
        ) : (
          <>
            {isSignup && (
              <label style={styles.label}>
                Name
                <input
                  className="cs-input"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Coach"
                />
              </label>
            )}

            <label style={styles.label}>
              Email
              <input
                className="cs-input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>

            {!isForgot && (
              <label style={styles.label}>
                Password
                <input
                  className="cs-input"
                  type="password"
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isSignup ? "At least 8 characters" : "Your password"}
                />
              </label>
            )}

            {isSignup && (
              <label style={styles.label}>
                Confirm password
                <input
                  className="cs-input"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter your password"
                />
              </label>
            )}

            {/* Forgot-password link, only on the sign-in view. */}
            {mode === "login" && (
              <div style={styles.forgotRow}>
                <button type="button" className="cs-link" onClick={() => go("forgot")}>
                  Forgot password?
                </button>
              </div>
            )}

            <button className="cs-button" type="submit" disabled={submitting}>
              {submitLabel}
            </button>

            <p style={styles.switch}>
              {isForgot ? (
                <>
                  Remembered it?{" "}
                  <button type="button" className="cs-link" onClick={() => go("login")}>
                    Sign in
                  </button>
                </>
              ) : isSignup ? (
                <>
                  Already have an account?{" "}
                  <button type="button" className="cs-link" onClick={() => go("login")}>
                    Sign in
                  </button>
                </>
              ) : (
                <>
                  New to KnightHyve?{" "}
                  <button type="button" className="cs-link" onClick={() => go("signup")}>
                    Create one
                  </button>
                </>
              )}
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
  forgotRow: {
    marginTop: "-0.4rem",
    textAlign: "right",
    fontSize: "0.8rem",
  },
  switch: {
    margin: "0.5rem 0 0",
    textAlign: "center",
    fontSize: "0.85rem",
    color: "#999",
  },
};

// Pseudo-states + resets for the inputs/buttons rendered above.
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
