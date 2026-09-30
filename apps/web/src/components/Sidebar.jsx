import { NavLink } from "react-router-dom";

import { useAuth } from "../auth/AuthContext.jsx";

// Three-person "group" mark. Inline SVG rather than an emoji so it stays
// monochrome and inherits the nav item's color on hover/active.
function GroupsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
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
      width="28"
      height="28"
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

function HomeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 10.5 12 3.5l8.5 7v9a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 2.8V6.6M16 2.8V6.6" strokeLinecap="round" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3.2" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.9 1.9M7.4 16.6l-1.9 1.9M18.5 18.5l-1.9-1.9M7.4 7.4 5.5 5.5"
      />
    </svg>
  );
}

const NAV_ITEMS = [
  { to: "/", label: "Home", icon: <HomeIcon />, end: true },
  { to: "/groups", label: "Groups", icon: <GroupsIcon /> },
  { to: "/record", label: "Record", icon: <CameraIcon /> },
  { to: "/calendar", label: "Calendar", icon: <CalendarIcon /> },
  { to: "/settings", label: "Settings", icon: <GearIcon /> },
];

/// Yellow primary navigation. Sits fixed on the left; the app content scrolls
/// beside it. The active route gets a lighter-yellow tile, per the design.
export function Sidebar() {
  const { user, logout } = useAuth();

  return (
    <nav style={styles.sidebar}>
      <style>{css}</style>

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
        <button
          type="button"
          className="kh-logout"
          onClick={logout}
          title="Log out"
        >
          <span aria-hidden="true">←</span> Log out
        </button>
      </div>
    </nav>
  );
}

export const SIDEBAR_WIDTH = 150;

const styles = {
  sidebar: {
    position: "fixed",
    top: 0,
    left: 0,
    bottom: 0,
    width: SIDEBAR_WIDTH,
    background: "#f2cb05",
    color: "#000",
    display: "flex",
    flexDirection: "column",
    fontFamily: "system-ui, sans-serif",
    boxSizing: "border-box",
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: "0.6rem 0.6rem 0",
    display: "flex",
    flexDirection: "column",
    gap: 26,
    flex: 1,
  },
  icon: {
    display: "block",
    lineHeight: 1,
    marginBottom: 8,
  },
  footer: {
    padding: "1rem 0.75rem 1.25rem",
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
    padding: 0.9rem 0.4rem;
    border-radius: 14px;
    color: #000;
    text-decoration: none;
    font-size: 0.85rem;
    font-weight: 600;
    text-align: center;
    transition: background 0.12s;
  }
  .kh-nav:hover { background: rgba(255,255,255,0.28); }
  .kh-nav-active,
  .kh-nav-active:hover {
    background: #ffe870;
  }
  .kh-logout {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: inherit;
    font-weight: 700;
    padding: 0.45rem 0.8rem;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: #000;
    cursor: pointer;
    transition: background 0.12s;
  }
  .kh-logout:hover { background: rgba(255,255,255,0.28); }
`;
