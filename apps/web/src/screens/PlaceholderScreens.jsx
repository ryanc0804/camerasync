import { useAuth } from "../auth/AuthContext.jsx";

// Shells for the sections that don't have backing APIs yet. Each states what
// it will hold so the nav is honest about what's built vs. planned.

const styles = {
  date: {
    color: "#ffc72c",
    fontSize: "0.85rem",
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    marginBottom: "0.4rem",
  },
  title: { margin: "0 0 0.5rem", fontSize: "1.8rem" },
  muted: { color: "#999", lineHeight: 1.6, maxWidth: "48ch" },
  note: {
    marginTop: "1.5rem",
    padding: "0.8rem 1rem",
    background: "#1e1e1e",
    border: "1px solid #2a2a2a",
    borderLeft: "3px solid #ffc72c",
    borderRadius: 6,
    color: "#bbb",
    fontSize: "0.9rem",
    maxWidth: "48ch",
  },
};

export function HomeScreen() {
  const { user } = useAuth();

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div>
      <div style={styles.date}>{today}</div>
      <h1 style={styles.title}>Welcome back, {user?.name || user?.email}</h1>
      <p style={styles.muted}>
        8kount records every angle of a practice at once. Start a session
        from <strong>Record</strong>, and every connected device begins filming
        on the same command.
      </p>
      <div style={styles.note}>
        Upcoming sessions and recent recordings will appear here once sessions
        exist in the API.
      </div>
    </div>
  );
}

export function GroupsScreen() {
  return (
    <div>
      <h1 style={styles.title}>Groups</h1>
      <p style={styles.muted}>
        Teams and organizations — Team Knightro, UCF Cheer, UCF Dance Team.
        Admins create groups and manage members; members join with a group
        password.
      </p>
      <div style={styles.note}>
        Needs the <code>/api/groups</code> endpoints, which are still stubs.
      </div>
    </div>
  );
}

export function SettingsScreen() {
  const { user } = useAuth();
  return (
    <div>
      <h1 style={styles.title}>Settings</h1>
      <dl style={{ ...styles.muted, display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.5rem 1.5rem" }}>
        <dt style={{ fontWeight: 600, color: "#e0e0e0" }}>Name</dt>
        <dd style={{ margin: 0 }}>{user?.name || "—"}</dd>
        <dt style={{ fontWeight: 600, color: "#e0e0e0" }}>Email</dt>
        <dd style={{ margin: 0 }}>{user?.email}</dd>
      </dl>
      <div style={styles.note}>
        Editing your profile, changing your password, and group-level
        preferences land here.
      </div>
    </div>
  );
}
