export function TopBar({ pageTitle }) {
  return (
    <header className="dashboard-topbar">
      <h1>
        KnightHyve Dashboard <span>- {pageTitle}</span>
      </h1>
    </header>
  );
}
