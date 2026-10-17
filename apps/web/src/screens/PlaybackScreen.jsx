import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { useAuth } from "../auth/AuthContext.jsx";
import {
  createSessionNote,
  deleteSessionNote,
  getSessionNotes,
  getSessionVideos,
  sessionDownloadUrl,
  uploadSessionVideo,
} from "../api/recordings.js";
import { anglesPerPage, commonAspect, layoutAngles } from "../recording/angleLayout.js";
import { angleTrims } from "../recording/angleTrims.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";

export function PlaybackScreen() {
  const { sessionId } = useParams();
  const { user } = useAuth();
  const [session, setSession] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState([]);
  const [notesError, setNotesError] = useState("");
  const videoTime = useRef(0);
  const seek = useRef(null);
  // The player's layout buttons sit in the title row, so the angles get
  // the height a row of their own would take.
  const [toolsSlot, setToolsSlot] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    getSessionVideos(sessionId)
      .then((data) => {
        if (cancelled) return;
        setSession(data.session);
        setRecordings(data.recordings);
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sessionId]);

  // A session opens on its list of recordings (takes); ?recording=N plays
  // one. A session with a single recording goes straight to it.
  const [searchParams] = useSearchParams();
  const chosen = Number(searchParams.get("recording"));
  const chosenIndex = chosen
    ? recordings.findIndex((recording, index) => (recording.number ?? index + 1) === chosen)
    : -1;
  const recordingIndex = chosenIndex >= 0 ? chosenIndex : recordings.length === 1 ? 0 : null;
  const recording = recordingIndex === null ? null : recordings[recordingIndex];
  const startedAt = recording?.startedAt;
  const showingList = recordings.length > 1 && recordingIndex === null;

  // A live session's takes show up as their uploads finish. Only while the
  // list is up, so a recording being watched is never swapped underneath.
  useAutoRefresh(() => {
    if (recordingIndex !== null && recordings.length > 0) return;
    getSessionVideos(sessionId)
      .then((data) => setRecordings(data.recordings))
      .catch(() => {});
  }, 10000);

  useEffect(() => {
    if (!startedAt) return;
    let cancelled = false;
    setNotesError("");
    getSessionNotes(sessionId, startedAt)
      .then((loaded) => { if (!cancelled) setNotes(loaded); })
      .catch((err) => { if (!cancelled) setNotesError(err.message); });
    return () => { cancelled = true; };
  }, [sessionId, startedAt]);

  return (
    <div className="playback-page">
      <style>{css}</style>
      <div className="playback-title">
        {recordings.length > 1 && recording ? (
          <Link to={`/watch/${sessionId}`} className="playback-back"
            aria-label={`Back to ${session?.name ?? "the session"}'s recordings`}>←</Link>
        ) : (
          <Link to="/watch" className="playback-back" aria-label="Back to sessions">←</Link>
        )}
        {!loading && !error && (
          <>
            <h1>
              {session.name}
              {recording && recordings.length > 1 && (
                <span className="playback-take">{takeName(recording, recordingIndex)}</span>
              )}
            </h1>
            <div className="playback-title-tools" ref={setToolsSlot} />
            {recordings.some((recording) => recording.videos.some((video) => video.url)) && (
              <a className="playback-download" href={sessionDownloadUrl(sessionId)} download
                aria-label="Download all videos" title="Download all videos">
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                  <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            )}
          </>
        )}
      </div>
      {loading ? <p>Loading recordings...</p> : error ? (
        <p role="alert">{error}</p>
      ) : (
        <>
          <div className="playback-layout">
            {recordings.length === 0 ? (
              <p>No videos have been uploaded for this session yet.</p>
            ) : showingList ? (
              <RecordingList sessionId={sessionId} recordings={recordings} />
            ) : (
              <>
                <SessionPlayer key={`${sessionId}-${recordingIndex}`} recordings={recordings}
                  sessionId={sessionId} userId={Number(user.id)} onUploaded={setRecordings}
                  videoTime={videoTime} seek={seek} notes={notes} setNotes={setNotes}
                  notesError={notesError} setNotesError={setNotesError}
                  recordingIndex={recordingIndex} toolsSlot={toolsSlot}
                  title={`${session.name} · ${takeName(recording, recordingIndex)}`} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Comments are blue dots on the seek bar where they were left; each one
// pops up over the video for a few seconds as playback passes it. There is
// no separate list: posting one stamps it at the moment on screen.
function takeName(recording, index) {
  return `Recording ${String(recording.number ?? index + 1).padStart(3, "0")}`;
}

// The session's recordings (takes) as cards: a still from the first angle,
// the take's name, when it started and how many angles it has.
function RecordingList({ sessionId, recordings }) {
  return (
    <ul className="recording-list">
      {recordings.map((recording, index) => {
        const angles = recording.videos.filter((video) => video.url);
        const number = recording.number ?? index + 1;
        const started = new Date(recording.startedAt);
        return (
          <li key={recording.startedAt}>
            <Link to={`/watch/${sessionId}?recording=${number}`}>
              <span className="recording-still">
                {angles[0] ? (
                  <video src={`${angles[0].url}#t=1`} preload="metadata" muted playsInline
                    crossOrigin="use-credentials" aria-hidden="true" tabIndex={-1} />
                ) : <span>No video yet</span>}
              </span>
              <strong>{takeName(recording, index)}</strong>
              <span className="recording-meta">
                {started.toLocaleDateString([], { month: "short", day: "numeric" })}
                {" · "}
                {started.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                {" · "}
                {angles.length} {angles.length === 1 ? "angle" : "angles"}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function SessionPlayer({ recordings, sessionId, userId, onUploaded, videoTime, seek,
  notes, setNotes, notesError, setNotesError, recordingIndex, toolsSlot, title }) {
  const [uploading, setUploading] = useState(false);
  const [page, setPage] = useState(0);
  const [panelLayouts, setPanelLayouts] = useState({});
  const [audioSettings, setAudioSettings] = useState({});
  const [openVolume, setOpenVolume] = useState(null);
  const [choosingPanel, setChoosingPanel] = useState(null);
  const [focusedPanel, setFocusedPanel] = useState(null);
  // Each angle's shape (width / height), learned as its video loads, and the
  // space the angles are laid out in.
  const [aspects, setAspects] = useState({});
  const [gridElement, setGridElement] = useState(null);
  const [gridSize, setGridSize] = useState({ width: 0, height: 0 });
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [commentText, setCommentText] = useState("");
  // Waiting for every angle to have enough loaded to play together.
  const [buffering, setBuffering] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const videoRefs = useRef([]);
  const currentTime = useRef(0);
  const playRequest = useRef(0);
  const playingRef = useRef(false);
  playingRef.current = playing;
  const videos = recordings[recordingIndex].videos;
  // Each angle skips ahead so all of them show the same moment; times shown
  // and saved (seek bar, comments) are on that shared timeline.
  const trims = angleTrims(videos);
  const trimOf = (player) => Number(player?.dataset.trim || 0);
  const panels = panelLayouts[recordingIndex] || (videos.length ? videos.map((video) => video.userId) : [null]);
  const panelVideos = panels.map(
    (id) => videos.find((video) => video.userId === id) || null
  );
  // As many angles per page as fit while each stays big enough to watch
  // (at least 340px wide): 4 on a laptop, 9-16 on a big monitor. Clicking
  // an angle shows it on its own.
  const perPage = gridSize.width > 0
    ? anglesPerPage(gridSize.width, gridSize.height,
      commonAspect(Object.values(aspects)), { minTileWidth: 340 })
    : 4;
  const pages = Math.ceil(panels.length / perPage);
  useEffect(() => {
    if (page > 0 && page >= pages) setPage(Math.max(0, pages - 1));
  }, [page, pages]);

  // The grid takes the rest of the window, leaving room below it for the
  // comment pop-up and the play bar. Nothing between them depends on how many
  // angles fit (the page arrows sit in the play bar), so this can't loop.
  const transportRef = useRef(null);
  const [gridHeight, setGridHeight] = useState(null);

  // Fullscreen: the whole player (angles, play bar, comments) fills the
  // screen with a slim bar on top, and the grid re-fits to it. F toggles it,
  // Esc leaves (the browser handles that), Space plays and pauses.
  const boxRef = useRef(null);
  const [fullscreen, setFullscreen] = useState(false);
  const canFullscreen = typeof document !== "undefined" && document.fullscreenEnabled;
  useEffect(() => {
    const onChange = () => setFullscreen(
      Boolean(boxRef.current) && document.fullscreenElement === boxRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else boxRef.current?.requestFullscreen().catch(() => {});
  };
  useLayoutEffect(() => {
    if (!gridElement) return undefined;
    const fit = () => {
      const grid = gridElement.getBoundingClientRect();
      const transport = transportRef.current?.getBoundingClientRect();
      const below = transport ? transport.bottom - grid.bottom : 0;
      // In fullscreen the player is the whole screen; otherwise leave the
      // page's own bottom padding, so the player fits without scrolling.
      const top = fullscreen ? grid.top : grid.top + window.scrollY;
      const main = gridElement.closest("main");
      const padding = fullscreen ? 8
        : main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 16;
      setGridHeight(Math.max(320, Math.floor(window.innerHeight - top - below - padding - 4)));
    };
    fit();
    // Entering or leaving fullscreen settles a frame later.
    const frame = requestAnimationFrame(fit);
    window.addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", fit);
    };
  }, [gridElement, Boolean(error), toolsSlot, fullscreen]);

  useLayoutEffect(() => {
    if (!gridElement) return undefined;
    // Measured now, so the angles show on the first paint (a ResizeObserver
    // only reports on a frame, which a background tab may not draw).
    const { width, height } = gridElement.getBoundingClientRect();
    setGridSize({ width, height });
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setGridSize({ width, height });
    });
    observer.observe(gridElement);
    return () => observer.disconnect();
  }, [gridElement, gridHeight]);

  // The current page's tiles: the best-fit grid, in the angles' usual shape,
  // or just the enlarged one.
  const pageStart = page * perPage;
  const pageCount = Math.min(perPage, Math.max(0, panelVideos.length - pageStart));
  const pageAspect = commonAspect(
    Array.from({ length: pageCount }, (_, i) => aspects[pageStart + i])
  );
  // With more than one page, the angles leave a strip on each side for the
  // page arrows, so the arrows never cover a video.
  const ARROW = 48;
  const gutter = pages > 1 ? ARROW + 6 : 0;
  const pageRects = focusedPanel !== null
    ? null
    : layoutAngles({
      width: Math.max(0, gridSize.width - 2 * gutter),
      height: gridSize.height,
      count: pageCount,
      aspect: pageAspect,
    }).map((rect) => ({ ...rect, left: rect.left + gutter }));
  const focusRect = focusedPanel === null
    ? null
    : layoutAngles({
      width: gridSize.width,
      height: gridSize.height,
      count: 1,
      aspect: aspects[focusedPanel] ?? pageAspect,
    })[0];
  const tileStyle = (panelIndex) => {
    const rect = focusedPanel !== null
      ? (panelIndex === focusedPanel ? focusRect : null)
      : pageRects?.[panelIndex - pageStart];
    if (!rect) return { display: "none" };
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  };

  // The page arrows sit just outside the angles, in the side strips.
  const tilesLeft = pageRects?.length ? Math.min(...pageRects.map((r) => r.left)) : 0;
  const tilesRight = pageRects?.length
    ? Math.max(...pageRects.map((r) => r.left + r.width)) : gridSize.width;
  const prevArrowLeft = Math.max(0, tilesLeft - ARROW - 4);
  const nextArrowLeft = Math.min(gridSize.width - ARROW, tilesRight + 4);

  // Only the angles on screen load and play: the current page, or just the
  // enlarged one. Each video is a full-quality stream to download and
  // decode, so the rest stay paused (or unmounted, on other pages) and jump
  // to the current moment when they come into view.
  const isOnScreen = (panelIndex) =>
    focusedPanel !== null ? panelIndex === focusedPanel : Math.floor(panelIndex / perPage) === page;
  const onScreenPlayers = () =>
    videoRefs.current.filter((video, panelIndex) => video && isOnScreen(panelIndex));
  const liveNote = notes.filter((note) => {
    const at = note.videoTimeMs / 1000;
    return at <= time && time < at + 3;
  }).at(-1);

  const getPanelAudio = (panelIndex) => audioSettings[recordingIndex]?.[panelIndex] || {
    volume: 1,
    muted: panelIndex !== panelVideos.findIndex((video) => video?.url),
  };

  const setPanelAudio = (panelIndex, audio) => {
    setAudioSettings((current) => {
      const settings = [...(current[recordingIndex] || [])];
      settings[panelIndex] = audio;
      return { ...current, [recordingIndex]: settings };
    });
  };

  const startedAt = recordings[recordingIndex].startedAt;

  // Stamped with the moment on screen, so its dot lands where it was left.
  const postComment = async (event) => {
    event.preventDefault();
    const body = commentText.trim();
    if (!body) return;
    setPosting(true);
    setNotesError("");
    try {
      await createSessionNote(sessionId, startedAt, body, Math.round(videoTime.current * 1000));
      setNotes(await getSessionNotes(sessionId, startedAt));
      setCommentText("");
    } catch (err) {
      setNotesError(err.message);
    } finally {
      setPosting(false);
    }
  };

  const removeComment = async (noteId) => {
    setNotesError("");
    try {
      await deleteSessionNote(sessionId, noteId);
      setNotes((current) => current.filter((note) => note.id !== noteId));
    } catch (err) {
      setNotesError(err.message);
    }
  };

  const pause = () => {
    playRequest.current += 1;
    videoRefs.current.forEach((video) => video?.pause());
    setPlaying(false);
  };

  const play = async () => {
    const players = onScreenPlayers();
    if (players.length === 0) return;
    const request = ++playRequest.current;
    setError("");
    if (players.every((video) => video.ended)) {
      players.forEach((video) => { video.currentTime = trimOf(video); });
    }
    // Start every angle at once, only when all of them can: otherwise the
    // one still loading starts late and stays behind.
    setBuffering(true);
    const ready = await untilReady(players.filter((video) => !video.ended));
    if (request !== playRequest.current) return;
    setBuffering(false);
    if (!ready) {
      pause();
      setError("An angle is still loading. Try again in a moment.");
      return;
    }
    try {
      await Promise.all(players.filter((video) => !video.ended).map((video) => video.play()));
      if (request === playRequest.current) setPlaying(true);
    } catch {
      if (request !== playRequest.current) return;
      pause();
      setError("A video could not play. Try again once it has loaded.");
    }
  };

  // Keeps the angles together while playing: browsers drift a little, and
  // an angle that seeks or buffers falls behind. Every half second, any
  // angle more than 0.1 s off the first one is moved back into line.
  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => {
      const players = onScreenPlayers().filter(
        (video) => Number.isFinite(video.duration) && !video.ended
      );
      if (players.length < 2) return;
      const [leader, ...others] = players;
      const at = leader.currentTime - trimOf(leader);
      for (const video of others) {
        const target = at + trimOf(video);
        if (target < video.duration && Math.abs(video.currentTime - target) > 0.1) {
          video.currentTime = target;
        }
      }
    }, 500);
    return () => clearInterval(timer);
  }, [playing, page, perPage, focusedPanel]);

  // Coming into view (a new page, or leaving the enlarged view): catch up to
  // the moment on screen and play along. Going out of view: pause.
  useEffect(() => {
    const at = currentTime.current;
    videoRefs.current.forEach((video, panelIndex) => {
      if (!video) return;
      if (!isOnScreen(panelIndex)) {
        video.pause();
      } else if (playingRef.current && Number.isFinite(video.duration)) {
        video.currentTime = Math.min(at + trimOf(video), video.duration);
        video.play().catch(() => {});
      }
    });
  }, [page, perPage, focusedPanel]); // eslint-disable-line react-hooks/exhaustive-deps

  const seekTo = async (nextTime) => {
    const players = onScreenPlayers().filter((video) => Number.isFinite(video.duration));
    if (players.length === 0) return;
    currentTime.current = nextTime;
    videoTime.current = nextTime;
    setTime(nextTime);
    players.forEach((video) => {
      video.currentTime = Math.min(nextTime + trimOf(video), video.duration);
    });

    // A shorter video may have ended already; resume it when seeking back.
    if (playing) {
      const request = ++playRequest.current;
      try {
        await Promise.all(players
          .filter((video) => nextTime + trimOf(video) < video.duration)
          .map((video) => video.play()));
      } catch {
        if (request !== playRequest.current) return;
        pause();
        setError("A video could not resume. Try pressing play again.");
      }
    }
  };

  // the notes panel jumps the player through this
  seek.current = seekTo;

  // Enlarging keeps the other panels mounted but paused; they catch up
  // when the grid comes back.
  const toggleFocus = (panelIndex) =>
    setFocusedPanel((current) => (current === panelIndex ? null : panelIndex));

  useEffect(() => {
    if (focusedPanel === null) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setFocusedPanel(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusedPanel]);

  const skip = (seconds) => {
    const players = onScreenPlayers().filter((video) => Number.isFinite(video.duration));
    if (players.length === 0) return;
    const longest = Math.max(...players.map((video) => video.duration - trimOf(video)));
    const from = Math.max(...players.map((video) => video.currentTime - trimOf(video)));
    seekTo(Math.max(0, Math.min(longest, from + seconds)));
  };

  const uploadMissingVideo = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = "";
    pause();
    setUploading(true);
    setError("");
    try {
      await uploadSessionVideo(sessionId, recordings[recordingIndex].startedAt, file, file.name);
      const data = await getSessionVideos(sessionId);
      onUploaded(data.recordings);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const updatePanels = (nextPanels) => {
    const players = onScreenPlayers();
    if (players.length) {
      currentTime.current = Math.max(...players.map((video) => video.currentTime - trimOf(video)));
    }
    pause();
    videoRefs.current = [];
    setDuration(0);
    setError("");
    setChoosingPanel(null);
    setOpenVolume(null);
    setFocusedPanel(null);
    setPanelLayouts((current) => ({ ...current, [recordingIndex]: nextPanels }));
  };

  const chooseVideo = (panelIndex, value) => {
    const nextPanels = [...panels];
    nextPanels[panelIndex] = value === "" ? null : Number(value);
    updatePanels(nextPanels);
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (target.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if ((event.key === "f" || event.key === "F") && canFullscreen) {
        event.preventDefault();
        toggleFullscreen();
      } else if (event.key === " " && !target.closest?.("button")) {
        event.preventDefault();
        (playingRef.current ? pause : play)();
      } else if ((event.key === "ArrowRight" || event.key === "ArrowLeft")
          && pages > 1 && focusedPanel === null && !target.closest?.("input")) {
        const next = page + (event.key === "ArrowRight" ? 1 : -1);
        if (next >= 0 && next < pages) {
          event.preventDefault();
          changePage(next);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const changePage = (nextPage) => {
    setPage(nextPage);
    setChoosingPanel(null);
    setOpenVolume(null);
    setFocusedPanel(null);
  };

  // Swiping sideways over the angles turns the page when they don't all
  // fit: two fingers on a trackpad, or one on a touchscreen. One page per
  // swipe; the browser's swipe-to-go-back is held off over the grid.
  const swipe = useRef({ dx: 0, at: 0, touchX: null });
  const turnPage = useRef(null);
  turnPage.current = (direction) => {
    const next = page + direction;
    if (focusedPanel !== null || next < 0 || next >= pages) return;
    changePage(next);
  };
  useEffect(() => {
    if (!gridElement) return undefined;
    const onWheel = (event) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      const now = Date.now();
      // A swipe's momentum keeps sending events; wait for it to settle.
      if (now - swipe.current.at < 700) return;
      swipe.current.dx += event.deltaX;
      if (Math.abs(swipe.current.dx) > 60) {
        turnPage.current(swipe.current.dx > 0 ? 1 : -1);
        swipe.current = { ...swipe.current, dx: 0, at: now };
      }
    };
    const onTouchStart = (event) => { swipe.current.touchX = event.touches[0]?.clientX ?? null; };
    const onTouchEnd = (event) => {
      const start = swipe.current.touchX;
      const end = event.changedTouches[0]?.clientX;
      swipe.current.touchX = null;
      if (start == null || end == null || Math.abs(end - start) < 60) return;
      turnPage.current(end < start ? 1 : -1);
    };
    gridElement.addEventListener("wheel", onWheel, { passive: false });
    gridElement.addEventListener("touchstart", onTouchStart, { passive: true });
    gridElement.addEventListener("touchend", onTouchEnd);
    return () => {
      gridElement.removeEventListener("wheel", onWheel);
      gridElement.removeEventListener("touchstart", onTouchStart);
      gridElement.removeEventListener("touchend", onTouchEnd);
    };
  }, [gridElement]);


  const tools = (
    <>
      {canFullscreen && (
        <button type="button" className="playback-fullscreen" onClick={toggleFullscreen}
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          title={fullscreen ? "Exit full screen (F or Esc)" : "Full screen (F)"}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {fullscreen
              ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
              : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
          </svg>
        </button>
      )}
    </>
  );

  return (
    <section className="playback-box" ref={boxRef}>
      {fullscreen ? (
        <div className="playback-fs-bar">
          <strong>{title}</strong>
          <div className="playback-fs-tools">{tools}</div>
        </div>
      ) : toolsSlot ? createPortal(tools, toolsSlot) : <div className="playback-top">{tools}</div>}
      {buffering && <p className="playback-buffering" role="status">Loading angles…</p>}
      {panelVideos.length === 0 ? (
        <p className="playback-empty">No videos have been uploaded for this recording yet.</p>
      ) : [page].map((pageIndex) => {
        const pageVideos = panelVideos.slice(pageIndex * perPage, pageIndex * perPage + perPage);
        return (
        <div aria-busy={buffering} className="playback-grid" ref={setGridElement}
          style={gridHeight ? { height: gridHeight } : undefined}
          key={`${recordingIndex}-${pageIndex}-${panels.join(",")}`}>
          {pageVideos.map((video, index) => {
            const panelIndex = pageIndex * perPage + index;
            const audio = getPanelAudio(panelIndex);
            const focused = focusedPanel === panelIndex;
            return (
            <figure key={pageIndex * perPage + index} style={tileStyle(panelIndex)}
              className={focused ? "playback-focused" : undefined}>
              {video?.url && (
                <button type="button" className="playback-panel-change" disabled={uploading}
                  aria-label={`Change video for panel ${panelIndex + 1}`}
                  aria-expanded={choosingPanel === panelIndex}
                  title="Show a different camera here"
                  onClick={() => {
                    setChoosingPanel(choosingPanel === panelIndex ? null : panelIndex);
                  }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 8h13l-3-3M20 16H7l3 3" />
                  </svg>
                </button>
              )}
              {video?.url && (
                <div className="playback-audio">
                  <button type="button" aria-label={`Audio for panel ${panelIndex + 1}`}
                    aria-expanded={openVolume === panelIndex}
                    title={openVolume === panelIndex ? "Close volume slider" : "Open volume slider. Double-click to mute."}
                    onClick={(event) => {
                      if (event.detail > 1) return;
                      const opening = openVolume !== panelIndex;
                      setOpenVolume(opening ? panelIndex : null);
                      if (opening) setPanelAudio(panelIndex, { ...audio, muted: false });
                    }}
                    onDoubleClick={() => {
                      setOpenVolume(null);
                      setPanelAudio(panelIndex, { ...audio, muted: true });
                    }}>
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M4 9h4l5-4v14l-5-4H4z" />
                      {audio.muted ? <path d="m17 9 5 6m0-6-5 6" /> : <path d="M17 8a6 6 0 0 1 0 8" />}
                    </svg>
                  </button>
                  {openVolume === panelIndex && (
                    <input type="range" min="0" max="100" step="1"
                      aria-label={`Volume for panel ${panelIndex + 1}`}
                      value={audio.muted ? 0 : Math.round(audio.volume * 100)}
                      onChange={(event) => {
                        const volume = Number(event.target.value) / 100;
                        setPanelAudio(panelIndex, {
                          volume: volume || audio.volume,
                          muted: volume === 0,
                        });
                      }} />
                  )}
                </div>
              )}
              {video?.url ? <video
                ref={(element) => {
                  videoRefs.current[panelIndex] = element;
                  if (element) element.volume = audio.volume;
                }}
                src={video.url}
                data-trim={trims.get(video.userId) ?? 0}
                crossOrigin="use-credentials"
                preload="auto"
                playsInline
                muted={audio.muted}
                aria-label={video.name}
                onLoadedMetadata={(event) => {
                  const player = event.currentTarget;
                  if (player.videoWidth && player.videoHeight) {
                    const aspect = player.videoWidth / player.videoHeight;
                    setAspects((current) => (current[panelIndex] === aspect
                      ? current : { ...current, [panelIndex]: aspect }));
                  }
                  player.currentTime = Math.min(currentTime.current + trimOf(player), player.duration || 0);
                  setDuration((current) => Math.max(current, (player.duration || 0) - trimOf(player)));
                  // Mounted mid-playback (a new page): join in.
                  if (playingRef.current && isOnScreen(panelIndex)) player.play().catch(() => {});
                }}
                onTimeUpdate={(event) => {
                  const player = event.currentTarget;
                  const at = Math.max(0, player.currentTime - trimOf(player));
                  videoTime.current = at;
                  currentTime.current = at;
                  setTime(at);
                }}
                onEnded={() => {
                  if (onScreenPlayers().every((player) => player.ended)) {
                    setPlaying(false);
                  }
                }}
                onWaiting={() => {
                  // One angle ran out of data: hold them all until it
                  // catches up, rather than letting it fall behind.
                  if (!playing || !isOnScreen(panelIndex)) return;
                  onScreenPlayers().forEach((player) => player.pause());
                  play();
                }}
                onError={() => {
                  pause();
                  setError("A video could not load. Try refreshing the page.");
                }}
              /> : <div className="playback-missing" />}
              {/* Clicking an angle plays it on its own (click again for the
                  grid). An empty panel opens the camera list instead. */}
              <button type="button" className="playback-add-video" disabled={uploading}
                aria-label={!video?.url
                  ? `Choose video for panel ${panelIndex + 1}`
                  : focused ? "Return to grid" : `Show ${video.name} on its own`}
                aria-expanded={video?.url ? undefined : choosingPanel === panelIndex}
                onClick={() => {
                  if (!video?.url) {
                    setChoosingPanel(choosingPanel === panelIndex ? null : panelIndex);
                    return;
                  }
                  setChoosingPanel(null);
                  if (panels.length > 1) toggleFocus(panelIndex);
                }}>
                {!video?.url && choosingPanel !== pageIndex * perPage + index && "+"}
              </button>
              {choosingPanel === pageIndex * perPage + index && (
                <div className="playback-panel-picker" role="group"
                  aria-label={`Video for panel ${pageIndex * perPage + index + 1}`}
                  onKeyDown={(event) => { if (event.key === "Escape") setChoosingPanel(null); }}>
                  {/* Every camera, scrolling when there are more than fit. */}
                  {videos.map((option, optionIndex) => (
                    <button type="button" key={option.userId} autoFocus={optionIndex === 0}
                      disabled={uploading} aria-pressed={panels[pageIndex * perPage + index] === option.userId}
                      onClick={() => chooseVideo(pageIndex * perPage + index, option.userId)}>
                      {option.name}{option.url ? "" : " (not uploaded)"}
                    </button>
                  ))}
                  <button type="button" disabled={uploading}
                    onClick={() => chooseVideo(pageIndex * perPage + index, "")}>Empty panel</button>
                  {video && !video.url && video.userId === userId && (
                    <label>
                      {uploading ? "Uploading..." : "Upload your saved video"}
                      <input type="file" accept="video/*" disabled={uploading}
                        onChange={uploadMissingVideo} />
                    </label>
                  )}
                </div>
              )}
              {video?.url && <figcaption><span>{video.name}</span></figcaption>}
            </figure>
            );
          })}
          {/* More angles than fit: arrows on the grid's sides (or swipe, or
              the arrow keys). */}
          {pages > 1 && focusedPanel === null && page > 0 && (
            <button type="button" className="playback-page-arrow"
              style={{ left: prevArrowLeft }}
              aria-label="Previous angles" disabled={uploading}
              onClick={() => changePage(page - 1)}>
              <svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true">
                <path d="M15 4l-8 8 8 8" fill="none" stroke="currentColor" strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          {pages > 1 && focusedPanel === null && page + 1 < pages && (
            <button type="button" className="playback-page-arrow"
              style={{ left: nextArrowLeft }}
              aria-label="More angles" disabled={uploading}
              onClick={() => changePage(page + 1)}>
              <svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true">
                <path d="M9 4l8 8-8 8" fill="none" stroke="currentColor" strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
        );
      })}
      {error && <p className="playback-error" role="alert">{error}</p>}
      <p className="playback-live-note" aria-live="polite">
        {liveNote && (
          <>
            <strong>{liveNote.author}:</strong> "{liveNote.body}"
            {liveNote.canDelete && (
              <button type="button" className="playback-note-delete"
                aria-label={`Delete comment by ${liveNote.author}`}
                onClick={() => removeComment(liveNote.id)}>×</button>
            )}
          </>
        )}
      </p>
      <div className="playback-transport" ref={transportRef}>
      <div className="playback-controls">
        <button type="button" className="playback-skip" aria-label="Back 5 seconds" onClick={() => skip(-5)}
          disabled={uploading || !panelVideos.some((video) => video?.url)}>
          <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
            <path d="M7 9a11 11 0 1 1-2 13M7 3v6h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <text x="16" y="20" textAnchor="middle" fill="currentColor" fontSize="10">−5</text>
          </svg>
        </button>
        <button type="button" className="playback-toggle"
          aria-label={playing ? "Pause" : "Play"}
          onClick={playing ? pause : play}
          disabled={uploading || !panelVideos.some((video) => video?.url)}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
            {playing ? <path d="M6 4h4v16H6zM14 4h4v16h-4z" /> : <path d="M7 4v16l13-8z" />}
          </svg>
        </button>
        <button type="button" className="playback-skip" aria-label="Forward 5 seconds" onClick={() => skip(5)}
          disabled={uploading || !panelVideos.some((video) => video?.url)}>
          <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
            <path d="M25 9a11 11 0 1 0 2 13M25 3v6h-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <text x="16" y="20" textAnchor="middle" fill="currentColor" fontSize="10">+5</text>
          </svg>
        </button>
      </div>
      <div className="playback-seek">
        <span>{formatTime(time * 1000)}</span>
        <div className="playback-track">
          <input type="range" min="0" max={duration || 0} step="0.1"
            aria-label="Seek" disabled={uploading || !duration}
            value={Math.min(time, duration || 0)}
            onChange={(event) => seekTo(Number(event.target.value))} />
          {duration > 0 && notes.map((note) => (
            <button type="button" key={note.id} className="playback-dot"
              style={{ left: `${Math.min(100, (note.videoTimeMs / 1000 / duration) * 100)}%` }}
              title={`${formatTime(note.videoTimeMs)}  ${note.author}: ${note.body}`}
              aria-label={`Comment by ${note.author} at ${formatTime(note.videoTimeMs)}`}
              onClick={() => seekTo(note.videoTimeMs / 1000)} />
          ))}
        </div>
        <span>{formatTime(duration * 1000)}</span>
      </div>
      {pages > 1 && focusedPanel === null && (
        <span className="playback-pages" aria-live="polite">Page {page + 1} of {pages}</span>
      )}
      <form className="playback-comment" onSubmit={postComment}>
        <input value={commentText} maxLength={500}
          placeholder={`Comment at ${formatTime(time * 1000)}`}
          aria-label="New comment"
          onChange={(event) => setCommentText(event.target.value)} />
        <button type="submit" disabled={posting || !commentText.trim()}>
          {posting ? "Posting..." : "Post"}
        </button>
      </form>
      </div>
      {notesError && <p className="playback-comment-error" role="alert">{notesError}</p>}
    </section>
  );
}

/// Resolves true once every video can play from where it is without
/// stopping right away, or false if one still can't after `timeoutMs`.
function untilReady(videos, timeoutMs = 15000) {
  const HAVE_FUTURE_DATA = 3;
  const waiting = videos.filter((video) => video.readyState < HAVE_FUTURE_DATA);
  if (waiting.length === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    let left = waiting.length;
    const onReady = (event) => {
      event.currentTarget.removeEventListener("canplay", onReady);
      left -= 1;
      if (left === 0) {
        clearTimeout(timer);
        resolve(true);
      }
    };
    const timer = setTimeout(() => {
      waiting.forEach((video) => video.removeEventListener("canplay", onReady));
      resolve(false);
    }, timeoutMs);
    waiting.forEach((video) => video.addEventListener("canplay", onReady));
  });
}

// turns 83000 into "1:23"
function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const css = `
  .playback-page { max-width: 1600px; }
  .playback-page .playback-back { flex: 0 0 auto; color: var(--accent); font-size: 1.5rem; line-height: 1; text-decoration: none; }
  .playback-page h1 { flex: 1; min-width: 0; font-size: 1.4rem; margin: 0; overflow-wrap: anywhere; }
  .playback-title { display: flex; align-items: center; gap: 12px; margin-bottom: 0.75rem; }
  .playback-page .playback-download {
    flex: 0 0 auto; display: flex; align-items: center; justify-content: center;
    width: 38px; height: 38px; border-radius: 8px; color: var(--accent);
  }
  .playback-page .playback-download:hover { background: rgba(255,255,255,0.08); }
  .playback-box { position: relative; }
  .playback-box:fullscreen { background: #050505; padding: 10px 20px 8px; box-sizing: border-box; overflow: hidden; }
  .playback-box::backdrop { background: #050505; }
  .playback-fs-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
  .playback-fs-bar strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 1.05rem; }
  .playback-fs-tools { display: flex; align-items: center; gap: 10px; }
  /* Styled like the download icon beside it: just the icon, team color. */
  .playback-title-tools .playback-fullscreen, .playback-box .playback-fullscreen {
    display: inline-flex; align-items: center; justify-content: center;
    width: 38px; height: 38px; padding: 0; border: none; border-radius: 8px;
    background: transparent; color: var(--accent);
  }
  .playback-title-tools .playback-fullscreen:hover, .playback-box .playback-fullscreen:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .playback-top, .playback-controls, .playback-pages { display: flex; justify-content: center; align-items: center; gap: 12px; }
  .playback-top { margin-bottom: 0.6rem; }
  .playback-title-tools { display: flex; align-items: center; gap: 10px; }
  .playback-page h1 .playback-take { margin-left: 0.6rem; color: #999; font-size: 1rem; font-weight: 500; }
  .recording-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; flex: 1; }
  .recording-list a { display: flex; flex-direction: column; gap: 4px; color: inherit; text-decoration: none; border-radius: 10px; padding: 8px; }
  .recording-list a:hover, .recording-list a:focus-visible { background: rgba(255,255,255,0.06); }
  .recording-list strong { font-size: 1rem; }
  .recording-still { position: relative; aspect-ratio: 16 / 9; margin-bottom: 6px; border-radius: 8px; overflow: hidden; background: #1c1c1c; display: flex; align-items: center; justify-content: center; color: #777; font-size: 0.85rem; }
  .recording-still video { width: 100%; height: 100%; object-fit: cover; }
  .recording-meta { color: #999; font-size: 0.85rem; }
  .playback-title-tools select, .playback-title-tools button { font: inherit; color: #f0f0f0; background: #292929; border: 1px solid #555; border-radius: 6px; padding: 0.4rem 0.8rem; cursor: pointer; }
  .playback-title-tools button:disabled, .playback-title-tools select:disabled { opacity: 0.4; cursor: default; }
  @media (max-width: 900px) {
    .playback-transport { flex-wrap: wrap; }
    .playback-comment { flex-basis: 100%; }
    .playback-title { flex-wrap: wrap; }
    .playback-title-tools { order: 3; flex-basis: 100%; }
  }
  .playback-box select, .playback-box button { font: inherit; color: #f0f0f0; background: #292929; border: 1px solid #555; border-radius: 6px; padding: 0.4rem 0.8rem; }
  .playback-box button { cursor: pointer; }
  .playback-box button:disabled { opacity: 0.4; cursor: default; }
  /* Tiles are placed by layoutAngles (recording/angleLayout.js): each takes
     its video's shape, so there are no black bars inside it. */
  .playback-grid { position: relative; height: 70vh; min-height: 320px; overscroll-behavior-x: contain; touch-action: pan-y; }
  .playback-grid figure { position: absolute; margin: 0; display: flex; flex-direction: column; background: #000; border-radius: 6px; overflow: hidden; transition: left 0.2s, top 0.2s, width 0.2s, height 0.2s; }
  .playback-box .playback-panel-change { position: absolute; top: 6px; right: 6px; z-index: 3; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border-radius: 50%; }
  /* A tile's buttons show while the mouse is over it (or a key reaches
     them), so they don't sit on top of the video the rest of the time. */
  @media (hover: hover) {
    .playback-grid figure .playback-panel-change,
    .playback-grid figure .playback-audio { opacity: 0; transition: opacity 0.15s; }
    .playback-grid figure:hover .playback-panel-change,
    .playback-grid figure:hover .playback-audio,
    .playback-grid figure:focus-within .playback-panel-change,
    .playback-grid figure:focus-within .playback-audio { opacity: 1; }
  }
  /* Hidden, not unmounted: the other angles keep playing in sync offscreen. */
  .playback-audio { position: absolute; top: 6px; left: 6px; z-index: 3; display: flex; align-items: center; gap: 6px; max-width: calc(100% - 48px); }
  .playback-box .playback-audio button { display: flex; align-items: center; justify-content: center; flex: 0 0 28px; width: 28px; height: 28px; padding: 0; border-radius: 50%; }
  .playback-audio input { width: 100px; min-width: 0; margin: 0; accent-color: var(--accent); }
  .playback-grid video { display: block; width: 100%; flex: 1; min-height: 0; object-fit: contain; }
  .playback-missing { flex: 1; min-height: 0; }
  .playback-grid figcaption { position: absolute; left: 0; right: 0; bottom: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 3px 8px; background: rgba(0,0,0,0.55); color: #ddd; font-size: 0.7rem; pointer-events: none; }
  .playback-grid figcaption span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .playback-panel-picker { z-index: 2; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 220px; max-width: calc(100% - 24px); max-height: calc(100% - 16px); overflow: auto; padding: 4px; border: 1px solid #555; border-radius: 6px; background: #222; box-sizing: border-box; }
  .playback-panel-picker button { display: block; width: 100%; padding: 4px 8px; font-size: 0.65rem; text-align: left; border: none; }
  .playback-panel-picker button:hover, .playback-panel-picker button[aria-pressed="true"] { background: #444; }
  .playback-box .playback-add-video { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; padding: 0; border: none; border-radius: 0; background: transparent; font-size: 2rem; }
  .playback-box .playback-add-video:hover { background: rgba(255,255,255,0.04); }
  .playback-panel-picker label { display: block; margin-top: 8px; padding: 8px; background: #292929; font-size: 0.7rem; }
  .playback-panel-picker input { display: block; max-width: 100%; margin-top: 6px; font: inherit; }
  .playback-pages { flex: 0 0 auto; color: #999; font-size: 0.85rem; }
  .playback-box .playback-page-arrow {
    position: absolute; top: 50%; z-index: 4; transform: translateY(-50%);
    display: flex; align-items: center; justify-content: center;
    width: 48px; height: 96px; padding: 0; border: none; border-radius: 0;
    background: none; color: #fff; cursor: pointer;
    filter: drop-shadow(0 1px 4px rgba(0, 0, 0, 0.9));
    opacity: 0.75; transition: opacity 0.15s, transform 0.15s;
  }
  .playback-box .playback-page-arrow:hover, .playback-box .playback-page-arrow:focus-visible { opacity: 1; background: none; }
  .playback-live-note { min-height: 1.3rem; margin: 0.4rem 0 0; text-align: center; color: #f0f0f0; font-size: 0.85rem; overflow-wrap: anywhere; }
  .playback-live-note strong { color: var(--accent); }
  /* The timeline gets a full-width row; play, pages and the comment box sit
     under it, so none of them squeeze it. */
  .playback-transport { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; margin-top: 0.3rem; }
  .playback-transport .playback-seek { order: -1; flex: 1 1 100%; }
  .playback-transport .playback-controls { flex: 0 0 auto; gap: 6px; }
  .playback-seek { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; }
  .playback-seek span { color: #999; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
  .playback-buffering { margin: 0 0 0.5rem; text-align: center; color: #aaa; font-size: 0.85rem; }
  .playback-track { position: relative; flex: 1; min-width: 0; display: flex; align-items: center; }
  .playback-seek input { flex: 1; min-width: 0; margin: 0; accent-color: var(--accent); cursor: pointer; }
  /* A blue dot on the bar for each comment; click it to jump there. */
  .playback-box .playback-dot {
    position: absolute; top: 50%; width: 11px; height: 11px; padding: 0;
    border: 2px solid #0b0b0b; border-radius: 50%; background: #3b82f6;
    transform: translate(-50%, -50%); cursor: pointer;
  }
  .playback-box .playback-dot:hover { background: #60a5fa; transform: translate(-50%, -50%) scale(1.3); }
  .playback-box .playback-note-delete {
    margin-left: 8px; padding: 0 6px; border: none; background: transparent;
    color: #ff6b6b; font-size: 1rem; line-height: 1;
  }
  .playback-comment { display: flex; gap: 8px; flex: 0 1 360px; min-width: 200px; margin: 0 0 0 auto; }
  .playback-comment input {
    flex: 1; min-width: 0; padding: 0.45rem 0.6rem; border: 1px solid #555; border-radius: 6px;
    background: #292929; color: #f0f0f0; font: inherit; font-size: 0.9rem;
  }
  .playback-comment-error { margin: 0.5rem 0 0; text-align: center; color: #ff8a80; font-size: 0.85rem; }
  .playback-seek input:disabled { opacity: 0.4; cursor: default; }
  .playback-controls .playback-toggle, .playback-controls .playback-skip { display: flex; align-items: center; justify-content: center; width: 42px; height: 42px; padding: 0; border-radius: 50%; }
  .playback-empty { text-align: center; padding: 3rem 1rem; color: #999; }
  .playback-error { color: #ff8a80; text-align: center; }
  .playback-layout { position: relative; display: flex; align-items: flex-start; gap: 1rem; }
  .playback-layout > .playback-box { flex: 1; min-width: 0; }
  .playback-layout > p { flex: 1; }
  @media (max-width: 900px) {
    .playback-layout { flex-direction: column; justify-content: flex-start; }
  }
`;
