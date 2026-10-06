import { Outlet } from "react-router-dom";

import { Sidebar, SIDEBAR_WIDTH } from "../components/Sidebar.jsx";
import { GroupThemeProvider } from "../theme/GroupThemeContext.jsx";

/// Shell for the signed-in app: fixed sidebar in the default group's color
/// (8kount yellow without one) + scrolling content.
export function AppLayout() {
  return (
    <GroupThemeProvider>
      <div style={styles.shell}>
        <Sidebar />
        <main style={styles.content}>
          <Outlet />
        </main>
      </div>
    </GroupThemeProvider>
  );
}

const styles = {
  shell: {
    minHeight: "100vh",
    background: "#000",
    color: "#f0f0f0",
    fontFamily: "system-ui, sans-serif",
  },
  content: {
    marginLeft: SIDEBAR_WIDTH,
    padding: "2.25rem 2.75rem",
    minHeight: "100vh",
    boxSizing: "border-box",
  },
};
