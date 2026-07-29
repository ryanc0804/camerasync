import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getGroups } from "../api/groups.js";
import {
  cancelSession,
  createLiveSession,
  endSession,
  getSessions,
  joinSession,
  scheduleSession,
} from "../api/recordings.js";
import { useAuth } from "../auth/AuthContext.jsx";

// keeps live sessions first and future sessions nearest
function sortSessions(sessions, now) {
  return [...sessions].sort((left, right) => {
    const leftIsLive = left.status === "active";
    const rightIsLive = right.status === "active";
    if (leftIsLive !== rightIsLive) {
      return leftIsLive ? -1 : 1;
    }

    const leftTime = new Date(left.scheduledAt).getTime();
    const rightTime = new Date(right.scheduledAt).getTime();
    const leftIsPast = leftTime < now;
    const rightIsPast = rightTime < now;

    if (leftIsPast !== rightIsPast) {
      return leftIsPast ? 1 : -1;
    }

    return leftIsPast ? rightTime - leftTime : leftTime - rightTime;
  });
}

function localDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function SessionScheduler() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [openPanel, setOpenPanel] = useState(null);
  const [groups, setGroups] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [joiningId, setJoiningId] = useState(null);
  const [endingId, setEndingId] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [confirmingEndId, setConfirmingEndId] = useState(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    date: "",
    time: "",
    groupId: "",
  });

  const adminGroups = useMemo(
    () => groups.filter((group) => group.role === "admin"),
    [groups]
  );
  const sortedSessions = useMemo(
    () => sortSessions(sessions, currentTime),
    [sessions, currentTime]
  );
  const today = localDateValue(new Date());

  // loads groups and sessions together
  useEffect(() => {
    Promise.all([getGroups(), getSessions()])
      .then(([loadedGroups, loadedSessions]) => {
        setGroups(loadedGroups);
        setSessions(loadedSessions);

        const firstAdminGroup = loadedGroups.find(
          (group) => group.role === "admin"
        );
        if (firstAdminGroup) {
          setForm((current) => ({
            ...current,
            groupId: firstAdminGroup.id,
          }));
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // refreshes session states every thirty seconds
  useEffect(() => {
    const timer = window.setInterval(async () => {
      setCurrentTime(Date.now());

      try {
        setSessions(await getSessions());
      } catch (err) {
        setError(err.message);
      }
    }, 30 * 1000);

    return () => window.clearInterval(timer);
  }, []);

  // saves a future session
  const submitSession = async (event) => {
    event.preventDefault();
    setError("");

    const scheduledAt = new Date(`${form.date}T${form.time}:00`);
    if (
      Number.isNaN(scheduledAt.getTime()) ||
      scheduledAt.getTime() <= Date.now()
    ) {
      setError("Sessions must be scheduled for a future date and time.");
      return;
    }

    setSubmitting(true);

    try {
      const session = await scheduleSession({
        name: form.name,
        groupId: form.groupId,
        scheduledAt: scheduledAt.toISOString(),
      });

      setSessions((current) => [...current, session]);
      setForm((current) => ({
        ...current,
        name: "",
        date: "",
        time: "",
      }));
      setOpenPanel(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // creates a live session and enters it
  const submitLiveSession = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const session = await createLiveSession({
        name: form.name,
        groupId: form.groupId,
      });

      setSessions((current) => [...current, session]);
      setForm((current) => ({ ...current, name: "" }));
      setOpenPanel(null);
      navigate(`/record/${session.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // keeps cancelled sessions saved in the database
  const cancelScheduledSession = async (id) => {
    setError("");
    setCancellingId(id);

    try {
      const cancelledSession = await cancelSession(id);
      setSessions((current) =>
        current.map((session) =>
          session.id === id ? cancelledSession : session
        )
      );
      setConfirmingId(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setCancellingId(null);
    }
  };

  // joins the selected session and opens its room
  const joinSelectedSession = async (id) => {
    setError("");
    setJoiningId(id);

    try {
      const joinedSession = await joinSession(id);
      setSessions((current) =>
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

  const endLiveSession = async (id) => {
    setError("");
    setEndingId(id);

    try {
      const completedSession = await endSession(id);
      setSessions((current) =>
        current.map((session) =>
          session.id === id ? completedSession : session
        )
      );
      setConfirmingEndId(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setEndingId(null);
    }
  };

  const groupName = (groupId) =>
    groups.find((group) => group.id === groupId)?.name || groupId;

  // opens joining fifteen minutes before the scheduled time
  const canJoin = (session) => {
    if (session.status === "active") return true;
    if (session.status !== "scheduled") return false;

    const scheduledTime = new Date(session.scheduledAt).getTime();
    return (
      currentTime >= scheduledTime - 15 * 60 * 1000 &&
      currentTime <= scheduledTime + 15 * 60 * 1000
    );
  };

  const togglePanel = (panel) => {
    setOpenPanel((current) => (current === panel ? null : panel));
    setError("");
  };

  return (
    <section className="session-scheduler">
      <style>{schedulerCss}</style>

      <div className="session-mode-buttons">
        <button
          className={openPanel === "schedule" ? "is-selected" : ""}
          type="button"
          onClick={() => togglePanel("schedule")}
          aria-expanded={openPanel === "schedule"}
        >
          Schedule Session
        </button>
        <button
          className={openPanel === "create" ? "is-selected" : ""}
          type="button"
          onClick={() => togglePanel("create")}
          aria-expanded={openPanel === "create"}
        >
          Create Session
        </button>
      </div>

      {openPanel === "schedule" && (
        <form className="session-schedule-form" onSubmit={submitSession}>
          <label>
            Name
            <input
              type="text"
              value={form.name}
              placeholder="Session name"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              required
            />
          </label>

          <label>
            Date
            <input
              type="date"
              value={form.date}
              min={today}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  date: event.target.value,
                }))
              }
              required
            />
          </label>

          <label>
            Time
            <input
              type="time"
              value={form.time}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  time: event.target.value,
                }))
              }
              required
            />
          </label>

          <label>
            Group
            <select
              value={form.groupId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  groupId: event.target.value,
                }))
              }
              disabled={adminGroups.length === 0}
              required
            >
              {adminGroups.length === 0 ? (
                <option value="">No admin groups available</option>
              ) : (
                adminGroups.map((group) => (
                  <option value={group.id} key={group.id}>
                    {group.name}
                  </option>
                ))
              )}
            </select>
          </label>

          <div className="session-schedule-actions">
            <button
              type="button"
              onClick={() => setOpenPanel(null)}
            >
              Cancel
            </button>
            <button
              className="session-submit-button"
              type="submit"
              disabled={submitting || adminGroups.length === 0}
            >
              {submitting ? "Scheduling..." : "Schedule"}
            </button>
          </div>
        </form>
      )}

      {openPanel === "create" && (
        <form
          className="session-schedule-form session-create-form"
          onSubmit={submitLiveSession}
        >
          <label>
            Name
            <input
              type="text"
              value={form.name}
              placeholder="Session name"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              required
            />
          </label>

          <label>
            Group
            <select
              value={form.groupId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  groupId: event.target.value,
                }))
              }
              disabled={adminGroups.length === 0}
              required
            >
              {adminGroups.length === 0 ? (
                <option value="">No admin groups available</option>
              ) : (
                adminGroups.map((group) => (
                  <option value={group.id} key={group.id}>
                    {group.name}
                  </option>
                ))
              )}
            </select>
          </label>

          <div className="session-schedule-actions">
            <button type="button" onClick={() => setOpenPanel(null)}>
              Cancel
            </button>
            <button
              className="session-submit-button"
              type="submit"
              disabled={submitting || adminGroups.length === 0}
            >
              {submitting ? "Creating..." : "Create Session"}
            </button>
          </div>
        </form>
      )}

      {error && <p className="session-schedule-error">{error}</p>}

      <div className="scheduled-session-list">
        <h2>Sessions</h2>
        {loading ? (
          <p className="scheduled-session-empty">Loading sessions...</p>
        ) : sessions.length === 0 ? (
          <p className="scheduled-session-empty">No sessions yet.</p>
        ) : (
          sortedSessions.map((session) => (
            <article
              className={`scheduled-session${
                session.status === "cancelled" ? " is-cancelled" : ""
              }${session.status === "active" ? " is-live" : ""}`}
              key={session.id}
            >
              <div className="scheduled-session-row">
                <div className="scheduled-session-name">
                  <strong>{session.name}</strong>
                  <span>{groupName(session.groupId)}</span>
                </div>
                <div className="scheduled-session-details">
                  <span>
                    {new Date(session.scheduledAt).toLocaleString(undefined, {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="scheduled-session-status">
                    {session.status === "active" ? "Live" : session.status}
                  </span>
                  {["active", "scheduled"].includes(session.status) && (
                    <span>
                      {session.activeMemberCount}{" "}
                      {session.status === "active" ? "active" : "joined"}{" "}
                      {session.activeMemberCount === 1 ? "member" : "members"}
                    </span>
                  )}
                  <code>{session.id}</code>
                </div>

                {(session.status === "active" ||
                  (session.status === "scheduled" &&
                    session.createdBy === user?.id) ||
                  session.isJoined ||
                  canJoin(session)) && (
                  <div className="session-card-actions">
                    {session.createdBy === user?.id &&
                      session.status === "scheduled" && (
                        <button
                          className="session-cancel-button"
                          type="button"
                          aria-label={`Cancel ${session.name}`}
                          aria-expanded={confirmingId === session.id}
                          onClick={() =>
                            setConfirmingId((current) =>
                              current === session.id ? null : session.id
                            )
                          }
                        >
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            <path d="M3 3l10 10M13 3L3 13" />
                          </svg>
                        </button>
                      )}

                    {session.isJoined && session.status === "active" ? (
                      <button
                        className="session-live-action is-joined"
                        type="button"
                        onClick={() => navigate(`/record/${session.id}`)}
                      >
                        Enter Session
                      </button>
                    ) : canJoin(session) ? (
                      <button
                        className="session-live-action"
                        type="button"
                        disabled={joiningId === session.id}
                        onClick={() => joinSelectedSession(session.id)}
                      >
                        {joiningId === session.id
                          ? "Joining..."
                          : "Join"}
                      </button>
                    ) : null}

                    {session.createdBy === user?.id &&
                      session.status === "active" && (
                        <button
                          className="session-end-button"
                          type="button"
                          aria-expanded={confirmingEndId === session.id}
                          onClick={() =>
                            setConfirmingEndId((current) =>
                              current === session.id ? null : session.id
                            )
                          }
                        >
                          End Session
                        </button>
                      )}
                  </div>
                )}
              </div>

              {confirmingId === session.id && (
                <div className="session-cancel-confirmation">
                  <span>Do you want to cancel this session?</span>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(null)}
                  >
                    Keep Session
                  </button>
                  <button
                    className="session-confirm-cancel"
                    type="button"
                    disabled={cancellingId === session.id}
                    onClick={() => cancelScheduledSession(session.id)}
                  >
                    {cancellingId === session.id
                      ? "Cancelling..."
                      : "Cancel Session"}
                  </button>
                </div>
              )}

              {confirmingEndId === session.id && (
                <div className="session-cancel-confirmation">
                  <span>Do you want to end this live session?</span>
                  <button
                    type="button"
                    onClick={() => setConfirmingEndId(null)}
                  >
                    Keep Live
                  </button>
                  <button
                    className="session-confirm-cancel"
                    type="button"
                    disabled={endingId === session.id}
                    onClick={() => endLiveSession(session.id)}
                  >
                    {endingId === session.id
                      ? "Ending..."
                      : "End Session"}
                  </button>
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}

const schedulerCss = `
  .session-scheduler {
    width: min(100%, 760px);
    margin-top: 32px;
  }
  .session-mode-buttons button,
  .session-schedule-actions button {
    padding: 10px 14px;
    border: 1px solid #ffc72c;
    border-radius: 7px;
    background: #262626;
    color: #f0f0f0;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .session-mode-buttons {
    display: flex;
    gap: 10px;
  }
  .session-mode-buttons button {
    width: 180px;
  }
  .session-mode-buttons button.is-selected {
    background: #ffc72c;
    color: #0d0d0d;
  }
  .session-schedule-form {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
    margin-top: 14px;
    padding: 18px;
    border: 1px solid #303030;
    border-radius: 9px;
    background: #1e1e1e;
  }
  .session-create-form {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .session-schedule-form label {
    display: flex;
    flex-direction: column;
    gap: 7px;
    color: #ddd;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .session-schedule-form input,
  .session-schedule-form select {
    box-sizing: border-box;
    width: 100%;
    min-height: 40px;
    padding: 9px 10px;
    border: 1px solid #3a3a3a;
    border-radius: 7px;
    background: #262626;
    color: #f0f0f0;
    font: inherit;
  }
  .session-schedule-actions {
    display: flex;
    grid-column: 1 / -1;
    justify-content: flex-end;
    gap: 10px;
  }
  .session-schedule-actions button {
    border-color: #3a3a3a;
  }
  .session-schedule-actions .session-submit-button {
    border-color: #ffc72c;
    background: #ffc72c;
    color: #0d0d0d;
  }
  .session-schedule-actions button:disabled {
    cursor: default;
    opacity: 0.55;
  }
  .session-schedule-error {
    width: min(100%, 760px);
    box-sizing: border-box;
    margin: 12px 0 0;
    padding: 9px 11px;
    border: 1px solid #5a2a2a;
    border-radius: 7px;
    background: #2a1a1a;
    color: #ff8a80;
    font-size: 0.85rem;
  }
  .scheduled-session-list {
    width: min(100%, 760px);
    margin-top: 26px;
  }
  .scheduled-session-list h2 {
    margin: 0 0 12px;
    font-size: 1.15rem;
  }
  .scheduled-session-empty {
    margin: 0;
    padding: 22px 14px;
    border: 1px dashed #3a3a3a;
    border-radius: 8px;
    color: #888;
    text-align: center;
  }
  .scheduled-session {
    margin-top: 9px;
    padding: 12px 14px;
    border: 1px solid #303030;
    border-radius: 8px;
    background: #242424;
  }
  .scheduled-session.is-cancelled {
    opacity: 0.65;
  }
  .scheduled-session.is-live {
    border-color: #4f8f63;
  }
  .scheduled-session-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 18px;
  }
  .session-card-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
  }
  .scheduled-session-name,
  .scheduled-session-details {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .scheduled-session span {
    color: #999;
    font-size: 0.83rem;
  }
  .scheduled-session-details {
    align-items: flex-end;
  }
  .scheduled-session-status {
    text-transform: capitalize;
  }
  .scheduled-session.is-live .scheduled-session-status {
    color: #72d58c;
    font-weight: 700;
  }
  .scheduled-session code {
    color: #ffc72c;
  }
  .session-cancel-button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid #4a4a4a;
    border-radius: 50%;
    background: transparent;
    color: #bbb;
    font: inherit;
    cursor: pointer;
  }
  .session-cancel-button svg {
    display: block;
    width: 14px;
    height: 14px;
  }
  .session-cancel-button path {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }
  .session-cancel-button:hover {
    border-color: #ff8a80;
    color: #ff8a80;
  }
  .session-live-action {
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
  .session-live-action:disabled {
    cursor: default;
    opacity: 0.55;
  }
  .session-live-action.is-joined {
    border-color: #4f8f63;
    background: transparent;
    color: #72d58c;
    opacity: 1;
  }
  .session-end-button {
    padding: 8px 12px;
    border: 1px solid #7a3434;
    border-radius: 7px;
    background: transparent;
    color: #ff8a80;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .session-cancel-confirmation {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 9px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #353535;
  }
  .session-cancel-confirmation button {
    padding: 7px 10px;
    border: 1px solid #444;
    border-radius: 6px;
    background: #292929;
    color: #eee;
    font: inherit;
    cursor: pointer;
  }
  .session-cancel-confirmation .session-confirm-cancel {
    border-color: #7a3434;
    color: #ff8a80;
  }
  .session-cancel-confirmation button:disabled {
    cursor: default;
    opacity: 0.55;
  }
  @media (max-width: 650px) {
    .session-schedule-form {
      grid-template-columns: 1fr;
    }
    .session-mode-buttons button {
      width: auto;
      flex: 1;
    }
    .scheduled-session-row {
      grid-template-columns: 1fr;
    }
    .scheduled-session-details {
      grid-column: 1 / -1;
      align-items: flex-start;
    }
    .session-card-actions {
      grid-column: 1 / -1;
      justify-content: flex-start;
    }
    .session-cancel-confirmation {
      align-items: stretch;
      flex-direction: column;
    }
  }
`;
