import { useEffect, useState } from "react";
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

// Minimal smoke-test UI: connects to the server, joins a demo session, and
// lets you fire the synchronized start/stop commands. This is scaffolding to
// prove the socket contract end to end — replace with the real admin UI.
export function App() {
  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState(null);
  const [devices, setDevices] = useState([]);
  const [log, setLog] = useState([]);

  const sessionId = "demo-session";
  const addLog = (msg) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${msg}`, ...l]);

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
      addLog(`recording STARTED, shared start @ ${new Date(startAtEpochMs).toLocaleTimeString()}`)
    );
    s.on("recording:stopped", () => addLog("recording STOPPED"));

    return () => s.disconnect();
  }, []);

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 640, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Camera Sync</h1>
      <p>
        Server: <code>{SERVER_URL}</code> —{" "}
        <strong style={{ color: connected ? "green" : "crimson" }}>
          {connected ? "connected" : "disconnected"}
        </strong>
      </p>

      <div style={{ display: "flex", gap: 8, margin: "1rem 0" }}>
        <button onClick={() => socket?.emit("recording:start", { sessionId })}>
          Start recording
        </button>
        <button onClick={() => socket?.emit("recording:stop", { sessionId })}>
          Stop recording
        </button>
      </div>

      <h3>Connected devices ({devices.length})</h3>
      <ul>
        {devices.map((d) => (
          <li key={d.socketId}>{d.deviceName}</li>
        ))}
      </ul>

      <h3>Event log</h3>
      <pre style={{ background: "#f4f4f4", padding: 12, borderRadius: 6, maxHeight: 240, overflow: "auto" }}>
        {log.join("\n")}
      </pre>
    </main>
  );
}
