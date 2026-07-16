import { useState } from "react";

import { useAuth } from "../../auth/AuthContext.jsx";
import { Sidebar } from "../../components/dashboard/Sidebar.jsx";
import { TopBar } from "../../components/dashboard/TopBar.jsx";
import { GroupsPage } from "./GroupsPage.jsx";
import { HomePage } from "./HomePage.jsx";
import { PlaybackPage } from "./PlaybackPage.jsx";
import { RecordPage } from "./RecordPage.jsx";
import { RecordingsPage } from "./RecordingsPage.jsx";
import { SettingsPage } from "./SettingsPage.jsx";
import "../../styles/dashboard.css";

const DASHBOARD_PAGES = {
  home: { title: "Home", component: HomePage },
  groups: { title: "Groups", component: GroupsPage },
  recordings: { title: "Recordings", component: RecordingsPage },
  playback: { title: "Playback", component: PlaybackPage },
  record: { title: "Record", component: RecordPage },
  settings: { title: "Settings", component: SettingsPage },
};

const DEFAULT_THEME = {
  primary: "#ffc72c",
  secondary: "#11120f",
};

function loadSavedTheme() {
  try {
    const savedTheme = localStorage.getItem("8kount.theme");
    return savedTheme ? { ...DEFAULT_THEME, ...JSON.parse(savedTheme) } : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function Dashboard() {
  const { user } = useAuth();
  const [activePage, setActivePage] = useState("home");
  const [theme, setTheme] = useState(loadSavedTheme);
  const { component: ActivePage, title: pageTitle } = DASHBOARD_PAGES[activePage];
  const userName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.name || "";
  const themeStyles = {
    "--theme-primary": theme.primary,
    "--theme-secondary": theme.secondary,
  };

  const handleThemeSave = (nextTheme) => {
    setTheme(nextTheme);
    localStorage.setItem("8kount.theme", JSON.stringify(nextTheme));
  };

  return (
    <div
      className={`dashboard-shell page-${activePage}`}
      style={themeStyles}
    >
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <div className="dashboard-workspace">
        <TopBar pageTitle={pageTitle} />
        <main className="dashboard-content">
          <ActivePage onSaveTheme={handleThemeSave} theme={theme} userName={userName} />
        </main>
      </div>
    </div>
  );
}
