import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { io } from "socket.io-client";
import timesyncUrl from "timesync/dist/timesync.min.js?url";

import {
  endSession,
  getSessions,
  leaveSession,
  saveRecordingDetails,
  uploadSessionVideo,
} from "../api/recordings.js";
import { getGroups } from "../api/groups.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { LocalMediaPreview } from "../components/LocalMediaPreview.jsx";
import { useWakeLock } from "../hooks/useWakeLock.js";
import {
  createLocalRecorder,
  downloadFile,
  recordingBaseName,
  recordingDisplayName,
} from "../recording/localRecording.js";
import { END_BEEP_TONES_HZ, playSyncBeep } from "../recording/syncBeep.js";

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
  // This device starts and stops the other cameras without recording itself.
  const [controllerOnly, setControllerOnly] = useState(false);
  const controllerOnlyRef = useRef(false);
  controllerOnlyRef.current = controllerOnly;
  // Whether this user may start and stop takes (the session's creator, or an
  // admin or the owner of its group), known before joining so the camera
  // prompt can offer "Control only".
  const [mayControl, setMayControl] = useState(false);
  // In the room: with the camera on, or as a controller.
  const ready = mediaReady || controllerOnly;
  const [members, setMembers] = useState([]);
  const [socketStatus, setSocketStatus] = useState("Waiting for media");
  const [syncStatus, setSyncStatus] = useState("Syncing");
  const [syncedTime, setSyncedTime] = useState(Date.now());
  const [clockOffset, setClockOffset] = useState(0);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  // How far ahead the shared start is set. It has to cover the start
  // message reaching every phone over the internet, or they start late.
  // The session's creator and the group's admins and owner start and stop
  // takes for everyone; the server says which this user is when joining.
  const [canControl, setCanControl] = useState(false);
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
  // This device pressed Start, so it plays the sync beep for the take.
  const beepRequestedRef = useRef(false);
  // And pressed Stop, so it plays the end beep.
  const endBeepRequestedRef = useRef(false);
  // Waiting out a stop: cameras keep rolling until its time so they all
  // record the end beep.
  const stopTimerRef = useRef(null);
  // A camera that left its app mid-take, for whoever runs the session.
  const [dropNotice, setDropNotice] = useState("");
  const audioContextRef = useRef(null);
  // The screen stays on for the whole live session, cameras and controllers
  // alike: a sleeping computer misses the start or starts late.
  useWakeLock();

  // checks that this user can enter the live session
  useEffect(() => {
    let cancelled = false;

    Promise.all([getSessions(), getGroups().catch(() => [])])
      .then(([sessions, groups]) => {
        const currentSession = sessions.find(
          (item) => item.id === sessionId
        );

        if (!currentSession || currentSession.status !== "active") {
          throw new Error("This session is not live.");
        }
        if (!currentSession.isJoined) {
          throw new Error("Join this session from the Record page first.");
        }

        if (!cancelled) {
          setSession(currentSession);
          setMayControl(
            Number(currentSession.createdBy) === Number(user.id) ||
            groups.some((group) => group.id === currentSession.groupId && group.role === "admin")
          );
        }
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
    if (!session || !ready) return undefined;

    let socket;
    let clock;
    let timer;
    let cancelled = false;

    // uploads the video for playback; it's saved to this computer only if
    // the upload fails, so the take isn't lost
    const saveRecording = (recorder, extension) => {
      const info = recordingInfoRef.current;
      if (!info) return;

      const video = new Blob(recordingChunksRef.current, {
        type: recorder.mimeType || "video/webm",
      });
      const videoFileName = `${recordingBaseName(info)}.${extension}`;

      recorderRef.current = null;
      recordingInfoRef.current = null;
      recordingChunksRef.current = [];
      setRecordingStatus("idle");
      if (video.size === 0) {
        setRecordingMessage("Nothing was recorded on this device.");
        return;
      }
      setRecordingMessage("Uploading for playback...");
      // When the recorder really started, so playback can line this angle
      // up with the phones, which start a moment after the shared time.
      const actualStartedAt = info.actualStartAtEpochMs
        ? Math.round(info.actualStartAtEpochMs)
        : undefined;
      saveRecordingDetails(sessionId, info.plannedStartAtEpochMs, actualStartedAt)
        .then(() => uploadSessionVideo(
          sessionId, info.plannedStartAtEpochMs, video, videoFileName, actualStartedAt
        ))
        .then(() => setRecordingMessage("Uploaded for playback"))
        .catch((err) => {
          downloadFile(video, videoFileName);
          setRecordingMessage(
            `Upload failed (${err.message}), so ${videoFileName} was saved to this computer instead.`
          );
        });
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

      if (beepRequestedRef.current && command.beepAtEpochMs) {
        beepRequestedRef.current = false;
        const audioContext = audioContextRef.current;
        if (audioContext) {
          const wait = Math.max(0, command.beepAtEpochMs - receivedAtEpochMs) / 1000;
          playSyncBeep(audioContext, audioContext.currentTime + wait);
        }
      }
      setRecordingStatus("waiting");
      setRecordingMessage(`Recording starts in ${Math.round(delay)} ms`);

      if (controllerOnlyRef.current) {
        recordingTimerRef.current = window.setTimeout(() => {
          recordingTimerRef.current = null;
          setRecordingStatus("recording");
          setRecordingMessage(
            `${recordingDisplayName(command.startAtEpochMs, command.recordingNumber)} recording on the cameras`
          );
        }, delay);
        return;
      }

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
              `${recordingDisplayName(command.startAtEpochMs, command.recordingNumber)} in progress`
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

    // stops this device when the host sends stop: at the stop's time, after
    // the end beep, which this device plays if it pressed Stop
    const finishRecording = (command) => {
      if (recordingTimerRef.current) {
        window.clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      const receivedAtEpochMs = clock.now();
      if (endBeepRequestedRef.current && command.endBeepAtEpochMs) {
        const audioContext = audioContextRef.current;
        if (audioContext) {
          const wait = Math.max(0, command.endBeepAtEpochMs - receivedAtEpochMs) / 1000;
          playSyncBeep(audioContext, audioContext.currentTime + wait, END_BEEP_TONES_HZ);
        }
      }
      endBeepRequestedRef.current = false;

      const stopIn = command.stopAtEpochMs
        ? Math.max(0, command.stopAtEpochMs - receivedAtEpochMs)
        : 0;
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = window.setTimeout(() => {
        stopTimerRef.current = null;
        stopNow(command);
      }, stopIn);
    };

    const stopNow = (command) => {
      setDropNotice("");

      if (recordingInfoRef.current) {
        recordingInfoRef.current = {
          ...recordingInfoRef.current,
          serverStopAtEpochMs: command.stopAtEpochMs,
          stopCommandReceivedAtEpochMs: clock.now(),
          timesyncOffsetAtStopCommandMs: clock.offset,
        };
      }

      if (controllerOnlyRef.current) {
        recordingInfoRef.current = null;
        setRecordingStatus("idle");
        setRecordingMessage("Take stopped. The cameras are saving and uploading it.");
        return;
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
          socket.emit("session:join", { sessionId, camera: !controllerOnlyRef.current }, (reply) => {
            if (!reply?.ok) {
              setSocketStatus("Disconnected");
              setError(reply?.error || "Unable to join the live session.");
              return;
            }

            setMembers(reply.members);
            setSocketStatus("Connected");
            // Clears "Reconnecting…" once a dropped connection is back.
            setError("");
            const controls = Boolean(reply.session.canControl);
            setCanControl(controls);
            setRecordingMessage(
              controls ? "Ready to record." : "Waiting for the host to record."
            );
            if (reply.recording) beginRecording(reply.recording);
          });
        });

        socket.on("connect_error", (err) => {
          setSocketStatus("Disconnected");
          // A network drop or server restart ("xhr poll error"); socket.io
          // keeps retrying and rejoins on connect. Anything else, like a
          // rejected login, is shown as is.
          setError(err.type === "TransportError"
            ? "Lost the connection to the server. Reconnecting…"
            : err.message);
        });
        socket.on("session:members", setMembers);
        socket.on("recording:started", beginRecording);
        socket.on("recording:stopped", finishRecording);
        socket.on("recording:dropped", ({ user: dropped } = {}) => {
          const name = dropped?.name || dropped?.email || "A camera";
          setDropNotice(`${name} left the app, so their camera stopped recording this take.`);
        });
        socket.on("session:close", () => {
          navigate("/watch", { replace: true });
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
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
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
  }, [ready, navigate, session, sessionId, user.id]);

  // Switching between recording and controlling after joining: join again
  // with the new choice (the server updates who's a camera). Before the
  // socket is up, the first join already carries it.
  const modeChanged = useRef(false);
  useEffect(() => {
    if (!modeChanged.current) {
      modeChanged.current = true;
      return;
    }
    const socket = socketRef.current;
    if (!socket?.connected) return;
    socket.emit("session:join", { sessionId, camera: !controllerOnly }, (reply) => {
      if (reply?.ok) setMembers(reply.members);
    });
  }, [controllerOnly, sessionId]);

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

    // Created on the click so the browser lets it play sound.
    try {
      audioContextRef.current ??= new AudioContext();
      audioContextRef.current.resume();
      beepRequestedRef.current = true;
    } catch {
      // No Web Audio: the take still lines up by the reported start times.
    }

    setRecordingStatus("requesting");
    setRecordingMessage("Sending the synchronized start...");
    socket.emit(
      "recording:start",
      // The server picks the start time, allowing for the slowest device.
      { sessionId },
      (reply) => {
        if (!reply?.ok) {
          beepRequestedRef.current = false;
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

    // The click lets the end beep play, like the start's.
    try {
      audioContextRef.current ??= new AudioContext();
      audioContextRef.current.resume();
      endBeepRequestedRef.current = true;
    } catch {
      // No Web Audio: cameras that heard the start beep still line up.
    }

    setRecordingStatus("stopping");
    setRecordingMessage("Stopping with a beep...");
    socket.emit("recording:stop", { sessionId }, (reply) => {
      if (!reply?.ok) {
        endBeepRequestedRef.current = false;
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
      navigate("/watch", { replace: true });
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
      navigate("/watch", { replace: true });
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
      navigate("/watch", { replace: true });
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

        {session && (
        <div className="active-session-actions">
          <a className="active-session-watch" href={`/watch/${sessionId}`}
            target="_blank" rel="noopener noreferrer"
            title="Opens in a new tab, so this session keeps running">
            Watch recordings ↗
          </a>
          {/* Hosts and admins can run the take without recording here,
              like the camera switch in the phone's session bar. */}
          {mayControl && (
            <div className="session-device-mode" role="group" aria-label="This device">
              <span>This device</span>
              <button type="button" aria-pressed={!controllerOnly}
                disabled={recordingStatus !== "idle"}
                onClick={() => setControllerOnly(false)}>Recording</button>
              <button type="button" aria-pressed={controllerOnly}
                disabled={recordingStatus !== "idle"}
                onClick={() => setControllerOnly(true)}>Controlling</button>
            </div>
          )}
          {isCreator ? (
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
          )}
        </div>
        )}
      </header>

      {error && (
        <div className="active-session-error">
          <p>{error}</p>
          <button type="button" onClick={() => navigate("/watch")}>
            Back to Sessions
          </button>
        </div>
      )}

      {session && (
        <>
          {ready && (
            <section className="session-recording-bar">
              {canControl && (
                <div className="session-recording-controls">
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

              {canControl && recordingStatus === "idle" && (
                <p className="session-sync-tip">
                  Starting plays a short beep that every camera uses to line up.
                  For the closest sync, start from a device near the middle of the
                  room and keep its volume up.
                </p>
              )}

              <p>
                {recordingStatus === "recording" && (
                  <span className="session-recording-dot" />
                )}
                {recordingMessage}
              </p>
              {canControl && dropNotice && (
                <p className="session-sync-tip" role="status">{dropNotice}</p>
              )}
            </section>
          )}

          <div className={ready ? "active-session-content" : ""}>
            {controllerOnly ? (
              <section className="session-controller-note">
                <h2>Controlling the cameras</h2>
                <p>
                  This device isn't recording. Start and stop every camera from
                  here; it still plays the sync beep, so keep its volume up.
                </p>
              </section>
            ) : (
              <LocalMediaPreview
                disabled={recordingStatus !== "idle"}
                onReady={handleMediaReady}
                onDecline={declineMedia}
              />
            )}

            {ready && (
              <section className="active-session-members">
                <h2>In this session</h2>
                {members.length > 0 && (
                  <p className="session-camera-count">
                    {members.length} {members.length === 1 ? "device" : "devices"} connected
                  </p>
                )}
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
                        {member.camera === false && <span>Controller</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        </>
      )}

      {ready && (
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
  /* Outlined in the team color, like Watch on the Sessions page. */
  .active-session-watch {
    padding: 0.45rem 0.8rem;
    border: 1px solid var(--accent);
    border-radius: 7px;
    color: var(--accent);
    font-weight: 600;
    text-decoration: none;
    white-space: nowrap;
  }
  .active-session-watch:hover { background: rgba(255,255,255,0.06); }
  .active-session-actions { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; justify-content: flex-end; }
  .session-device-mode { display: inline-flex; align-items: center; gap: 0; }
  .session-device-mode > span { margin-right: 0.6rem; }
  .active-session-page .session-device-mode button { border-radius: 0; padding: 0.45rem 0.8rem; }
  .active-session-page .session-device-mode button:nth-of-type(1) { border-radius: 7px 0 0 7px; }
  .active-session-page .session-device-mode button:nth-of-type(2) { border-radius: 0 7px 7px 0; border-left: none; }
  .active-session-page .session-device-mode button[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
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
  .session-controller-note { padding: 1.25rem 1.5rem; border-radius: 12px; background: #141414; }
  .session-controller-note h2 { margin: 0 0 0.5rem; font-size: 1.1rem; }
  .session-controller-note p { margin: 0; color: #a8a8a8; line-height: 1.5; }
  .session-camera-count { margin: 0 0 0.6rem; color: #a8a8a8; font-size: 0.9rem; }
  .session-sync-tip { margin: 8px 0 0; color: #9a9a9a; font-size: 0.82rem; line-height: 1.45; }
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
  .active-session-page .session-recording-start {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-ink);
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
