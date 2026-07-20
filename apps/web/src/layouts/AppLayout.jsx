import { Outlet } from "react-router-dom";

import { Sidebar, SIDEBAR_WIDTH } from "../components/Sidebar.jsx";

/// Shell for the signed-in app: fixed yellow sidebar + scrolling content.
export function AppLayout() {
  return (
    <div style={styles.shell}>
      <Sidebar />
      <main style={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}

const styles = {
  shell: {
    minHeight: "100vh",
    background: "#141414",
    color: "#f0f0f0",
    fontFamily: "system-ui, sans-serif",
  },
  content: {
    marginLeft: SIDEBAR_WIDTH,
    padding: "2rem",
    minHeight: "100vh",
    boxSizing: "border-box",
  },
};
