import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext.jsx";
import { getGroups } from "../api/groups.js";
import { EmptyState } from "../components/EmptyState.jsx";
import { NotificationList } from "../components/NotificationList.jsx";
import { getNotifications, markNotificationsSeen } from "../api/notifications.js";
import { endSession, getMyVideoCount, getSessions, joinSession } from "../api/recordings.js";

const NOTIFICATIONS_ON_HOME = 4;

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

/// Home dashboard: greeting + quick actions, stats, the live-session card,
/// recent recordings, and the newest notifications.
export function HomeScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [videoCount, setVideoCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState(null);
  const [endingId, setEndingId] = useState(null);
  const [confirmingEndId, setConfirmingEndId] = useState(null);
  const [error, setError] = useState("");
  const [liveIndex, setLiveIndex] = useState(0);
  const [notifications, setNotifications] = useState(null);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  const firstName = (user?.name || user?.email || "").split(/[\s@]/)[0];

  useEffect(() => {
    Promise.all([getGroups(), getSessions(), getMyVideoCount()])
      .then(([loadedGroups, loadedSessions, loadedVideoCount]) => {
        setGroups(loadedGroups);
        setVideoCount(loadedVideoCount);
        setSessions(
          loadedSessions.filter((session) => session.status !== "cancelled")
        );
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Notifications load on their own (a failure just leaves the panel empty)
  // and refresh every 30 seconds. Showing them here counts as seeing them;
  // they stay highlighted until the next load.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getNotifications(NOTIFICATIONS_ON_HOME)
        .then((data) => {
          if (cancelled) return;
          setNotifications(data.notifications);
          if (data.unreadCount > 0) markNotificationsSeen().catch(() => {});
        })
        .catch(() => {
          if (!cancelled) setNotifications((current) => current ?? []);
        });
    load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const liveSessions = sessions.filter(
    (session) => session.status === "active"
  );
  // Completed sessions are the recordings; per the design, Home is the
  // primary way into them ("View all" opens the full list).
  const recentRecordings = sessions
    .filter((session) => session.status === "complete")
    .sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt))
    .slice(0, 5);
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

      {/* One grid, so each row lines up across both columns as in the
          Desktop-home design: greeting and stats beside the live card, then
          recent recordings beside notifications. */}
      <div className="home-grid">
        <div className="home-top">
          <header className="home-header">
            <div>
              <div className="home-date">{today}</div>
              <h1 className="home-title">
                {greeting()}, {firstName}
              </h1>
            </div>
            <div className="home-actions">
              <button type="button" className="home-action" onClick={() => navigate("/watch")}>
                Watch a Recording
              </button>
              <button type="button" className="home-action" onClick={() => navigate("/record")}>
                Record a practice
              </button>
            </div>
          </header>

          {error && <p className="home-error">{error}</p>}

          {!loading && !error && groups.length === 0 && (
            <EmptyState title="Welcome to 8kount" action="Find your group" to="/groups">
              Everything here belongs to a group: sessions, recordings and the
              people in them. Start by joining your team's group, or create one
              if you're the coach.
            </EmptyState>
          )}

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
              <strong>{loading ? "…" : videoCount ?? "—"}</strong>
            </div>
          </div>
        </div>

        <div className="home-live">
          <div className="home-swipe">
            <span>{liveSessions.length > 1 ? "Swipe for more" : ""}</span>
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
              <div>
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
              </div>

              <div>
                {live.isJoined ? (
                  <button type="button" className="home-join" onClick={() => navigate(`/record/${live.id}`)}>
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

                {(live.createdBy === user?.id ||
                  groups.some((group) => group.id === live.groupId && group.role === "admin")) &&
                  (confirmingEndId === live.id ? (
                    <div className="home-end-row">
                      <button type="button" onClick={() => setConfirmingEndId(null)}>
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
                      <button type="button" onClick={() => setConfirmingEndId(live.id)}>
                        End session
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <div className="home-panel home-live-empty">
              {loading ? (
                <p className="home-empty">Checking for live sessions…</p>
              ) : (
                <EmptyState
                  compact
                  title="Nothing live right now"
                  action={groups.length > 0 ? "Start a session" : undefined}
                  to="/record"
                >
                  When a coach starts a session, it appears here with a Join
                  button.
                </EmptyState>
              )}
            </div>
          )}
        </div>

        <section className="home-column">
          {/* Same as mobile: "View all" sits at the right of the section title. */}
          <div className="home-section-row">
            <h2 className="home-section">Recent Recordings</h2>
            {recentRecordings.length > 0 && (
              <button type="button" className="home-view-all" onClick={() => navigate("/watch")}>
                View all
              </button>
            )}
          </div>
          <div className="home-panel home-panel-fill">
            {recentRecordings.length === 0 ? (
              <EmptyState
                title="No recordings yet"
                action={groups.length > 0 ? "Record a practice" : undefined}
                to="/record"
              >
                {groups.length > 0
                  ? "Run a synced session and its recordings will show up here."
                  : "Join a group first. Recordings from its sessions will show up here."}
              </EmptyState>
            ) : (
                <ul className="home-recordings">
                  {recentRecordings.map((session) => (
                    <li key={session.id}>
                      <button type="button" onClick={() => navigate(`/watch/${session.id}`)}>
                        <span className="home-thumb" aria-hidden="true">
                          <span className="home-thumb-play" />
                        </span>
                        <span className="home-rec-text">
                          <strong>{session.name}</strong>
                          <span>
                            {new Date(session.scheduledAt).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })}
                            {" · "}
                            {groupName(session.groupId)}
                            {session.memberCount != null &&
                              ` · ${session.memberCount} ${session.memberCount === 1 ? "device" : "devices"}`}
                          </span>
                        </span>
                        {session.totalRecordings != null && (
                          <span className="home-rec-count">
                            {session.totalRecordings} {session.totalRecordings === 1 ? "video" : "videos"}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
            )}
          </div>
        </section>

        <section className="home-column">
          <div className="home-section-row">
            <h2 className="home-section">Notifications</h2>
            {notifications?.length > 0 && (
              <button type="button" className="home-view-all" onClick={() => navigate("/notifications")}>
                View all
              </button>
            )}
          </div>
          <div className="home-panel home-panel-fill">
            {notifications === null ? (
              <p className="home-empty">Loading…</p>
            ) : notifications.length === 0 ? (
              <p className="home-empty">
                Nothing new yet. Comments, people joining and practices starting
                in your groups show up here.
              </p>
            ) : (
              <NotificationList notifications={notifications} />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

const css = `
  .home-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: 32px;
    max-width: 1200px;
  }
  .home-top { display: flex; flex-direction: column; gap: 28px; min-width: 0; }
  .home-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 16px;
  }
  .home-date { color: #d0d0d0; font-size: 1rem; margin-bottom: 4px; }
  .home-title { margin: 0; font-size: 2.1rem; font-weight: 800; letter-spacing: -0.5px; }
  .home-actions { display: flex; gap: 12px; }
  .home-action {
    font: inherit;
    font-weight: 700;
    padding: 0.75rem 1.4rem;
    border: none;
    border-radius: 12px;
    background: var(--accent);
    color: var(--accent-ink);
    cursor: pointer;
    transition: background 0.12s;
  }
  .home-action:hover { background: var(--accent-hover); }

  .home-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .home-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 24px 12px;
    background: #161616;
    border-radius: 16px;
  }
  .home-stat span { color: #a0a0a0; font-size: 1rem; }
  .home-stat strong { font-size: 2.4rem; font-weight: 800; line-height: 1; }

  /* The live card keeps its own height and lines up with the bottom of the
     stats, rather than stretching up beside the greeting. */
  .home-live { display: flex; flex-direction: column; justify-content: flex-end; min-width: 0; }
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
  .dot { width: 9px; height: 9px; padding: 0; border: none; border-radius: 50%; background: #3a3a3a; cursor: pointer; }
  .dot-active { background: var(--accent); }
  .home-live-card {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 16px;
    padding: 20px 22px;
    background: var(--accent);
    border-radius: 18px;
    color: var(--accent-ink);
  }
  .home-live-empty { display: flex; align-items: center; justify-content: center; }
  .home-live-tag { display: flex; align-items: center; gap: 7px; font-size: 0.9rem; font-weight: 600; }
  .home-live-dot { width: 9px; height: 9px; border-radius: 50%; background: #f0432e; }
  .home-live-card h3 { margin: 8px 0 4px; font-size: 1.6rem; font-weight: 800; }
  .home-live-card p { margin: 0; color: rgba(0,0,0,0.6); }
  .home-join {
    width: 100%;
    font: inherit;
    font-weight: 700;
    font-size: 1rem;
    padding: 0.8rem;
    border: none;
    border-radius: 10px;
    background: #000;
    color: #fff;
    cursor: pointer;
  }
  .home-join:disabled { cursor: default; opacity: 0.6; }
  .home-end-row { display: flex; justify-content: center; gap: 18px; margin-top: 10px; }
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

  /* Recent recordings and notifications share a row and a height. */
  .home-column { display: flex; flex-direction: column; min-width: 0; }
  .home-section-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .home-section { margin: 0; color: var(--accent); font-size: 1.15rem; font-weight: 700; }
  .home-view-all {
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
  }
  .home-view-all:hover { text-decoration: underline; }
  .home-panel { padding: 16px 18px; background: #161616; border-radius: 16px; }
  .home-panel-fill { flex: 1; display: flex; flex-direction: column; min-height: 260px; }
  /* The panel is already the box; a dashed border inside it reads as two. */
  .home-panel .empty-state { margin: auto 0; border: none; }
  .home-recordings { margin: 0; padding: 0; list-style: none; }
  .home-recordings li + li { border-top: 1px solid #242424; }
  .home-recordings button {
    display: grid;
    grid-template-columns: 76px minmax(0, 1fr) auto;
    align-items: center;
    gap: 16px;
    width: 100%;
    padding: 10px 6px;
    border: none;
    border-radius: 10px;
    background: none;
    color: #f0f0f0;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .home-recordings button:hover { background: #1e1e1e; }
  .home-thumb {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 44px;
    border-radius: 8px;
    background: #0a0b0d;
  }
  .home-thumb-play { width: 18px; height: 18px; border-radius: 50%; background: var(--accent); }
  .home-rec-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .home-rec-text strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .home-rec-text span { color: #8a8a8a; font-size: 0.8rem; }
  .home-rec-count { color: #8a8a8a; font-size: 0.85rem; white-space: nowrap; }
  .home-empty { margin: auto 0; padding: 28px 8px; color: #8a8a8a; line-height: 1.6; text-align: center; }
  .home-error {
    margin: 0;
    padding: 10px 14px;
    border: 1px solid #5a2a2a;
    border-radius: 8px;
    background: #2a1a1a;
    color: #ff8a80;
  }

  @media (max-width: 1080px) {
    .home-grid { grid-template-columns: 1fr; }
  }
`;
