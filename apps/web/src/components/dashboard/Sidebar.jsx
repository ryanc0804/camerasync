const navItems = [
  { id: "home", label: "Home" },
  { id: "groups", label: "Groups" },
  { id: "recordings", label: "Recordings" },
  { id: "playback", label: "Playback" },
  { id: "record", label: "Record" },
  { id: "settings", label: "Settings" },
];

function NavIcon({ name }) {
  if (name === "home") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m3 10.5 9-7.5 9 7.5" />
        <path d="M5 9.5V21h14V9.5M9 21v-7h6v7" />
      </svg>
    );
  }

  if (name === "recordings") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 4h12M5 7h14" />
        <rect x="3" y="10" width="18" height="11" rx="2" />
        <path d="m10 13 5 2.5-5 2.5Z" />
      </svg>
    );
  }

  if (name === "groups") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="3" />
        <circle cx="5.5" cy="10.5" r="2.2" />
        <circle cx="18.5" cy="10.5" r="2.2" />
        <path d="M7 20v-2a5 5 0 0 1 10 0v2M2 19v-1a3.5 3.5 0 0 1 4-3.5M22 19v-1a3.5 3.5 0 0 0-4-3.5" />
      </svg>
    );
  }

  if (name === "playback") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="m10 8 6 4-6 4Z" />
      </svg>
    );
  }

  if (name === "record") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <circle className="solid-icon-part" cx="12" cy="12" r="4.5" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" />
    </svg>
  );
}

export function Sidebar({ activePage, onNavigate }) {
  return (
    <aside className="dashboard-sidebar">
      <nav className="sidebar-nav" aria-label="Dashboard navigation">
        {navItems.map((item) => (
          <button
            aria-label={item.label}
            aria-current={activePage === item.id ? "page" : undefined}
            className={`sidebar-link ${activePage === item.id ? "is-active" : ""}`}
            key={item.id}
            title={item.label}
            type="button"
            onClick={() => onNavigate(item.id)}
          >
            <span className="sidebar-icon"><NavIcon name={item.id} /></span>
            <span className="sidebar-label">{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
