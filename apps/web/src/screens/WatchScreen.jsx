import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext.jsx";

import { getDefaultGroup, getGroups } from "../api/groups.js";
import { deleteSession, getSessions } from "../api/recordings.js";

function sessionLabel(session) {
  const date = new Date(session.scheduledAt);
  const parts = [date.getFullYear(), date.getMonth() + 1, date.getDate(),
    date.getHours(), date.getMinutes(), date.getSeconds()];
  return `Session-${parts.map((part) => String(part).padStart(2, "0")).join("-")}-${session.groupId}`;
}

export function WatchScreen() {
  const { user } = useAuth();
  const [groupId, setGroupId] = useState("");
  const [groups, setGroups] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    Promise.all([getGroups(), getSessions()])
      .then(([loadedGroups, loadedSessions]) => {
        setGroups(loadedGroups);
        setGroupId(getDefaultGroup(user.id, loadedGroups));
        setSessions(
          loadedSessions
            .filter((session) => session.status === "complete")
            .sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt))
        );
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [user.id]);

  const group = groups.find((group) => group.id === groupId);
  const groupSessions = sessions.filter((session) => session.groupId === groupId);

  const removeSession = async (session) => {
    if (!window.confirm(`Delete ${sessionLabel(session)} and all its videos? This cannot be undone.`)) return;
    setDeletingId(session.id);
    setDeleteError("");
    try {
      await deleteSession(session.id);
      setSessions((current) => current.filter((item) => item.id !== session.id));
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="watch-page">
      <style>{css}</style>
      <h1>Watch</h1>

      {loading ? (
        <p>Loading recordings...</p>
      ) : error ? (
        <p role="alert" className="watch-error">{error}</p>
      ) : groups.length === 0 ? (
        <p><Link to="/groups">Join a group</Link> to see its recordings.</p>
      ) : (
        <section className="watch-group">
          <div className="watch-group-header">
            <label htmlFor="watch-group">Group:</label>
            {groups.length > 1 || !group ? (
              <select id="watch-group" value={groupId} onChange={(event) => {
                setGroupId(event.target.value);
              }}>
                {!group && <option value={groupId} disabled>Choose a group</option>}
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            ) : <strong>{group?.name}</strong>}
          </div>
          <div className="watch-group-content">
            {deleteError && <p role="alert" className="watch-error">{deleteError}</p>}
            {groupSessions.length === 0 ? (
              <p>No sessions created yet.</p>
            ) : groupSessions.map((session) => (
              <div className="watch-session" key={session.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/watch/${session.id}`)}
                >
                  <strong>{sessionLabel(session)}</strong>
                  <span className="watch-metadata">
                    <span>Members in Session: {session.memberCount ?? "—"}</span>
                    <span>Total Recordings: {session.totalRecordings ?? "—"}</span>
                  </span>
                </button>
                {group.owner === Number(user.id) && (
                  <button type="button" className="watch-delete"
                    aria-label={`Delete ${sessionLabel(session)}`}
                    title="Delete session and videos"
                    disabled={deletingId !== null}
                    onClick={() => removeSession(session)}>×</button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const css = `
  .watch-page { max-width: 900px; }
  .watch-page h1 { margin: 0 0 1.5rem; font-size: 1.8rem; }
  .watch-page p { color: #999; line-height: 1.6; }
  .watch-page a { color: #f2cb05; }
  .watch-page .watch-error { color: #ff8a80; }
  .watch-group {
    border: 1px solid #2a2a2a;
    border-radius: 12px;
    background: #1c1c1c;
    overflow: hidden;
  }
  .watch-group-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 1rem;
    background: #292929;
  }
  .watch-group-header select {
    min-width: 0;
    flex: 1;
    padding: 0.4rem;
    border: 1px solid #555;
    border-radius: 6px;
    background: #1c1c1c;
    color: #f0f0f0;
    font: inherit;
  }
  .watch-group-content { padding: 1rem; }
  .watch-group-content > p { margin: 0; }
  .watch-metadata {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 24px;
    width: 100%;
    color: #999;
    font-size: 0.85rem;
  }
  .watch-group h2 { margin: 0 0 0.75rem; font-size: 1.2rem; }
  .watch-session {
    display: flex;
    align-items: center;
    margin-bottom: 8px;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    background: #1c1c1c;
    overflow: hidden;
  }
  .watch-session button {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px 20px;
    flex: 1;
    min-width: 0;
    padding: 16px;
    border: none;
    background: transparent;
    color: #f0f0f0;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .watch-session .watch-delete {
    flex: 0 0 auto;
    width: 36px;
    height: 36px;
    margin-right: 12px;
    padding: 0;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    color: #ff6b6b;
    font-size: 1.3rem;
  }
  .watch-session .watch-delete:hover { background: #472222; }
  .watch-session .watch-delete:disabled { opacity: 0.4; cursor: default; }
  .watch-session button:hover { background: #262626; }
  .watch-session button[aria-expanded="true"] { background: #262626; }
  .watch-session strong { overflow-wrap: anywhere; }
  .watch-session time { color: #999; font-size: 0.9rem; }
  .watch-session p { margin: 0; padding: 16px; }
`;
