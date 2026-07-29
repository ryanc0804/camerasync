import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext.jsx";
import {
  createGroup,
  getGroups,
  joinGroup,
  searchGroups,
} from "../api/groups.js";
import {
  endSession,
  getSessions,
  joinSession,
} from "../api/recordings.js";

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
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [liveSessions, setLiveSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState(null);
  const [endingId, setEndingId] = useState(null);
  const [confirmingEndId, setConfirmingEndId] = useState(null);
  const [error, setError] = useState("");

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // loads live sessions for the user's groups
  useEffect(() => {
    Promise.all([getGroups(), getSessions()])
      .then(([loadedGroups, loadedSessions]) => {
        setGroups(loadedGroups);
        setLiveSessions(
          loadedSessions.filter((session) => session.status === "active")
        );
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const groupName = (groupId) =>
    groups.find((group) => group.id === groupId)?.name || groupId;

  // joins a live session from the home page
  const joinLiveSession = async (id) => {
    setError("");
    setJoiningId(id);

    try {
      const joinedSession = await joinSession(id);
      setLiveSessions((current) =>
        current.map((session) =>
          session.id === id ? joinedSession : session
        )
      );
      navigate(`/record/${joinedSession.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setJoiningId(null);
    }
  };

  // lets the creator end a live session
  const endLiveSession = async (id) => {
    setError("");
    setEndingId(id);

    try {
      await endSession(id);
      setLiveSessions((current) =>
        current.filter((session) => session.id !== id)
      );
      setConfirmingEndId(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setEndingId(null);
    }
  };

  return (
    <div>
      <style>{homeCss}</style>
      <div style={styles.date}>{today}</div>
      <h1 style={styles.title}>Welcome back, {user?.name || user?.email}</h1>
      <p style={styles.muted}>
        8kount records every angle of a practice at once. Start a session
        from <strong>Record</strong>, and every connected device begins filming
        on the same command.
      </p>

      <section className="home-live-sessions">
        <h2>Live sessions</h2>
        {error && <p className="home-live-error">{error}</p>}
        {loading ? (
          <p className="home-live-empty">Loading live sessions...</p>
        ) : liveSessions.length === 0 ? (
          <p className="home-live-empty">No sessions are live right now.</p>
        ) : (
          <div className="home-live-list">
            {liveSessions.map((session) => {
              const group = groups.find(
                (item) => item.id === session.groupId
              );

              return (
                <article
                  className="home-live-card"
                  style={{ borderLeftColor: group?.primaryColor }}
                  key={session.id}
                >
                  <div>
                    <span className="home-live-label">Live</span>
                    <h3>{session.name}</h3>
                    <p>{groupName(session.groupId)}</p>
                  </div>
                  <div className="home-live-details">
                    <span>
                      {session.activeMemberCount} active{" "}
                      {session.activeMemberCount === 1 ? "member" : "members"}
                    </span>
                    {session.isJoined ? (
                      <button
                        className="home-joined-button"
                        type="button"
                        onClick={() => navigate(`/record/${session.id}`)}
                      >
                        Enter Session
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={joiningId === session.id}
                        onClick={() => joinLiveSession(session.id)}
                      >
                        {joiningId === session.id ? "Joining..." : "Join"}
                      </button>
                    )}

                    {session.createdBy === user?.id &&
                      (confirmingEndId === session.id ? (
                        <>
                          <button
                            className="home-keep-button"
                            type="button"
                            onClick={() => setConfirmingEndId(null)}
                          >
                            Keep Live
                          </button>
                          <button
                            className="home-end-button"
                            type="button"
                            disabled={endingId === session.id}
                            onClick={() => endLiveSession(session.id)}
                          >
                            {endingId === session.id
                              ? "Ending..."
                              : "Confirm End"}
                          </button>
                        </>
                      ) : (
                        <button
                          className="home-end-button"
                          type="button"
                          onClick={() => setConfirmingEndId(session.id)}
                        >
                          End Session
                        </button>
                      ))}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export function GroupsScreen() {
  const [openPanel, setOpenPanel] = useState(null);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState("");
  const [joinQuery, setJoinQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [passwordGroupId, setPasswordGroupId] = useState(null);
  const [joinPassword, setJoinPassword] = useState("");
  const [joiningGroupId, setJoiningGroupId] = useState(null);
  const [joinError, setJoinError] = useState("");
  const [form, setForm] = useState({
    name: "",
    id: "",
    isPublic: true,
    password: "",
    primaryColor: "#ffc72c",
    secondaryColor: "#0d0d0d",
  });

  useEffect(() => {
    getGroups()
      .then(setGroups)
      .catch((err) => setCreateError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (openPanel !== "join" || !joinQuery) {
      setSearchResults([]);
      setHasSearched(false);
      setSearching(false);
      return;
    }

    let cancelled = false;
    const searchTimer = window.setTimeout(async () => {
      setSearching(true);
      setJoinError("");

      try {
        const results = await searchGroups(joinQuery);
        if (!cancelled) {
          setSearchResults(results);
          setHasSearched(true);
        }
      } catch (err) {
        if (!cancelled) {
          setJoinError(err.message);
          setSearchResults([]);
          setHasSearched(true);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(searchTimer);
    };
  }, [joinQuery, openPanel]);

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const togglePanel = (panel) => {
    setOpenPanel((current) => (current === panel ? null : panel));
    setCreateError("");
    setJoinError("");
  };

  const submitGroup = async (event) => {
    event.preventDefault();
    setCreateError("");
    setCreateSubmitting(true);

    try {
      const group = await createGroup(form);
      setGroups((current) => [group, ...current]);
      setForm({
        name: "",
        id: "",
        isPublic: true,
        password: "",
        primaryColor: "#ffc72c",
        secondaryColor: "#0d0d0d",
      });
      setOpenPanel(null);
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreateSubmitting(false);
    }
  };

  const submitJoin = async (group, password = "") => {
    setJoinError("");
    setJoiningGroupId(group.id);

    try {
      const joinedGroup = await joinGroup(group.id, password);
      setGroups((current) => {
        const alreadyListed = current.some(
          (item) => item.id.toLowerCase() === joinedGroup.id.toLowerCase()
        );
        return alreadyListed ? current : [joinedGroup, ...current];
      });
      setSearchResults((current) =>
        current.map((item) =>
          item.id === group.id ? { ...item, isMember: true } : item
        )
      );
      setPasswordGroupId(null);
      setJoinPassword("");
    } catch (err) {
      setJoinError(err.message);
    } finally {
      setJoiningGroupId(null);
    }
  };

  return (
    <div>
      <style>{groupsCss}</style>
      <h1 style={styles.title}>Groups</h1>
      <p style={styles.muted}>
        Teams and organizations — Team Knightro, UCF Cheer, UCF Dance Team.
        Admins create groups and manage members; members join with a group
        password.
      </p>

      <div className="groups-grid">
        <section className="group-panel">
          <h2>Your groups</h2>
          {loading ? (
            <p className="group-empty">Loading groups...</p>
          ) : groups.length === 0 ? (
            <p className="group-empty">
              You are not a member of any groups yet.
            </p>
          ) : (
            <div className="group-list">
              {groups.map((group) => (
                <div className="group-row" key={group.id}>
                  <span
                    className="group-colors-icon"
                    style={{
                      background: `linear-gradient(135deg, ${group.primaryColor} 0 50%, ${group.secondaryColor} 50% 100%)`,
                    }}
                  />
                  <span>{group.name}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="group-tools">
          <section className="group-panel group-tool-panel">
            <button
              className="group-button group-tool-button"
              type="button"
              onClick={() => togglePanel("create")}
              aria-expanded={openPanel === "create"}
            >
              Create Group
            </button>

            {openPanel === "create" && (
              <form className="group-tool-content" onSubmit={submitGroup}>
                {createError && (
                  <p className="group-error">{createError}</p>
                )}

                <label className="group-field">
                  Name
                  <input
                    type="text"
                    value={form.name}
                    onChange={(event) =>
                      updateForm("name", event.target.value)
                    }
                    placeholder="Group name"
                    required
                  />
                </label>

                <label className="group-field">
                  ID
                  <input
                    type="text"
                    pattern="[A-Za-z0-9]+"
                    value={form.id}
                    placeholder="Letters and numbers only"
                    onChange={(event) =>
                      updateForm(
                        "id",
                        event.target.value.replace(/[^a-zA-Z0-9]/g, "")
                      )
                    }
                    required
                  />
                </label>

                <div className="group-privacy-row">
                  <label className="group-visibility">
                    <input
                      type="checkbox"
                      checked={form.isPublic}
                      onChange={(event) =>
                        updateForm("isPublic", event.target.checked)
                      }
                    />
                    <span className="group-switch" />
                    <span>{form.isPublic ? "Public" : "Private"}</span>
                  </label>

                  <label className="group-field group-password">
                    Password
                    <input
                      type="password"
                      value={form.password}
                      onChange={(event) =>
                        updateForm("password", event.target.value)
                      }
                      placeholder="Password"
                      readOnly={form.isPublic}
                      required={!form.isPublic}
                    />
                  </label>
                </div>

                <div className="group-colors">
                  <label className="group-field">
                    Primary color
                    <input
                      type="color"
                      value={form.primaryColor}
                      onChange={(event) =>
                        updateForm("primaryColor", event.target.value)
                      }
                    />
                  </label>
                  <label className="group-field">
                    Secondary color
                    <input
                      type="color"
                      value={form.secondaryColor}
                      onChange={(event) =>
                        updateForm("secondaryColor", event.target.value)
                      }
                    />
                  </label>
                </div>

                <div className="group-actions">
                  <button
                    className="group-button"
                    type="button"
                    onClick={() => setOpenPanel(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="group-button group-button-primary"
                    type="submit"
                    disabled={createSubmitting}
                  >
                    {createSubmitting ? "Creating..." : "Create Group"}
                  </button>
                </div>
              </form>
            )}
          </section>

          <section className="group-panel group-tool-panel">
            <button
              className="group-button group-tool-button"
              type="button"
              onClick={() => togglePanel("join")}
              aria-expanded={openPanel === "join"}
            >
              Join Group
            </button>

            {openPanel === "join" && (
              <div className="group-tool-content">
                <label className="group-field">
                  Group ID
                  <input
                    type="text"
                    value={joinQuery}
                    placeholder="Search by group ID"
                    onChange={(event) => {
                      setJoinQuery(
                        event.target.value.replace(/[^a-zA-Z0-9]/g, "")
                      );
                      setPasswordGroupId(null);
                      setJoinPassword("");
                    }}
                  />
                </label>

                {joinError && <p className="group-error">{joinError}</p>}
                {searching ? (
                  <p className="group-search-message">Searching...</p>
                ) : hasSearched && searchResults.length === 0 ? (
                  <p className="group-search-message">
                    Could Not Find Group
                  </p>
                ) : (
                  <div className="group-search-results">
                    {searchResults.map((group) => (
                      <div className="group-search-result" key={group.id}>
                        <div className="group-search-row">
                          <div className="group-search-name">
                            <strong>{group.name}</strong>
                            <span>{group.id}</span>
                          </div>

                          {group.isMember ? (
                            <span className="group-membership">
                              You are already a group member
                            </span>
                          ) : (
                            <button
                              className="group-button group-join-button"
                              type="button"
                              disabled={joiningGroupId === group.id}
                              onClick={() => {
                                if (group.isPublic) {
                                  submitJoin(group);
                                } else {
                                  setJoinError("");
                                  setPasswordGroupId(group.id);
                                  setJoinPassword("");
                                }
                              }}
                            >
                              {joiningGroupId === group.id
                                ? "Joining..."
                                : "Join"}
                            </button>
                          )}
                        </div>

                        {!group.isPublic &&
                          !group.isMember &&
                          passwordGroupId === group.id && (
                            <form
                              className="group-join-password"
                              onSubmit={(event) => {
                                event.preventDefault();
                                submitJoin(group, joinPassword);
                              }}
                            >
                              <input
                                type="password"
                                value={joinPassword}
                                placeholder="Password"
                                onChange={(event) =>
                                  setJoinPassword(event.target.value)
                                }
                                autoFocus
                                required
                              />
                              <button
                                className="group-button group-button-primary"
                                type="submit"
                                disabled={joiningGroupId === group.id}
                              >
                                {joiningGroupId === group.id
                                  ? "Joining..."
                                  : "Join"}
                              </button>
                            </form>
                          )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

const homeCss = `
  .home-live-sessions {
    width: min(100%, 760px);
    margin-top: 28px;
  }
  .home-live-sessions h2 {
    margin: 0 0 12px;
    font-size: 1.2rem;
  }
  .home-live-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .home-live-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 16px;
    border: 1px solid #303030;
    border-left: 4px solid #ffc72c;
    border-radius: 8px;
    background: #202020;
  }
  .home-live-card h3 {
    margin: 4px 0;
    font-size: 1rem;
  }
  .home-live-card p,
  .home-live-card span {
    margin: 0;
    color: #999;
    font-size: 0.85rem;
  }
  .home-live-card .home-live-label {
    color: #72d58c;
    font-weight: 700;
    text-transform: uppercase;
  }
  .home-live-details {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 14px;
  }
  .home-live-details button {
    min-width: 72px;
    padding: 8px 12px;
    border: 1px solid #ffc72c;
    border-radius: 7px;
    background: #ffc72c;
    color: #0d0d0d;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .home-live-details button:disabled {
    cursor: default;
    opacity: 0.55;
  }
  .home-live-details .home-joined-button {
    border-color: #4f8f63;
    background: transparent;
    color: #72d58c;
    opacity: 1;
  }
  .home-live-details .home-end-button {
    border-color: #7a3434;
    background: transparent;
    color: #ff8a80;
  }
  .home-live-details .home-keep-button {
    border-color: #444;
    background: #292929;
    color: #eee;
  }
  .home-live-empty,
  .home-live-error {
    margin: 0;
    padding: 20px 14px;
    border: 1px dashed #3a3a3a;
    border-radius: 8px;
    color: #888;
    text-align: center;
  }
  .home-live-error {
    margin-bottom: 10px;
    color: #ff8a80;
  }
  @media (max-width: 600px) {
    .home-live-card,
    .home-live-details {
      align-items: flex-start;
      flex-direction: column;
    }
  }
`;

const groupsCss = `
  .groups-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
    gap: 24px;
    align-items: start;
    max-width: 960px;
    margin-top: 28px;
  }
  .group-panel {
    padding: 22px;
    background: #1e1e1e;
    border: 1px solid #2a2a2a;
    border-radius: 10px;
  }
  .group-panel h2 {
    margin: 0 0 18px;
    font-size: 1.15rem;
  }
  .group-tools {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .group-tool-panel {
    padding: 14px;
  }
  .group-tool-button {
    width: 100%;
    border-color: #ffc72c;
  }
  .group-tool-content {
    margin-top: 18px;
  }
  .group-empty {
    margin: 0;
    padding: 28px 16px;
    border: 1px dashed #3a3a3a;
    border-radius: 8px;
    color: #888;
    text-align: center;
  }
  .group-list {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .group-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 11px 13px;
    border: 1px solid #303030;
    border-radius: 8px;
    background: #242424;
    font-weight: 600;
  }
  .group-colors-icon {
    width: 34px;
    height: 34px;
    flex: 0 0 34px;
    border: 1px solid #555;
    border-radius: 50%;
  }
  .group-error {
    margin: 0 0 14px;
    padding: 9px 11px;
    border: 1px solid #5a2a2a;
    border-radius: 7px;
    background: #2a1a1a;
    color: #ff8a80;
    font-size: 0.85rem;
  }
  .group-field {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin-bottom: 15px;
    color: #ddd;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .group-field input[type="text"],
  .group-field input[type="password"],
  .group-join-password input {
    box-sizing: border-box;
    width: 100%;
    padding: 10px 11px;
    border: 1px solid #3a3a3a;
    border-radius: 7px;
    outline: none;
    background: #262626;
    color: #f0f0f0;
    font: inherit;
  }
  .group-field input:focus {
    border-color: #ffc72c;
  }
  .group-field input:disabled {
    border-color: #303030;
    background: #202020;
    color: #666;
    cursor: not-allowed;
    opacity: 0.7;
  }
  .group-privacy-row {
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr);
    gap: 14px;
    align-items: end;
  }
  .group-visibility {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    margin-bottom: 15px;
    color: #ddd;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .group-visibility input {
    position: absolute;
    opacity: 0;
  }
  .group-switch {
    position: relative;
    width: 36px;
    height: 20px;
    border-radius: 10px;
    background: #555;
  }
  .group-switch::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #eee;
    transition: left 0.15s;
  }
  .group-visibility input:checked + .group-switch {
    background: #ffc72c;
  }
  .group-visibility input:checked + .group-switch::after {
    left: 19px;
    background: #0d0d0d;
  }
  .group-password {
    min-width: 0;
  }
  .group-search-message {
    margin: 4px 0 0;
    padding: 18px 10px;
    border: 1px dashed #3a3a3a;
    border-radius: 7px;
    color: #888;
    text-align: center;
  }
  .group-search-results {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .group-search-result {
    padding: 11px;
    border: 1px solid #303030;
    border-radius: 8px;
    background: #242424;
  }
  .group-search-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .group-search-name {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
  }
  .group-search-name strong,
  .group-search-name span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .group-search-name span {
    color: #999;
    font-size: 0.8rem;
  }
  .group-membership {
    max-width: 145px;
    color: #999;
    font-size: 0.78rem;
    line-height: 1.3;
    text-align: right;
  }
  .group-join-button {
    flex: 0 0 auto;
  }
  .group-join-password {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 9px;
    margin-top: 10px;
  }
  .group-join-password input:focus {
    border-color: #ffc72c;
  }
  .group-colors {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .group-field input[type="color"] {
    width: 100%;
    height: 38px;
    padding: 3px;
    border: 1px solid #3a3a3a;
    border-radius: 7px;
    background: #262626;
    cursor: pointer;
  }
  .group-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 6px;
  }
  .group-button {
    padding: 9px 14px;
    border: 1px solid #3a3a3a;
    border-radius: 7px;
    background: #262626;
    color: #f0f0f0;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .group-button:hover {
    background: #303030;
  }
  .group-button-primary {
    border-color: #ffc72c;
    background: #ffc72c;
    color: #0d0d0d;
  }
  .group-button-primary:hover {
    background: #ffd75e;
  }
  .group-button:disabled {
    cursor: default;
    opacity: 0.55;
  }
  @media (max-width: 850px) {
    .groups-grid {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 480px) {
    .group-privacy-row {
      grid-template-columns: 1fr;
      gap: 0;
    }
    .group-visibility {
      margin-bottom: 8px;
    }
  }
`;

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
