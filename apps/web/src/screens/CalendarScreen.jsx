import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useNewSession } from "../components/NewSession.jsx";

import { getGroups } from "../api/groups.js";
import { getSessions, joinSession } from "../api/recordings.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";
import { groupAccent, groupTile } from "../theme/groupTheme.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// gives each date a simple lookup key
function dateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

// Over: finished, or its hour has passed. Faded on the calendar so the
// color lands on what's ahead.
function isPast(session, now = Date.now()) {
  if (session.status === "active") return false;
  if (session.status === "complete") return true;
  return new Date(session.scheduledAt).getTime() + 60 * 60 * 1000 < now;
}

// A past session: the group's color as text and a thin outline, no fill.
// Still readable, but the solid blocks are what's ahead.
function pastStyle(group) {
  const color = groupAccent(group);
  return { color, background: "transparent", boxShadow: `inset 0 0 0 1px ${color}88` };
}

// The ?day= value back into a date, or null.
function parseDayKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

/// Builds the 6x7 grid for a month, padded with the neighbouring months' days
/// so every month renders at the same height and the columns stay aligned.
function buildMonthGrid(year, month) {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysThisMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < 42; i++) {
    // Day 1 of the month lands at index `firstWeekday`; everything else is an
    // offset from there, and the Date constructor rolls over month boundaries.
    const date = new Date(year, month, i - firstWeekday + 1);
    cells.push({
      date,
      inMonth: date.getMonth() === month && date.getFullYear() === year,
    });
  }
  return { cells, daysThisMonth };
}

