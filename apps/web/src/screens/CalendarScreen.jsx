import { useEffect, useMemo, useState } from "react";

import { getGroups } from "../api/groups.js";
import { getSessions } from "../api/recordings.js";

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
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [selected, setSelected] = useState(null);
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

  const selectedSessions = selected
    ? sessionsByDate.get(dateKey(selected)) || []
    : [];

  const monthLabel = cursor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const step = (delta) => setCursor(new Date(year, month + delta, 1));
  const goToday = () => {
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelected(today);
  };

  return (
    <div className="calendar-content">
      <style>{css}</style>

      <div style={styles.header}>
        <h1 style={styles.title}>Calendar</h1>
        <div style={styles.controls}>
          <button className="cal-nav" onClick={() => step(-1)} aria-label="Previous month">
            ‹
          </button>
          <span style={styles.monthLabel}>{monthLabel}</span>
          <button className="cal-nav" onClick={() => step(1)} aria-label="Next month">
            ›
          </button>
          <button className="cal-today" onClick={goToday}>
            Today
          </button>
        </div>
      </div>

      {error && <p className="cal-error">{error}</p>}

      <div style={styles.grid}>
        {WEEKDAYS.map((d) => (
          <div key={d} style={styles.weekday}>
            {d}
          </div>
        ))}

        {cells.map(({ date, inMonth }) => {
          const isToday = isSameDay(date, today);
          const isSelected = selected && isSameDay(date, selected);
          const daySessions = sessionsByDate.get(dateKey(date)) || [];
          const classes = [
            "cal-day",
            !inMonth && "cal-day-muted",
            isToday && "cal-day-today",
            isSelected && "cal-day-selected",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              key={date.toISOString()}
              className={classes}
              onClick={() => setSelected(date)}
              aria-current={isToday ? "date" : undefined}
            >
              <span className="cal-day-number">{date.getDate()}</span>
              <span className="cal-day-events">
                {daySessions.slice(0, 2).map((session) => {
                  const group = groupsById.get(session.groupId);
                  return (
                    <span
                      className="cal-day-event"
                      style={{ color: group?.primaryColor || "#ffc72c" }}
                      key={session.id}
                    >
                      {session.name} - {group?.name || session.groupId}
                    </span>
                  );
                })}
                {daySessions.length > 2 && (
                  <span className="cal-day-more">
                    +{daySessions.length - 2} more
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {selected && (
        <section className="cal-agenda">
          <h2>
            {selected.toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </h2>

          {loading ? (
            <p>Loading sessions...</p>
          ) : selectedSessions.length === 0 ? (
            <p>No scheduled sessions.</p>
          ) : (
            <div className="cal-agenda-list">
              {selectedSessions.map((session) => {
                const group = groupsById.get(session.groupId);
                return (
                  <div className="cal-agenda-item" key={session.id}>
                    <time>
                      {new Date(session.scheduledAt).toLocaleTimeString(
                        undefined,
                        {
                          hour: "numeric",
                          minute: "2-digit",
                        }
                      )}
                    </time>
                    <span
                      style={{ color: group?.primaryColor || "#ffc72c" }}
                    >
                      {session.name} - {group?.name || session.groupId}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
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
    marginBottom: "1.25rem",
  },
  title: { margin: 0, fontSize: "1.8rem" },
  controls: { display: "flex", alignItems: "center", gap: 10 },
  monthLabel: {
    minWidth: "11ch",
    textAlign: "center",
    fontWeight: 700,
    fontSize: "1.05rem",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
    gap: 6,
    width: "100%",
    maxWidth: 940,
  },
  weekday: {
    textAlign: "center",
    fontSize: "0.75rem",
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "#8a8a8a",
    padding: "0 0 6px",
  },
};

const css = `
  .calendar-content {
    width: min(100%, 940px);
  }
  .cal-nav, .cal-today {
    font: inherit;
    font-weight: 600;
    border-radius: 8px;
    border: 1px solid #3a3a3a;
    background: #262626;
    color: #f0f0f0;
    cursor: pointer;
    padding: 0.35rem 0.7rem;
  }
  .cal-nav { font-size: 1.2rem; line-height: 1; padding: 0.2rem 0.7rem; }
  .cal-nav:hover, .cal-today:hover { background: #333; }

  .cal-day {
    font: inherit;
    aspect-ratio: 1 / 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    gap: 7px;
    min-width: 0;
    padding: 8px;
    border-radius: 8px;
    border: 1px solid #2a2a2a;
    background: #1c1c1c;
    color: #e8e8e8;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
  }
  .cal-day-number {
    align-self: flex-end;
    line-height: 1;
  }
  .cal-day-events {
    display: flex;
    width: 100%;
    min-width: 0;
    flex-direction: column;
    gap: 4px;
  }
  .cal-day-event,
  .cal-day-more {
    width: 100%;
    overflow: hidden;
    font-size: 0.68rem;
    font-weight: 600;
    line-height: 1.2;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cal-day-more {
    color: #777;
    font-weight: 400;
  }
  .cal-day:hover { background: #262626; }
  .cal-day-muted { color: #5a5a5a; background: #161616; }
  .cal-day-today {
    border-color: #ffc72c;
    color: #ffc72c;
    font-weight: 700;
  }
  .cal-day-selected {
    background: #2a2a2a;
    border-color: #ffc72c;
    color: #ffc72c;
    font-weight: 700;
  }
  .cal-error {
    margin: 0 0 12px;
    color: #ff8a80;
  }
  .cal-agenda {
    max-width: 940px;
    margin-top: 20px;
    padding: 18px;
    border: 1px solid #2a2a2a;
    border-radius: 9px;
    background: #1c1c1c;
  }
  .cal-agenda h2 {
    margin: 0 0 12px;
    font-size: 1.05rem;
  }
  .cal-agenda p {
    margin: 0;
    color: #999;
  }
  .cal-agenda-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .cal-agenda-item {
    display: grid;
    grid-template-columns: 95px minmax(0, 1fr);
    gap: 12px;
    align-items: baseline;
    padding-top: 8px;
    border-top: 1px solid #2f2f2f;
  }
  .cal-agenda-item:first-child {
    padding-top: 0;
    border-top: 0;
  }
  .cal-agenda-item time {
    color: #aaa;
    font-size: 0.85rem;
  }
  .cal-agenda-item span {
    font-weight: 600;
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
