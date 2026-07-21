import { useEffect, useState } from "react";
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

// Connects to the sync hub, joins a demo session, and fires the synchronized
// start/stop commands. Still scaffolding — replace the hardcoded session with
// real session selection once sessions exist in the API.
export function RecordScreen() {
  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState(null);
  const [devices, setDevices] = useState([]);
  const [log, setLog] = useState([]);

  const sessionId = "demo-session";
  const addLog = (msg) =>
    setLog((l) => [`${new Date().toLocaleTimeString()}  ${msg}`, ...l]);

  useEffect(() => {
    const s = io(SERVER_URL);
    setSocket(s);

    s.on("connect", () => {
      setConnected(true);
      s.emit("session:join", { sessionId, deviceName: "Web admin" });
      addLog("connected + joined demo session");
    });
    s.on("disconnect", () => setConnected(false));
    s.on("session:devices", (list) => setDevices(list));
    s.on("recording:started", ({ startAtEpochMs }) =>
      addLog(
        `recording STARTED, shared start @ ${new Date(startAtEpochMs).toLocaleTimeString()}`
      )
    );
    s.on("recording:stopped", () => addLog("recording STOPPED"));

    return () => s.disconnect();
  }, []);

  return (
    <div>
      <h1 style={styles.title}>Record</h1>
      <p style={styles.muted}>
        Server: <code>{SERVER_URL}</code> —{" "}
        <strong style={{ color: connected ? "#7ddc7d" : "#ff8a80" }}>
          {connected ? "connected" : "disconnected"}
        </strong>
      </p>

      <div style={{ display: "flex", gap: 10, margin: "1.5rem 0" }}>
        <button
          className="kh-btn kh-btn-primary"
          onClick={() => socket?.emit("recording:start", { sessionId })}
        >
          Start recording
        </button>
        <button
          className="kh-btn"
          onClick={() => socket?.emit("recording:stop", { sessionId })}
        >
          Stop recording
        </button>
      </div>

      <h3 style={styles.h3}>Connected devices ({devices.length})</h3>
      {devices.length === 0 ? (
        <p style={styles.muted}>No devices connected yet.</p>
      ) : (
        <ul>
          {devices.map((d) => (
            <li key={d.socketId}>{d.deviceName}</li>
          ))}
        </ul>
      )}

      <h3 style={styles.h3}>Event log</h3>
      <pre style={styles.log}>{log.join("\n")}</pre>

      <style>{css}</style>
    </div>
  );
}

const styles = {
  title: { margin: "0 0 0.5rem", fontSize: "1.8rem" },
  h3: { marginTop: "1.75rem", marginBottom: "0.5rem" },
  muted: { color: "#999" },
  log: {
    background: "#1e1e1e",
    border: "1px solid #2a2a2a",
    padding: 12,
    borderRadius: 8,
    maxHeight: 240,
    overflow: "auto",
    fontSize: "0.85rem",
  },
};

const css = `
  .kh-btn {
    font: inherit;
    font-weight: 600;
    padding: 0.6rem 1rem;
    border-radius: 8px;
    border: 1px solid #3a3a3a;
    background: #262626;
    color: #f0f0f0;
    cursor: pointer;
  }
  .kh-btn:hover { background: #303030; }
  .kh-btn-primary {
    background: #ffc72c;
    color: #0d0d0d;
    border-color: #ffc72c;
  }
  .kh-btn-primary:hover { background: #ffd75e; }
`;
