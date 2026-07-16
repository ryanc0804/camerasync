export function HomePage({ userName }) {
  const currentDate = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date());

  return (
    <div className="page-stack">
      <section className="home-welcome">
        <div>
          <span className="home-date">{currentDate}</span>
          <h2>Welcome, {userName || "fName lName"}</h2>
        </div>
      </section>

      <section className="home-summary-grid" aria-label="Workspace totals">
        <article className="panel home-summary-card">
          <h3>Groups</h3>
          <strong>0</strong>
        </article>
        <article className="panel home-summary-card">
          <h3>Sessions</h3>
          <strong>0</strong>
        </article>
        <article className="panel home-summary-card">
          <h3>Videos</h3>
          <strong>0</strong>
        </article>
      </section>

      <section className="home-grid">
        <div className="panel recent-panel">
          <div className="panel-heading">
            <div><h3>Recent Recordings</h3></div>
          </div>
          <div className="plain-empty-state">No Recordings Yet</div>
        </div>
      </section>
    </div>
  );
}
