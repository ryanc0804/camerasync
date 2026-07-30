import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { io } from "socket.io-client";
import timesyncUrl from "timesync/dist/timesync.min.js?url";

import {
  endSession,
  getSessions,
  leaveSession,
} from "../api/recordings.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { LocalMediaPreview } from "../components/LocalMediaPreview.jsx";
import {
  createLocalRecorder,
  downloadFile,
  recordingBaseName,
} from "../recording/localRecording.js";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
let timesyncPromise = null;

// loads the timesync browser file once
function loadTimesync() {
  if (window.timesync) return Promise.resolve(window.timesync);

  if (!timesyncPromise) {
    timesyncPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = timesyncUrl;
      script.onload = () => {
        if (window.timesync) resolve(window.timesync);
        else reject(new Error("Unable to start timesync."));
      };
      script.onerror = () => reject(new Error("Unable to load timesync."));
      document.head.appendChild(script);
    });
  }

  return timesyncPromise;
}

export function ActiveSessionScreen() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [session, setSession] = useState(null);
  const [mediaReady, setMediaReady] = useState(false);
  const [members, setMembers] = useState([]);
  const [socketStatus, setSocketStatus] = useState("Waiting for media");
  const [syncStatus, setSyncStatus] = useState("Syncing");
  const [syncedTime, setSyncedTime] = useState(Date.now());
  const [clockOffset, setClockOffset] = useState(0);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const [bufferMs, setBufferMs] = useState(50);
  const [recordingStatus, setRecordingStatus] = useState("idle");
  const [recordingMessage, setRecordingMessage] = useState(
    "Waiting for the host to record."
  );
  const socketRef = useRef(null);
  const clockRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recorderRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingInfoRef = useRef(null);

  // checks that this user can enter the live session
  useEffect(() => {
    let cancelled = false;

    getSessions()
      .then((sessions) => {
        const currentSession = sessions.find(
          (item) => item.id === sessionId
        );

        if (!currentSession || currentSession.status !== "active") {
          throw new Error("This session is not live.");
        }
        if (!currentSession.isJoined) {
          throw new Error("Join this session from the Record page first.");
        }

        if (!cancelled) setSession(currentSession);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // connects the socket and clock after media is ready
  useEffect(() => {
    if (!session || !mediaReady) return undefined;

    let socket;
    let clock;
    let timer;
    let cancelled = false;

    // saves the video and its timing file together
    const saveRecording = (recorder, extension) => {
      const info = recordingInfoRef.current;
      if (!info) return;

      const actualStopAtEpochMs = clock?.now() ?? Date.now();
      const video = new Blob(recordingChunksRef.current, {
        type: recorder.mimeType || "video/webm",
      });
      const baseName = recordingBaseName(info);
      const videoFileName = `${baseName}.${extension}`;
      const metadata = {
        ...info,
        actualStopAtEpochMs,
        timesyncOffsetAtStopMs: clock?.offset ?? 0,
        durationMs: info.actualStartAtEpochMs
          ? actualStopAtEpochMs - info.actualStartAtEpochMs
          : 0,
        mimeType: video.type,
        videoFileName,
      };

      downloadFile(video, videoFileName);
      downloadFile(
        new Blob([JSON.stringify(metadata, null, 2)], {
          type: "application/json",
        }),
        `${baseName}.json`
      );

      recorderRef.current = null;
      recordingInfoRef.current = null;
      recordingChunksRef.current = [];
      setRecordingStatus("idle");
      setRecordingMessage(`Saved ${videoFileName}`);
    };

    // waits for the shared server start time
    const beginRecording = (command) => {
      if (recorderRef.current || recordingTimerRef.current) return;

      const receivedAtEpochMs = clock.now();
      recordingInfoRef.current = {
        sessionId,
        sessionName: session.name,
        userId: user.id,
        recordingNumber: command.recordingNumber,
        bufferMs: command.bufferMs,
        serverSentAtEpochMs: command.serverSentAtEpochMs,
        plannedStartAtEpochMs: command.startAtEpochMs,
        startCommandReceivedAtEpochMs: receivedAtEpochMs,
        timesyncOffsetAtCommandMs: clock.offset,
      };

      const delay = Math.max(0, command.startAtEpochMs - receivedAtEpochMs);
      setRecordingStatus("waiting");
      setRecordingMessage(`Recording starts in ${Math.round(delay)} ms`);

      recordingTimerRef.current = window.setTimeout(() => {
        recordingTimerRef.current = null;

        try {
          const { recorder, extension } = createLocalRecorder(
            mediaStreamRef.current
          );
          recordingChunksRef.current = [];
          recorderRef.current = recorder;

          recorder.ondataavailable = (event) => {
            if (event.data.size > 0) recordingChunksRef.current.push(event.data);
          };
          recorder.onstart = () => {
            const actualStartAtEpochMs = clock.now();
            recordingInfoRef.current = {
              ...recordingInfoRef.current,
              actualStartAtEpochMs,
              timesyncOffsetAtStartMs: clock.offset,
              startDifferenceMs:
                actualStartAtEpochMs - command.startAtEpochMs,
            };
            setRecordingStatus("recording");
            setRecordingMessage(
              `Recording ${command.recordingNumber} in progress`
            );
          };
          recorder.onstop = () => saveRecording(recorder, extension);
          recorder.onerror = () => {
            recorderRef.current = null;
            recordingInfoRef.current = null;
            recordingChunksRef.current = [];
            setRecordingStatus("idle");
            setRecordingMessage("Local recording failed.");
          };
          recorder.start(1000);
        } catch (err) {
          recorderRef.current = null;
          recordingInfoRef.current = null;
          setRecordingStatus("idle");
          setError(err.message);
        }
      }, delay);
    };

    // stops this device when the host sends stop
    const finishRecording = (command) => {
      if (recordingTimerRef.current) {
        window.clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      if (recordingInfoRef.current) {
        recordingInfoRef.current = {
          ...recordingInfoRef.current,
          serverStopAtEpochMs: command.stopAtEpochMs,
          stopCommandReceivedAtEpochMs: clock.now(),
          timesyncOffsetAtStopCommandMs: clock.offset,
        };
      }

      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        setRecordingStatus("saving");
        setRecordingMessage("Saving local recording...");
        recorder.stop();
      } else {
        recordingInfoRef.current = null;
        setRecordingStatus("idle");
        setRecordingMessage("Recording stopped before it began.");
      }
    };

    loadTimesync()
      .then((timesync) => {
        if (cancelled) return;

        setSocketStatus("Connecting");
        socket = io(SERVER_URL, { withCredentials: true });
        clock = timesync.create({
          server: `${SERVER_URL}/timesync`,
          interval: 10000,
        });
        socketRef.current = socket;
        clockRef.current = clock;

        timer = window.setInterval(() => {
          setSyncedTime(clock.now());
        }, 100);

        clock.on("change", (offset) => {
          setClockOffset(Math.round(offset));
          setSyncStatus("Synced");
        });
        clock.on("error", () => setSyncStatus("Retrying"));

        socket.on("connect", () => {
          socket.emit("session:join", { sessionId }, (reply) => {
            if (!reply?.ok) {
              setSocketStatus("Disconnected");
              setError(reply?.error || "Unable to join the live session.");
              return;
            }

            setMembers(reply.members);
            setSocketStatus("Connected");
            setRecordingMessage(
              Number(reply.session.createdBy) === Number(user.id)
                ? "Ready to record."
                : "Waiting for the host to record."
            );
            if (reply.recording) beginRecording(reply.recording);
          });
        });

        socket.on("connect_error", (err) => {
          setSocketStatus("Disconnected");
          setError(err.message);
        });
        socket.on("session:members", setMembers);
        socket.on("recording:started", beginRecording);
        socket.on("recording:stopped", finishRecording);
        socket.on("session:close", () => {
          navigate("/record", { replace: true });
        });
      })
      .catch((err) => {
        setSyncStatus("Unavailable");
        setError(err.message);
      });

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      if (recordingTimerRef.current) {
        window.clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      if (
        recorderRef.current &&
        recorderRef.current.state !== "inactive"
      ) {
        recorderRef.current.stop();
      }
      clock?.destroy();
      socket?.emit("session:leave");
      socket?.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
      if (clockRef.current === clock) clockRef.current = null;
    };
  }, [mediaReady, navigate, session, sessionId, user.id]);

  const isCreator =
    session && Number(session.createdBy) === Number(user?.id);

  const handleMediaReady = (stream) => {
    mediaStreamRef.current = stream;
    setMediaReady(true);
  };

  // sends the host recording commands
  const startRecording = () => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setRecordingMessage("Websocket is not connected yet.");
      return;
    }

    setRecordingStatus("requesting");
    setRecordingMessage("Sending the synchronized start...");
    socket.emit(
      "recording:start",
      { sessionId, bufferMs: Number(bufferMs) },
      (reply) => {
        if (!reply?.ok) {
          setRecordingStatus("idle");
          setRecordingMessage(reply?.error || "Unable to start recording.");
        }
      }
    );
  };

  const stopRecording = () => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setRecordingMessage("Websocket is not connected.");
      return;
    }

    setRecordingStatus("stopping");
    setRecordingMessage("Sending the stop command...");
    socket.emit("recording:stop", { sessionId }, (reply) => {
      if (!reply?.ok) {
        setRecordingStatus("recording");
        setRecordingMessage(reply?.error || "Unable to stop recording.");
      }
    });
  };

  const leave = async () => {
    setError("");
    setLeaving(true);

    try {
      await leaveSession(sessionId);
      navigate("/record", { replace: true });
    } catch (err) {
      setError(err.message);
      setLeaving(false);
    }
  };

  const endAndLeave = async () => {
    setError("");
    setLeaving(true);

    try {
      await endSession(sessionId);
      navigate("/record", { replace: true });
    } catch (err) {
      setError(err.message);
      setLeaving(false);
    }
  };

  const declineMedia = async () => {
    setLeaving(true);

    try {
      if (isCreator) await endSession(sessionId);
      else await leaveSession(sessionId);
    } catch {
      // leaving still removes this browser from the live room
    } finally {
      navigate("/record", { replace: true });
    }
  };

  const displayTime = new Date(syncedTime).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });

  return (
    <div className="active-session-page">
      <style>{activeSessionCss}</style>

      <header className="active-session-header">
        <div>
          <span>Live session</span>
          <h1>{session?.name || "Loading session..."}</h1>
          {session && <code>{session.id}</code>}
        </div>

        {session &&
          (isCreator ? (
            confirmingEnd ? (
              <div className="active-session-confirm">
                <span>End this session for everyone?</span>
                <button
                  type="button"
                  onClick={() => setConfirmingEnd(false)}
                  disabled={leaving}
                >
                  Keep Session
                </button>
                <button
                  className="active-session-danger"
                  type="button"
                  onClick={endAndLeave}
                  disabled={leaving}
                >
                  {leaving ? "Ending..." : "Confirm End"}
                </button>
              </div>
            ) : (
              <button
                className="active-session-danger"
                type="button"
                onClick={() => setConfirmingEnd(true)}
              >
                End and Leave
              </button>
            )
          ) : (
            <button type="button" onClick={leave} disabled={leaving}>
              {leaving ? "Leaving..." : "Leave"}
            </button>
          ))}
      </header>

      {error && (
        <div className="active-session-error">
          <p>{error}</p>
          <button type="button" onClick={() => navigate("/record")}>
            Back to Record
          </button>
        </div>
      )}

      {session && (
        <>
          {mediaReady && (
            <section className="session-recording-bar">
              {isCreator && (
                <div className="session-recording-controls">
                  <label>
                    Buffer (ms)
                    <input
                      type="number"
                      min="0"
                      max="60000"
                      step="1"
                      value={bufferMs}
                      onChange={(event) => setBufferMs(event.target.value)}
                      disabled={recordingStatus !== "idle"}
                    />
                  </label>

                  {recordingStatus === "idle" ? (
                    <button
                      className="session-recording-start"
                      type="button"
                      onClick={startRecording}
                      disabled={
                        socketStatus !== "Connected" ||
                        syncStatus !== "Synced"
                      }
                    >
                      Start Recording
                    </button>
                  ) : (
                    <button
                      className="session-recording-stop"
                      type="button"
                      onClick={stopRecording}
                      disabled={
                        recordingStatus === "requesting" ||
                        recordingStatus === "stopping" ||
                        recordingStatus === "saving"
                      }
                    >
                      Stop Recording
                    </button>
                  )}
                </div>
              )}

              <p>
                {recordingStatus === "recording" && (
                  <span className="session-recording-dot" />
                )}
                {recordingMessage}
              </p>
            </section>
          )}

          <div className={mediaReady ? "active-session-content" : ""}>
            <LocalMediaPreview
              disabled={recordingStatus !== "idle"}
              onReady={handleMediaReady}
              onDecline={declineMedia}
            />

            {mediaReady && (
              <section className="active-session-members">
                <h2>In this session</h2>
                {members.length === 0 ? (
                  <p>Waiting for members to connect...</p>
                ) : (
                  <ul>
                    {members.map((member) => (
                      <li key={member.id}>
                        {member.name || member.email}
                        {Number(member.id) === Number(session.createdBy) && (
                          <span>Creator</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        </>
      )}

      {mediaReady && (
        <div className="active-session-clock" aria-label="Synchronized time">
          <time>{displayTime}</time>
          <span>
            timesync {syncStatus.toLowerCase()} · {clockOffset >= 0 ? "+" : ""}
            {clockOffset} ms
          </span>
        </div>
      )}

      <span className="active-session-socket-status">
        Socket.IO: {socketStatus}
      </span>
    </div>
  );
}

const activeSessionCss = `
  .active-session-page {
    min-height: calc(100vh - 4rem);
    margin: -2rem;
    padding: 2.5rem;
    box-sizing: border-box;
    background: #050505;
    color: #f4f4f4;
    position: relative;
  }
  .active-session-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 2rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid #242424;
  }
  .active-session-header span,
  .active-session-socket-status {
    color: #999;
    font-size: 0.82rem;
  }
  .active-session-header h1 {
    margin: 0.35rem 0;
    font-size: 1.8rem;
  }
  .active-session-header code {
    color: #bbb;
  }
  .active-session-page button {
    border: 1px solid #444;
    border-radius: 7px;
    padding: 0.6rem 0.9rem;
    background: #1d1d1d;
    color: #f4f4f4;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .active-session-page button:disabled {
    cursor: default;
    opacity: 0.6;
  }
  .active-session-page .active-session-danger {
    border-color: #7a3030;
    background: #4b1c1c;
  }
  .active-session-confirm {
    display: flex;
    align-items: center;
    gap: 0.7rem;
  }
  .active-session-confirm span {
    color: #ddd;
  }
  .session-recording-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    margin-top: 1.25rem;
    padding: 0.8rem 0;
    border-bottom: 1px solid #242424;
  }
  .session-recording-controls {
    display: flex;
    align-items: flex-end;
    gap: 0.7rem;
  }
  .session-recording-controls label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    color: #999;
    font-size: 0.75rem;
  }
  .session-recording-controls input {
    width: 7rem;
    box-sizing: border-box;
    padding: 0.55rem 0.65rem;
    border: 1px solid #383838;
    border-radius: 7px;
    background: #171717;
    color: #eee;
    font: inherit;
    font-variant-numeric: tabular-nums;
  }
  .active-session-page .session-recording-start {
    border-color: #ffc72c;
    background: #ffc72c;
    color: #111;
  }
  .active-session-page .session-recording-stop {
    border-color: #8c3030;
    background: #5b1f1f;
  }
  .session-recording-bar p {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    color: #aaa;
    font-size: 0.85rem;
  }
  .session-recording-dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: #e64c4c;
  }
  .active-session-content {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(230px, 1fr);
    gap: 2rem;
    margin-top: 2rem;
  }
  .active-session-members {
    max-width: 32rem;
    margin-top: 2rem;
  }
  .active-session-content .active-session-members {
    margin-top: 0;
  }
  .active-session-members h2 {
    margin: 0 0 0.8rem;
    font-size: 1rem;
  }
  .active-session-members p {
    color: #888;
  }
  .active-session-members ul {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid #242424;
  }
  .active-session-members li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.8rem 0;
    border-bottom: 1px solid #242424;
  }
  .active-session-members li span {
    color: #999;
    font-size: 0.8rem;
  }
  .active-session-error {
    margin-top: 2rem;
    color: #ffaaa5;
  }
  .active-session-clock {
    position: fixed;
    right: 1.5rem;
    bottom: 1.3rem;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    color: #ddd;
    font-variant-numeric: tabular-nums;
  }
  .active-session-clock time {
    font-family: ui-monospace, monospace;
    font-size: 0.95rem;
  }
  .active-session-clock span {
    margin-top: 0.2rem;
    color: #777;
    font-size: 0.7rem;
  }
  .active-session-socket-status {
    position: absolute;
    left: 2.5rem;
    bottom: 1.5rem;
  }
  @media (max-width: 760px) {
    .active-session-header,
    .active-session-confirm {
      align-items: flex-start;
      flex-direction: column;
    }
    .active-session-content {
      grid-template-columns: 1fr;
    }
    .session-recording-bar {
      align-items: flex-start;
      flex-direction: column;
    }
  }
`;
