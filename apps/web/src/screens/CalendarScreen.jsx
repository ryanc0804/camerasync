import { useMemo, useState } from "react";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
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

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const { cells } = useMemo(() => buildMonthGrid(year, month), [year, month]);

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
    <div>
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

      <div style={styles.grid}>
        {WEEKDAYS.map((d) => (
          <div key={d} style={styles.weekday}>
            {d}
          </div>
        ))}

        {cells.map(({ date, inMonth }) => {
          const isToday = isSameDay(date, today);
          const isSelected = selected && isSameDay(date, selected);
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
              {date.getDate()}
            </button>
          );
        })}
      </div>

      {selected && (
        <p style={styles.selectedNote}>
          {selected.toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}{" "}
          — no sessions scheduled.
        </p>
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
    maxWidth: 780,
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
  selectedNote: { color: "#999", marginTop: "1.25rem" },
};

const css = `
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
    align-items: flex-start;
    justify-content: flex-end;
    padding: 8px;
    border-radius: 8px;
    border: 1px solid #2a2a2a;
    background: #1c1c1c;
    color: #e8e8e8;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
  }
  .cal-day:hover { background: #262626; }
  .cal-day-muted { color: #5a5a5a; background: #161616; }
  .cal-day-today {
    border-color: #ffc72c;
    color: #ffc72c;
    font-weight: 700;
  }
  .cal-day-selected {
    background: #ffc72c;
    border-color: #ffc72c;
    color: #0d0d0d;
    font-weight: 700;
  }
`;
