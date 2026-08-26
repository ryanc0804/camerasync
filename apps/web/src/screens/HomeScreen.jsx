import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext.jsx";
import { getGroups } from "../api/groups.js";
import { endSession, getSessions, joinSession } from "../api/recordings.js";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

/// Home dashboard: greeting + quick actions, stats, the live-session card,
/// and the recordings/notifications panels. Recordings and notifications have
/// no backing API yet, so those panels render empty states.
export function HomeScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState(null);
  const [endingId, setEndingId] = useState(null);
  const [confirmingEndId, setConfirmingEndId] = useState(null);
  const [error, setError] = useState("");
  const [liveIndex, setLiveIndex] = useState(0);
  const [comingSoon, setComingSoon] = useState(false);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  const firstName = (user?.name || user?.email || "").split(/[\s@]/)[0];

  useEffect(() => {
    Promise.all([getGroups(), getSessions()])
      .then(([loadedGroups, loadedSessions]) => {
        setGroups(loadedGroups);
        setSessions(
          loadedSessions.filter((session) => session.status !== "cancelled")
        );
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const liveSessions = sessions.filter(
    (session) => session.status === "active"
  );
  const live = liveSessions[Math.min(liveIndex, liveSessions.length - 1)];
  const groupName = (groupId) =>
    groups.find((group) => group.id === groupId)?.name || groupId;

  // joins a live session from the home page
  const joinLiveSession = async (id) => {
    setError("");
    setJoiningId(id);

    try {
      const joinedSession = await joinSession(id);
      setSessions((current) =>
        current.map((session) => (session.id === id ? joinedSession : session))
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
      setSessions((current) =>
        current.filter((session) => session.id !== id)
      );
      setConfirmingEndId(null);
      setLiveIndex(0);
    } catch (err) {
      setError(err.message);
    } finally {
      setEndingId(null);
    }
  };

  return (
    <div className="home">
      <style>{css}</style>

      <div className="home-grid">
        {/* Left column: header, stats, recordings */}
        <div className="home-main">
          <header className="home-header">
            <div>
              <div className="home-date">{today}</div>
              <h1 className="home-title">
                {greeting()}, {firstName}
              </h1>
            </div>
            <div className="home-actions">
              <button
                type="button"
                className="home-action"
                onClick={() => setComingSoon(true)}
              >
                Watch a Recording
              </button>
              <button
                type="button"
                className="home-action"
                onClick={() => navigate("/record")}
              >
                Record a practice
              </button>
            </div>
          </header>

          {error && <p className="home-error">{error}</p>}

          <div className="home-stats">
            <div className="home-stat">
              <span>Groups</span>
              <strong>{loading ? "…" : groups.length}</strong>
            </div>
            <div className="home-stat">
              <span>Sessions</span>
              <strong>{loading ? "…" : sessions.length}</strong>
            </div>
            <div className="home-stat">
              <span>Videos</span>
              <strong>—</strong>
            </div>
          </div>

          <h2 className="home-section">Recent Recordings</h2>
          <div className="home-panel home-panel-tall">
            <p className="home-empty">
              {comingSoon
                ? "Recordings are coming soon — they'll appear here once synced sessions upload their videos."
                : "Recordings from your synced sessions will show up here."}
            </p>
          </div>
        </div>

        {/* Right column: live card + notifications */}
        <div className="home-side">
          <div className="home-swipe">
            <span>{liveSessions.length > 1 ? "More live sessions" : ""}</span>
            {liveSessions.length > 1 && (
              <span className="home-dots">
                {liveSessions.map((session, i) => (
                  <button
                    key={session.id}
                    type="button"
                    className={i === liveIndex ? "dot dot-active" : "dot"}
                    aria-label={`Show live session ${i + 1}`}
                    onClick={() => setLiveIndex(i)}
                  />
                ))}
              </span>
            )}
          </div>

          {live ? (
            <div className="home-live-card">
              <div className="home-live-tag">
                <span className="home-live-dot" /> Live Now
              </div>
              <h3>{live.name}</h3>
              <p>
                {live.activeMemberCount}{" "}
                {live.activeMemberCount === 1 ? "device" : "devices"} connected
                {" · "}
                {groupName(live.groupId)}
              </p>

              {live.isJoined ? (
                <button
                  type="button"
                  className="home-join"
                  onClick={() => navigate(`/record/${live.id}`)}
                >
                  Enter Session
                </button>
              ) : (
                <button
                  type="button"
                  className="home-join"
                  disabled={joiningId === live.id}
                  onClick={() => joinLiveSession(live.id)}
                >
                  {joiningId === live.id ? "Joining…" : "Join"}
                </button>
              )}

              {live.createdBy === user?.id &&
                (confirmingEndId === live.id ? (
                  <div className="home-end-row">
                    <button
                      type="button"
                      onClick={() => setConfirmingEndId(null)}
                    >
                      Keep live
                    </button>
                    <button
                      type="button"
                      className="home-end-confirm"
                      disabled={endingId === live.id}
                      onClick={() => endLiveSession(live.id)}
                    >
                      {endingId === live.id ? "Ending…" : "Confirm end"}
                    </button>
                  </div>
                ) : (
                  <div className="home-end-row">
                    <button
                      type="button"
                      onClick={() => setConfirmingEndId(live.id)}
                    >
                      End session
                    </button>
                  </div>
                ))}
            </div>
          ) : (
            <div className="home-panel">
              <p className="home-empty">
                {loading
                  ? "Checking for live sessions…"
                  : "No sessions are live right now."}
              </p>
            </div>
          )}

          <h2 className="home-section">Notifications</h2>
          <div className="home-panel home-panel-tall">
            <p className="home-empty">No notifications yet.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const css = `
  .home-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 380px;
    gap: 36px;
    align-items: start;
    max-width: 1400px;
  }
  .home-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 16px;
    margin-bottom: 28px;
  }
  .home-date {
    color: #d0d0d0;
    font-size: 1.05rem;
    margin-bottom: 4px;
  }
  .home-title {
    margin: 0;
    font-size: 2.3rem;
    font-weight: 800;
    letter-spacing: -0.5px;
  }
  .home-actions {
    display: flex;
    gap: 14px;
  }
  .home-action {
    font: inherit;
    font-weight: 700;
    padding: 0.85rem 1.5rem;
    border: none;
    border-radius: 12px;
    background: #f2cb05;
    color: #000;
    cursor: pointer;
    transition: background 0.12s;
  }
  .home-action:hover { background: #ffe159; }

  .home-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 22px;
    margin-bottom: 40px;
  }
  .home-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 28px 12px;
    background: #161616;
    border-radius: 16px;
  }
  .home-stat span {
    color: #a0a0a0;
    font-size: 1rem;
  }
  .home-stat strong {
    font-size: 2.4rem;
    font-weight: 800;
    line-height: 1;
  }

  .home-section {
    margin: 0 0 14px;
    color: #f2cb05;
    font-size: 1.25rem;
    font-weight: 700;
  }
  .home-panel {
    padding: 20px;
    background: #141414;
    border-radius: 16px;
  }
  .home-panel-tall { min-height: 180px; }
  .home-empty {
    margin: 0;
    padding: 28px 8px;
    color: #8a8a8a;
    line-height: 1.6;
    text-align: center;
  }
  .home-error {
    margin: 0 0 16px;
    padding: 10px 14px;
    border: 1px solid #5a2a2a;
    border-radius: 8px;
    background: #2a1a1a;
    color: #ff8a80;
  }

  .home-swipe {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 20px;
    margin-bottom: 8px;
    color: #999;
    font-size: 0.85rem;
  }
  .home-dots { display: flex; gap: 6px; }
  .dot {
    width: 9px;
    height: 9px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: #3a3a3a;
    cursor: pointer;
  }
  .dot-active { background: #f2cb05; }

  .home-live-card {
    padding: 22px;
    background: #f2cb05;
    border-radius: 20px;
    color: #000;
  }
  .home-live-tag {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 0.9rem;
    font-weight: 600;
  }
  .home-live-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #f0432e;
  }
  .home-live-card h3 {
    margin: 8px 0 4px;
    font-size: 1.65rem;
    font-weight: 800;
  }
  .home-live-card p {
    margin: 0 0 18px;
    color: rgba(0,0,0,0.6);
  }
  .home-join {
    width: 100%;
    font: inherit;
    font-weight: 700;
    font-size: 1rem;
    padding: 0.9rem;
    border: none;
    border-radius: 999px;
    background: #000;
    color: #fff;
    cursor: pointer;
  }
  .home-join:disabled { cursor: default; opacity: 0.6; }
  .home-end-row {
    display: flex;
    justify-content: center;
    gap: 18px;
    margin-top: 10px;
  }
  .home-end-row button {
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    padding: 4px 6px;
    border: none;
    background: none;
    color: rgba(0,0,0,0.55);
    cursor: pointer;
    text-decoration: underline;
  }
  .home-end-row .home-end-confirm { color: #a01c0e; }
  .home-end-row button:disabled { cursor: default; opacity: 0.6; }

  @media (max-width: 1080px) {
    .home-grid { grid-template-columns: 1fr; }
  }
`;
