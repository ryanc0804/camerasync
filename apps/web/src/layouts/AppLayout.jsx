import { Outlet, useLocation } from "react-router-dom";

import { NewSessionProvider } from "../components/NewSession.jsx";
import { Sidebar, SIDEBAR_WIDTH } from "../components/Sidebar.jsx";
import { GroupThemeProvider } from "../theme/GroupThemeContext.jsx";

/// Shell for the signed-in app: fixed sidebar in the default group's color
/// (8kount yellow without one) + scrolling content. A live session takes
/// the whole window, like the phone's camera: no sidebar to wander off
/// through, only its own way out (leave, or end it for everyone).
export function AppLayout() {
  const inSession = useLocation().pathname.startsWith("/record/");
  return (
    <GroupThemeProvider>
      <NewSessionProvider>
        <div style={styles.shell}>
          {!inSession && <Sidebar />}
          <main style={inSession ? { ...styles.content, marginLeft: 0 } : styles.content}>
            <Outlet />
          </main>
        </div>
      </NewSessionProvider>
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
