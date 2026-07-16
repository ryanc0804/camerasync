export function TopBar({ pageTitle }) {
  return (
    <header className="dashboard-topbar">
      <h1>
        8Kount Dashboard <span>- {pageTitle}</span>
      </h1>
    </header>
  );
}