export function CalendarScreen() {
  const openNewSession = useNewSession();
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const navigate = useNavigate();
  // A day opens on its own page, like Google Calendar; ?day= keeps it in the
  // address, so the browser's back button returns to the month.
  const [params, setParams] = useSearchParams();
  const openDay = parseDayKey(params.get("day"));
  const showDay = (date) => setParams(date ? { day: dateKey(date) } : {});
  const [opening, setOpening] = useState(null);
  const [groups, setGroups] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const { cells } = useMemo(() => buildMonthGrid(year, month), [year, month]);

  // loads visible sessions and their group colors
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

  // New and cancelled sessions show up without a reload.
  useAutoRefresh(() => {
    getSessions()
      .then((loaded) => setSessions(loaded.filter((session) => session.status !== "cancelled")))
      .catch(() => {});
  }, 30000);

  const groupsById = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups]
  );

  // groups sessions by date and sorts each day by time
  const sessionsByDate = useMemo(() => {
    const grouped = new Map();

    sessions.forEach((session) => {
      const key = dateKey(new Date(session.scheduledAt));
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(session);
    });

    grouped.forEach((daySessions) =>
      daySessions.sort(
        (left, right) =>
          new Date(left.scheduledAt) - new Date(right.scheduledAt)
      )
    );

    return grouped;
  }, [sessions]);

  const daySessions = openDay ? sessionsByDate.get(dateKey(openDay)) || [] : [];

  // Into the session: its takes once it's over, otherwise join it (the
  // server says if a scheduled one isn't open yet).
  const goTo = async (session) => {
    if (session.status === "complete") {
      navigate(`/watch/${session.id}`);
      return;
    }
    setError("");
    setOpening(session.id);
    try {
      const joined = await joinSession(session.id);
      navigate(`/record/${joined.id}`);
    } catch (err) {
      setError(err.message);
      setOpening(null);
    }
  };

  const monthLabel = cursor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const step = (delta) => setCursor(new Date(year, month + delta, 1));
  const goToday = () => {
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
    if (openDay) showDay(today);
  };

  if (openDay) {
    const stepDay = (delta) => showDay(
      new Date(openDay.getFullYear(), openDay.getMonth(), openDay.getDate() + delta));
    return (
      <div className="calendar-content">
        <style>{css}</style>
        <div className="cal-day-page-header">
          <button type="button" className="cal-nav" aria-label="Back to the month"
            title="Back to the month"
            onClick={() => {
              setCursor(new Date(openDay.getFullYear(), openDay.getMonth(), 1));
              showDay(null);
            }}>‹</button>
          <div>
            <span>{openDay.toLocaleDateString(undefined, { weekday: "long" })}
              {isSameDay(openDay, today) && " · Today"}</span>
            <h1>{openDay.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</h1>
          </div>
          <div className="cal-day-page-steps">
            <button type="button" className="cal-nav" aria-label="Previous day"
              onClick={() => stepDay(-1)}>‹</button>
            <button type="button" className="cal-nav" aria-label="Next day"
              onClick={() => stepDay(1)}>›</button>
          </div>
        </div>

        {error && <p className="cal-error">{error}</p>}

        {loading ? (
          <p className="cal-day-page-note">Loading sessions...</p>
        ) : (
          <DayTimeline day={openDay} sessions={daySessions} groupsById={groupsById}
            opening={opening} onOpen={goTo} isToday={isSameDay(openDay, today)} />
        )}
        {!loading && daySessions.length === 0 && (
          <p className="cal-day-page-note">
            Nothing this day.{" "}
            <button type="button" className="cal-link" onClick={() => openNewSession("schedule")}>
              Schedule a session
            </button>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="calendar-content">
      <style>{css}</style>

      <h1 style={styles.title}>Calendar</h1>
      <div style={styles.header}>
        <div style={styles.controls}>
          <span style={styles.monthLabel}>{monthLabel}</span>
          <button className="cal-nav" onClick={() => step(-1)} aria-label="Previous month">
            ‹
          </button>
          <button className="cal-nav" onClick={() => step(1)} aria-label="Next month">
            ›
          </button>
        </div>
        <button className="cal-today" onClick={goToday}>
          Today
        </button>
      </div>

      {error && <p className="cal-error">{error}</p>}

      <div style={styles.weekdayRow}>
        {WEEKDAYS.map((d) => (
          <div key={d} style={styles.weekday}>
            {d}
          </div>
        ))}
      </div>

      <div style={styles.grid}>

        {cells.map(({ date, inMonth }) => {
          const isToday = isSameDay(date, today);
          const cellSessions = sessionsByDate.get(dateKey(date)) || [];
          const classes = [
            "cal-day",
            !inMonth && "cal-day-muted",
            isToday && "cal-day-today",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            // The whole cell opens the day; a session in it opens that
            // session.
            <div
              key={date.toISOString()}
              className={classes}
              role="button"
              tabIndex={0}
              aria-label={date.toLocaleDateString(undefined,
                { weekday: "long", month: "long", day: "numeric" })}
              onClick={() => showDay(date)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  showDay(date);
                }
              }}
              aria-current={isToday ? "date" : undefined}
            >
              <span className="cal-day-number">{date.getDate()}</span>
              <span className="cal-day-events">
                {cellSessions.slice(0, 2).map((session) => {
                  // Solid in the group's color, like the phone's calendar;
                  // past ones outlined instead (see pastStyle).
                  const group = groupsById.get(session.groupId);
                  const tile = groupTile(group);
                  return (
                    <button
                      type="button"
                      className="cal-day-event"
                      style={isPast(session) ? pastStyle(group) : {
                        color: tile?.ink ?? "#000000",
                        background: tile?.fill ?? "#ead217",
                      }}
                      key={session.id}
                      title={session.name}
                      disabled={opening !== null}
                      onClick={(event) => {
                        event.stopPropagation();
                        goTo(session);
                      }}
                    >
                      {session.status === "active" && "● "}{session.name}
                    </button>
                  );
                })}
                {cellSessions.length > 2 && (
                  <span className="cal-day-more">
                    +{cellSessions.length - 2} more
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>

    </div>
  );
}

// Sessions have a start but no set end; each fills an hour.
const SESSION_MINUTES = 60;
const HOUR_HEIGHT = 64;

/// Side-by-side columns for sessions that overlap, like Google Calendar:
/// each gets a column, and every session in an overlapping run splits the
/// width between that run's columns.
function layoutDay(sessions) {
  const items = sessions
    .map((session) => {
      const at = new Date(session.scheduledAt);
      const start = at.getHours() * 60 + at.getMinutes();
      return { session, start, end: start + SESSION_MINUTES };
    })
    .sort((a, b) => a.start - b.start);
  let run = [];
  let runEnd = -1;
  const finish = () => {
    const columns = Math.max(1, ...run.map((item) => item.column + 1));
    run.forEach((item) => { item.columns = columns; });
    run = [];
  };
  for (const item of items) {
    if (item.start >= runEnd) {
      finish();
      runEnd = -1;
    }
    const taken = new Set(run.filter((other) => other.end > item.start).map((other) => other.column));
    let column = 0;
    while (taken.has(column)) column += 1;
    item.column = column;
    run.push(item);
    runEnd = Math.max(runEnd, item.end);
  }
  finish();
  return items;
}

/// One day as hours down the page with each session as a block at its
/// time, in its group's color.
function DayTimeline({ day, sessions, groupsById, opening, onOpen, isToday }) {
  const scrollRef = useRef(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const items = layoutDay(sessions);
  const firstStart = items[0]?.start;
  const dayKey = dateKey(day);

  // Opens on the first session (or now, or 8 AM), a little above it.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const minutes = firstStart ?? (isToday ? new Date().getHours() * 60 : 8 * 60);
    element.scrollTop = Math.max(0, (minutes / 60 - 1) * HOUR_HEIGHT);
    // Only when the day changes, not on every refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey]);

  const hourLabel = (hour) => new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: "numeric" });
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return (
    <div className="cal-timeline" ref={scrollRef}>
      <div className="cal-timeline-day" style={{ height: 24 * HOUR_HEIGHT }}>
        {Array.from({ length: 24 }, (_, hour) => (
          <div key={hour} className="cal-timeline-hour" style={{ top: hour * HOUR_HEIGHT }}>
            {hour > 0 && <span>{hourLabel(hour)}</span>}
          </div>
        ))}
        <div className="cal-timeline-events">
          {items.map(({ session, start, column, columns }) => {
            const tile = groupTile(groupsById.get(session.groupId));
            const group = groupsById.get(session.groupId);
            const time = new Date(session.scheduledAt).toLocaleTimeString(undefined,
              { hour: "numeric", minute: "2-digit" });
            const status = { active: "Live now", complete: "Watch recordings" }[session.status];
            return (
              <button type="button" key={session.id} className="cal-timeline-event"
                disabled={opening !== null}
                title={`${session.name} · ${time}`}
                style={{
                  top: (start / 60) * HOUR_HEIGHT + 1,
                  height: (SESSION_MINUTES / 60) * HOUR_HEIGHT - 3,
                  left: `calc(${(column / columns) * 100}% + 2px)`,
                  width: `calc(${100 / columns}% - 4px)`,
                  ...(isPast(session) ? pastStyle(group) : {
                    background: tile?.fill ?? "#ead217",
                    color: tile?.ink ?? "#000000",
                  }),
                }}
                onClick={() => onOpen(session)}>
                <strong>{session.status === "active" && "● "}{session.name}</strong>
                <span>
                  {opening === session.id ? "Opening..." : [time,
                    session.groupId == null ? "No group" : group?.name, status]
                    .filter(Boolean).join(" · ")}
                </span>
              </button>
            );
          })}
          {isToday && (
            <div className="cal-timeline-now" style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}
              aria-hidden="true" />
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  header: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
    margin: "0.4rem 0 1.5rem",
  },
  title: {
    margin: 0,
    fontSize: "2.2rem",
    fontWeight: 800,
    letterSpacing: "-0.5px",
  },
  controls: { display: "flex", alignItems: "center", gap: 12 },
  monthLabel: {
    fontWeight: 600,
    fontSize: "1.45rem",
    marginRight: 12,
  },
  weekdayRow: {
    display: "grid",
    gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
    width: "100%",
  },
  weekday: {
    fontSize: "0.75rem",
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#8a8a8a",
    padding: "0 0 10px 10px",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
    // Open on the page like the day view: thin lines between the days,
    // no box around them, as wide as the window.
    gap: 1,
    width: "100%",
    background: "#222",
    borderTop: "1px solid #222",
    borderBottom: "1px solid #222",
  },
};

const css = `
  /* Wide, but not edge to edge on a big screen; centered either way. */
  .calendar-content {
    width: 100%;
    max-width: 1480px;
    margin: 0 auto;
  }
  .cal-nav {
    width: 38px;
    height: 38px;
    font-size: 1.15rem;
    line-height: 1;
    font-weight: 600;
    border-radius: 50%;
    border: none;
    background: #1c1c1c;
    color: #f0f0f0;
    cursor: pointer;
  }
  .cal-nav:hover { background: #2a2a2a; }
  .cal-today {
    font: inherit;
    font-weight: 700;
    padding: 0.6rem 1.4rem;
    border: none;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-ink);
    cursor: pointer;
  }
  .cal-today:hover { background: var(--accent-hover); }

  .cal-day {
    font: inherit;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    gap: 8px;
    min-width: 0;
    height: max(96px, calc((100vh - 14rem) / 6));
    overflow: hidden;
    box-sizing: border-box;
    padding: 10px;
    border: none;
    background: #000;
    color: #e8e8e8;
    cursor: pointer;
    transition: background 0.12s;
  }
  .cal-day-number {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    height: 28px;
    border-radius: 50%;
    line-height: 1;
    font-size: 0.95rem;
  }
  .cal-day-events {
    display: flex;
    width: 100%;
    min-width: 0;
    flex-direction: column;
    gap: 4px;
  }
  .cal-day-event {
    box-sizing: border-box;
    width: 100%;
    overflow: hidden;
    padding: 4px 7px;
    border-radius: 5px;
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.25;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cal-day-more {
    width: 100%;
    overflow: hidden;
    padding-left: 7px;
    color: #777;
    font-size: 0.72rem;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cal-day:hover { background: #111; }
  .cal-day-muted { color: #4a4a4a; }
  /* Today is just its number in the accent color, no circle. */
  .cal-day-today .cal-day-number {
    color: var(--accent);
    font-weight: 800;
  }
  .cal-error {
    margin: 0 0 12px;
    color: #ff8a80;
  }
  .cal-day-event {
    border: none;
    font-family: inherit;
    cursor: pointer;
  }
  .cal-day-event:hover { filter: brightness(1.25); }
  .cal-day-page-header {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 1rem;
  }
  .cal-day-page-header > div:nth-child(2) { flex: 1; min-width: 0; }
  .cal-day-page-header span { color: #999; font-size: 0.9rem; }
  .cal-day-page-header h1 { margin: 2px 0 0; font-size: 1.9rem; font-weight: 800; }
  .cal-day-page-steps { display: flex; gap: 10px; }
  .cal-day-page-note { color: #999; }
  .cal-link {
    padding: 0; border: none; background: none; color: var(--accent);
    font: inherit; text-decoration: underline; cursor: pointer;
  }
  /* Open on the page, not in a box: hour lines run to the edge and the
     day fills the window below the header. */
  .cal-timeline {
    height: calc(100vh - 10rem);
    min-height: 320px;
    overflow-y: auto;
  }
  .cal-timeline-day { position: relative; }
  .cal-timeline-hour {
    position: absolute; left: 0; right: 0;
    border-top: 1px solid #222;
  }
  .cal-timeline-hour:first-child { border-top: none; }
  .cal-timeline-hour span {
    position: absolute; top: -0.6em; left: 0; width: 58px; padding-right: 8px;
    box-sizing: border-box; text-align: right;
    background: #000; color: #888; font-size: 0.72rem;
  }
  .cal-timeline-events { position: absolute; top: 0; bottom: 0; left: 64px; right: 0; }
  .cal-timeline-event {
    position: absolute;
    display: flex; flex-direction: column; justify-content: flex-start; gap: 2px;
    box-sizing: border-box; padding: 5px 8px; overflow: hidden;
    border: none; border-radius: 6px;
    font: inherit; text-align: left; cursor: pointer;
  }
  .cal-timeline-event:hover:not(:disabled) { filter: brightness(1.12); }
  .cal-timeline-event strong, .cal-timeline-event span {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cal-timeline-event strong { font-size: 0.88rem; }
  .cal-timeline-event span { font-size: 0.76rem; opacity: 0.85; }
  .cal-timeline-now {
    position: absolute; left: -6px; right: 0; height: 2px; background: #ff5a4f;
    pointer-events: none;
  }
  .cal-timeline-now::before {
    content: ""; position: absolute; left: -5px; top: -4px;
    width: 10px; height: 10px; border-radius: 50%; background: #ff5a4f;
  }
  @media (max-width: 650px) {
    .cal-day {
      gap: 3px;
      padding: 5px;
    }
    .cal-day-event {
      font-size: 0;
    }
    .cal-day-event::before {
      content: "•";
      font-size: 0.9rem;
    }
  }
`;
