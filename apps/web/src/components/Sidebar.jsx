import { NavLink } from "react-router-dom";

import { useAuth } from "../auth/AuthContext.jsx";

// Three-person "group" mark. Inline SVG rather than an emoji so it stays
// monochrome and inherits the nav item's color on hover/active.
function GroupsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="32"
      height="32"
      fill="currentColor"
      aria-hidden="true"
    >
      {/* centre figure */}
      <circle cx="12" cy="7.2" r="3.2" />
      <path d="M12 11.8c-2.9 0-5.2 1.7-5.2 3.9V18h10.4v-2.3c0-2.2-2.3-3.9-5.2-3.9z" />
      {/* left figure */}
      <circle cx="4.7" cy="9.3" r="2.4" />
      <path d="M4.7 12.5c-2.1 0-3.9 1.3-3.9 2.9V18h4.3v-2.3c0-1.2.5-2.2 1.4-3-.6-.1-1.2-.2-1.8-.2z" />
      {/* right figure */}
      <circle cx="19.3" cy="9.3" r="2.4" />
      <path d="M19.3 12.5c-.6 0-1.2.1-1.8.2.9.8 1.4 1.8 1.4 3V18h4.3v-2.6c0-1.6-1.8-2.9-3.9-2.9z" />
    </svg>
  );
}

// Video camera mark for the recording section.
function CameraIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="32"
      height="32"
      fill="currentColor"
      aria-hidden="true"
    >
      {/* body */}
      <rect x="1.5" y="6" width="14" height="12" rx="2.5" />
      {/* lens barrel pointing right */}
      <path d="M17.5 11.2l4.1-2.6c.5-.3 1.1 0 1.1.6v7.6c0 .6-.6.9-1.1.6l-4.1-2.6v-3.6z" />
    </svg>
  );
}

const NAV_ITEMS = [
  { to: "/", label: "Home", icon: "⌂", end: true },
  { to: "/groups", label: "Groups", icon: <GroupsIcon /> },
  { to: "/record", label: "Record", icon: <CameraIcon /> },
  { to: "/calendar", label: "Calendar", icon: "▦" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

/// Yellow primary navigation. Sits fixed on the left; the app content scrolls
/// beside it.
export function Sidebar() {
  const { user, logout } = useAuth();

  return (
    <nav style={styles.sidebar}>
      <style>{css}</style>

      <div style={styles.brand}>8kount</div>

      <ul style={styles.list}>
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                isActive ? "kh-nav kh-nav-active" : "kh-nav"
              }
            >
              <span style={styles.icon} aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>

      <div style={styles.footer}>
        {user && <div style={styles.user}>{user.name || user.email}</div>}
        <button type="button" className="kh-logout" onClick={logout}>
          Log out
        </button>
      </div>
    </nav>
  );
}

export const SIDEBAR_WIDTH = 140;

const styles = {
  sidebar: {
    position: "fixed",
    top: 0,
    left: 0,
    bottom: 0,
    width: SIDEBAR_WIDTH,
    background: "#ffc72c",
    color: "#0d0d0d",
    display: "flex",
    flexDirection: "column",
    fontFamily: "system-ui, sans-serif",
    boxSizing: "border-box",
  },
  brand: {
    fontSize: "1.05rem",
    fontWeight: 800,
    letterSpacing: "0.3px",
    textAlign: "center",
    padding: "1.25rem 0.5rem 1rem",
    borderBottom: "1px solid rgba(0,0,0,0.15)",
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: "0.75rem 0.5rem",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    flex: 1,
  },
  icon: {
    display: "block",
    fontSize: "2rem",
    lineHeight: 1,
    marginBottom: 8,
  },
  footer: {
    padding: "1rem 0.75rem",
    borderTop: "1px solid rgba(0,0,0,0.15)",
    fontSize: "0.8rem",
    textAlign: "center",
  },
  user: {
    fontWeight: 600,
    marginBottom: 8,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};

// Hover/active states can't be expressed inline.
const css = `
  .kh-nav {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 0.7rem 0.4rem;
    border-radius: 8px;
    color: #0d0d0d;
    text-decoration: none;
    font-size: 0.8rem;
    font-weight: 600;
    text-align: center;
    transition: background 0.12s, color 0.12s;
  }
  .kh-nav:hover { background: rgba(0,0,0,0.10); }
  .kh-nav-active,
  .kh-nav-active:hover {
    background: #0d0d0d;
    color: #ffc72c;
  }
  .kh-logout {
    font: inherit;
    font-weight: 600;
    padding: 0.45rem 0.8rem;
    border: 1px solid rgba(0,0,0,0.35);
    border-radius: 8px;
    background: transparent;
    color: #0d0d0d;
    cursor: pointer;
    transition: background 0.12s;
  }
  .kh-logout:hover { background: rgba(0,0,0,0.10); }
`;
