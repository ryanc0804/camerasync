import { useState } from "react";

// A password field with a Show / Hide button inside it, so people can check
// what they typed (or what the browser autofilled) before signing in. Takes
// the same props as the <input> it wraps.
export function PasswordInput({ style, ...props }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="password-input">
      <style>{css}</style>
      <input {...props} type={visible ? "text" : "password"}
        style={{ ...style, paddingRight: "4.2rem" }} />
      <button type="button" className="password-input-toggle"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}>
        {visible ? "Hide" : "Show"}
      </button>
    </span>
  );
}

const css = `
  .password-input { position: relative; display: flex; flex-direction: column; }
  .password-input > input { width: 100%; box-sizing: border-box; }
  .password-input-toggle {
    position: absolute; top: 50%; right: 0.4rem; transform: translateY(-50%);
    font: inherit; font-size: 0.8rem; font-weight: 700;
    padding: 0.25rem 0.55rem; border: none; border-radius: 6px;
    background: transparent; color: #ead217; cursor: pointer;
  }
  .password-input-toggle:hover { background: rgba(234,210,23,0.12); }
  .password-input-toggle:focus-visible { outline: 2px solid #ead217; outline-offset: 1px; }
`;
