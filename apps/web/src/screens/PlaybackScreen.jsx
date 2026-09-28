import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useAuth } from "../auth/AuthContext.jsx";
import {
  createSessionNote,
  deleteSessionNote,
  getSessionNotes,
  getSessionVideos,
  uploadSessionVideo,
} from "../api/recordings.js";

export function PlaybackScreen() {
  const { sessionId } = useParams();
  const { user } = useAuth();
  const [session, setSession] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [recordingIndex, setRecordingIndex] = useState(0);
  const [notesOpen, setNotesOpen] = useState(true);
  const [notes, setNotes] = useState([]);
  const [notesError, setNotesError] = useState("");
  const videoTime = useRef(0);
  const seek = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setRecordingIndex(0);
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

  const startedAt = recordings[recordingIndex]?.startedAt;

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
      <Link to="/watch">← Watch</Link>
      {loading ? <p>Loading recordings...</p> : error ? (
        <p role="alert">{error}</p>
      ) : (
        <>
          <h1>{session.name}</h1>
          <div className="playback-layout">
            {recordings.length === 0 ? (
              <p>No videos have been uploaded for this session yet.</p>
            ) : (
              <>
                <SessionPlayer key={sessionId} recordings={recordings}
                  sessionId={sessionId} userId={Number(user.id)} onUploaded={setRecordings}
                  videoTime={videoTime} seek={seek} notes={notes}
                  recordingIndex={recordingIndex}
                  setRecordingIndex={setRecordingIndex} />
                {notesOpen ? (
                  <NotesPanel sessionId={sessionId} videoTime={videoTime}
                    startedAt={startedAt} notes={notes} setNotes={setNotes}
                    error={notesError} setError={setNotesError}
                    seek={seek} onHide={() => setNotesOpen(false)} />
                ) : (
                  <button type="button" className="notes-show" aria-label="Show notes"
                    title="Show notes" onClick={() => setNotesOpen(true)}>+</button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SessionPlayer({ recordings, sessionId, userId, onUploaded, videoTime, seek,
  notes, recordingIndex, setRecordingIndex }) {
  const [uploading, setUploading] = useState(false);
  const [page, setPage] = useState(0);
  const [panelLayouts, setPanelLayouts] = useState({});
  const [audioSettings, setAudioSettings] = useState({});
  const [openVolume, setOpenVolume] = useState(null);
  const [choosingPanel, setChoosingPanel] = useState(null);
  const [cameraPage, setCameraPage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [liveComments, setLiveComments] = useState(false);
  const [error, setError] = useState("");
  const videoRefs = useRef([]);
  const currentTime = useRef(0);
  const playRequest = useRef(0);
  const videos = recordings[recordingIndex].videos;
  const panels = panelLayouts[recordingIndex] || (videos.length ? videos.map((video) => video.userId) : [null]);
  const panelVideos = panels.map(
    (id) => videos.find((video) => video.userId === id) || null
  );
  const pages = Math.ceil(panels.length / 6);
  const liveNote = !liveComments ? null : notes.filter((note) => {
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

  const pause = () => {
    playRequest.current += 1;
    videoRefs.current.forEach((video) => video?.pause());
    setPlaying(false);
  };

  const play = async () => {
    const players = videoRefs.current.filter(Boolean);
    if (players.length === 0) return;
    const request = ++playRequest.current;
    setError("");
    if (players.every((video) => video.ended)) {
      players.forEach((video) => { video.currentTime = 0; });
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

  const seekTo = async (nextTime) => {
    const players = videoRefs.current.filter((video) => video && Number.isFinite(video.duration));
    if (players.length === 0) return;
    currentTime.current = nextTime;
    videoTime.current = nextTime;
    setTime(nextTime);
    players.forEach((video) => { video.currentTime = Math.min(nextTime, video.duration); });

    // A shorter video may have ended already; resume it when seeking back.
    if (playing) {
      const request = ++playRequest.current;
      try {
        await Promise.all(players.filter((video) => nextTime < video.duration).map((video) => video.play()));
      } catch {
        if (request !== playRequest.current) return;
        pause();
        setError("A video could not resume. Try pressing play again.");
      }
    }
  };

  // the notes panel jumps the player through this
  seek.current = seekTo;

  const skip = (seconds) => {
    const players = videoRefs.current.filter((video) => video && Number.isFinite(video.duration));
    if (players.length === 0) return;
    const longest = Math.max(...players.map((video) => video.duration));
    const from = Math.max(...players.map((video) => video.currentTime));
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
    const players = videoRefs.current.filter(Boolean);
    if (players.length) currentTime.current = Math.max(...players.map((video) => video.currentTime));
    pause();
    videoRefs.current = [];
    setDuration(0);
    setError("");
    setChoosingPanel(null);
    setOpenVolume(null);
    setPanelLayouts((current) => ({ ...current, [recordingIndex]: nextPanels }));
  };

  const addPanel = () => {
    updatePanels([...panels, null]);
    setPage(Math.floor(panels.length / 6));
  };

  const removePanel = (panelIndex) => {
    const settings = panels.map((_, index) => getPanelAudio(index));
    setAudioSettings((current) => ({
      ...current,
      [recordingIndex]: settings.filter((_, index) => index !== panelIndex),
    }));
    updatePanels(panels.filter((_, index) => index !== panelIndex));
    setPage(Math.min(page, Math.ceil((panels.length - 1) / 6) - 1));
  };

  const chooseVideo = (panelIndex, value) => {
    const nextPanels = [...panels];
    nextPanels[panelIndex] = value === "" ? null : Number(value);
    updatePanels(nextPanels);
  };

  const changePage = (nextPage) => {
    setPage(nextPage);
    setChoosingPanel(null);
    setOpenVolume(null);
  };

  const changeRecording = (event) => {
    pause();
    videoRefs.current = [];
    currentTime.current = 0;
    setTime(0);
    setDuration(0);
    setError("");
    setRecordingIndex(Number(event.target.value));
    setChoosingPanel(null);
    setOpenVolume(null);
    setPage(0);
  };

  return (
    <section className="playback-box">
      <label className="playback-live-toggle">
        <input type="checkbox" checked={liveComments}
          onChange={(event) => setLiveComments(event.target.checked)} />
        Live comments
      </label>
      <div className="playback-top">
        <select aria-label="Recording" disabled={uploading} value={recordingIndex} onChange={changeRecording}>
          {recordings.map((recording, index) => (
            <option key={recording.startedAt} value={index}>Recording {index + 1}</option>
          ))}
        </select>
        <button type="button" onClick={addPanel} disabled={uploading}
          aria-label="Add one panel">+1</button>
      </div>
      {panelVideos.length === 0 ? (
        <p className="playback-empty">No videos have been uploaded for this recording yet.</p>
      ) : Array.from({ length: pages }, (_, pageIndex) => {
        const pageVideos = panelVideos.slice(pageIndex * 6, pageIndex * 6 + 6);
        return (
        <div className={`playback-grid playback-grid-${pageVideos.length}`}
          hidden={pageIndex !== page} key={`${recordingIndex}-${pageIndex}-${panels.join(",")}`}>
          {pageVideos.map((video, index) => {
            const panelIndex = pageIndex * 6 + index;
            const audio = getPanelAudio(panelIndex);
            return (
            <figure key={pageIndex * 6 + index}>
              <button type="button" className="playback-panel-remove"
                aria-label={`Remove panel ${pageIndex * 6 + index + 1}`}
                disabled={uploading || panels.length === 1}
                onClick={() => removePanel(pageIndex * 6 + index)}>−</button>
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
                crossOrigin="use-credentials"
                preload="auto"
                playsInline
                muted={audio.muted}
                aria-label={video.name}
                onLoadedMetadata={(event) => {
                  const player = event.currentTarget;
                  player.currentTime = Math.min(currentTime.current, player.duration || 0);
                  setDuration((current) => Math.max(current, player.duration || 0));
                }}
                onTimeUpdate={(event) => {
                  videoTime.current = event.currentTarget.currentTime;
                  setTime(event.currentTarget.currentTime);
                }}
                onEnded={() => {
                  if (videoRefs.current.filter(Boolean).every((player) => player.ended)) {
                    setPlaying(false);
                  }
                }}
                onError={() => {
                  pause();
                  setError("A video could not load. Try refreshing the page.");
                }}
              /> : <div className="playback-missing" />}
              <button type="button" className="playback-add-video" disabled={uploading}
                aria-label={`${video?.url ? "Change" : "Choose"} video for panel ${pageIndex * 6 + index + 1}`}
                aria-expanded={choosingPanel === pageIndex * 6 + index}
                onClick={() => {
                  setCameraPage(0);
                  setChoosingPanel(choosingPanel === pageIndex * 6 + index ? null : pageIndex * 6 + index);
                }}>
                {!video?.url && choosingPanel !== pageIndex * 6 + index && "+"}
              </button>
              {choosingPanel === pageIndex * 6 + index && (
                <div className="playback-panel-picker" role="group"
                  aria-label={`Video for panel ${pageIndex * 6 + index + 1}`}
                  onKeyDown={(event) => { if (event.key === "Escape") setChoosingPanel(null); }}>
                  {videos.slice(cameraPage * 5, cameraPage * 5 + 5).map((option, optionIndex) => (
                    <button type="button" key={option.userId} autoFocus={optionIndex === 0}
                      disabled={uploading} aria-pressed={panels[pageIndex * 6 + index] === option.userId}
                      onClick={() => chooseVideo(pageIndex * 6 + index, option.userId)}>
                      {option.name}{option.url ? "" : " (not uploaded)"}
                    </button>
                  ))}
                  {videos.length > 5 && (
                    <div className="playback-camera-pages">
                      <button type="button" aria-label="Previous cameras" disabled={cameraPage === 0}
                        onClick={() => setCameraPage(cameraPage - 1)}>↑</button>
                      <button type="button" aria-label="More cameras" disabled={(cameraPage + 1) * 5 >= videos.length}
                        onClick={() => setCameraPage(cameraPage + 1)}>↓</button>
                    </div>
                  )}
                  <button type="button" disabled={uploading}
                    onClick={() => chooseVideo(pageIndex * 6 + index, "")}>Empty panel</button>
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
        </div>
        );
      })}
      {error && <p className="playback-error" role="alert">{error}</p>}
      {pages > 1 && (
        <div className="playback-pages">
          <button type="button" aria-label="Previous video page" disabled={uploading || page === 0}
            onClick={() => changePage(page - 1)}>‹</button>
          <span>{page + 1} / {pages}</span>
          <button type="button" aria-label="Next video page" disabled={uploading || page + 1 === pages}
            onClick={() => changePage(page + 1)}>›</button>
        </div>
      )}
      {liveComments && (
        <p className="playback-live-note">
          {liveNote && <><strong>{liveNote.author}:</strong> "{liveNote.body}"</>}
        </p>
      )}
      <div className="playback-seek">
        <span>{formatTime(time * 1000)}</span>
        <input type="range" min="0" max={duration || 0} step="0.1"
          aria-label="Seek" disabled={uploading || !duration}
          value={Math.min(time, duration || 0)}
          onChange={(event) => seekTo(Number(event.target.value))} />
        <span>{formatTime(duration * 1000)}</span>
      </div>
      <div className="playback-controls">
        <button type="button" className="playback-skip" aria-label="Back 5 seconds" onClick={() => skip(-5)}
          disabled={uploading || !panelVideos.some((video) => video?.url)}>
          <svg viewBox="0 0 32 32" width="36" height="36" aria-hidden="true">
            <path d="M7 9a11 11 0 1 1-2 13M7 3v6h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <text x="16" y="20" textAnchor="middle" fill="currentColor" fontSize="10">−5</text>
          </svg>
        </button>
        <button type="button" className="playback-toggle"
          aria-label={playing ? "Pause" : "Play"}
          onClick={playing ? pause : play}
          disabled={uploading || !panelVideos.some((video) => video?.url)}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
            {playing ? <path d="M6 4h4v16H6zM14 4h4v16h-4z" /> : <path d="M7 4v16l13-8z" />}
          </svg>
        </button>
        <button type="button" className="playback-skip" aria-label="Forward 5 seconds" onClick={() => skip(5)}
          disabled={uploading || !panelVideos.some((video) => video?.url)}>
          <svg viewBox="0 0 32 32" width="36" height="36" aria-hidden="true">
            <path d="M25 9a11 11 0 1 0 2 13M25 3v6h-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <text x="16" y="20" textAnchor="middle" fill="currentColor" fontSize="10">+5</text>
          </svg>
        </button>
      </div>
    </section>
  );
}

// turns 83000 into "1:23"
function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function NotesPanel({ sessionId, videoTime, startedAt, notes, setNotes,
  error, setError, seek, onHide }) {
  const [text, setText] = useState("");

  const addNote = async () => {
    const body = text.trim();
    if (!body) return;
    setError("");
    try {
      // videoTime holds wherever the player is right now, so the note is
      // stamped with the moment it is about.
      await createSessionNote(sessionId, startedAt, body, Math.round(videoTime.current * 1000));
      setNotes(await getSessionNotes(sessionId, startedAt));
      setText("");
    } catch (err) {
      setError(err.message);
    }
  };

  const removeNote = async (noteId) => {
    setError("");
    try {
      await deleteSessionNote(sessionId, noteId);
      setNotes((current) => current.filter((note) => note.id !== noteId));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="notes-box">
      <div className="notes-top">
        <h2>Notes</h2>
        <button type="button" className="notes-hide" aria-label="Hide notes"
          title="Hide notes" onClick={onHide}>−</button>
      </div>
      <div className="notes-list">
        {notes.length === 0 ? (
          <p className="notes-empty">No notes yet.</p>
        ) : notes.map((note) => (
          <div className="notes-item" key={note.id}>
            <button type="button" className="notes-jump"
              title="Jump to this moment"
              onClick={() => seek.current?.(note.videoTimeMs / 1000)}>
              <span className="notes-item-top">
                <strong>{note.author}</strong>
                <time>{formatTime(note.videoTimeMs)}</time>
              </span>
              <span className="notes-body">{note.body}</span>
            </button>
            {note.canDelete && (
              <button type="button" className="notes-delete"
                aria-label={`Delete note by ${note.author}`}
                onClick={() => removeNote(note.id)}>×</button>
            )}
          </div>
        ))}
      </div>
      {error && <p className="notes-error" role="alert">{error}</p>}
      <div className="notes-add">
        <input value={text} placeholder="Type a note" maxLength={500}
          aria-label="New note"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") addNote(); }} />
        <button type="button" aria-label="Add note"
          disabled={!text.trim()} onClick={addNote}>+</button>
      </div>
    </section>
  );
}

const css = `
  .playback-page { max-width: 1600px; }
  .playback-page > a { color: #f2cb05; }
  .playback-page h1 { font-size: 1.4rem; margin: 1rem 0; overflow-wrap: anywhere; }
  .playback-box { position: relative; background: #1c1c1c; border: 1px solid #303030; border-radius: 12px; padding: 1rem; }
  .playback-top, .playback-controls, .playback-pages { display: flex; justify-content: center; align-items: center; gap: 12px; }
  .playback-top { margin-bottom: 1rem; }
  .playback-box select, .playback-box button { font: inherit; color: #f0f0f0; background: #292929; border: 1px solid #555; border-radius: 6px; padding: 0.4rem 0.8rem; }
  .playback-box button { cursor: pointer; }
  .playback-box button:disabled { opacity: 0.4; cursor: default; }
  .playback-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); gap: 12px; height: 70vh; }
  .playback-grid[hidden] { display: none; }
  .playback-grid figure { position: relative; margin: 0; min-width: 0; min-height: 0; display: flex; flex-direction: column; grid-column: span 6; background: #000; border-radius: 6px; overflow: hidden; }
  .playback-box .playback-panel-remove { position: absolute; top: 6px; right: 6px; z-index: 3; width: 28px; height: 28px; padding: 0; border-radius: 50%; }
  .playback-audio { position: absolute; top: 6px; left: 6px; z-index: 3; display: flex; align-items: center; gap: 6px; max-width: calc(100% - 48px); }
  .playback-box .playback-audio button { display: flex; align-items: center; justify-content: center; flex: 0 0 28px; width: 28px; height: 28px; padding: 0; border-radius: 50%; }
  .playback-audio input { width: 100px; min-width: 0; margin: 0; accent-color: #f2cb05; }
  .playback-grid video { display: block; width: 100%; flex: 1; min-height: 0; object-fit: contain; }
  .playback-missing { flex: 1; min-height: 0; }
  .playback-grid figcaption { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 8px; color: #aaa; font-size: 0.7rem; }
  .playback-grid figcaption span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .playback-panel-picker { z-index: 2; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 220px; max-width: calc(100% - 24px); max-height: calc(100% - 16px); overflow: auto; padding: 4px; border: 1px solid #555; border-radius: 6px; background: #222; box-sizing: border-box; }
  .playback-panel-picker button { display: block; width: 100%; padding: 4px 8px; font-size: 0.65rem; text-align: left; border: none; }
  .playback-panel-picker button:hover, .playback-panel-picker button[aria-pressed="true"] { background: #444; }
  .playback-camera-pages { display: flex; }
  .playback-camera-pages button { text-align: center; }
  .playback-box .playback-add-video { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; padding: 0; border: none; border-radius: 0; background: transparent; font-size: 2rem; }
  .playback-box .playback-add-video:hover { background: rgba(255,255,255,0.04); }
  .playback-panel-picker label { display: block; margin-top: 8px; padding: 8px; background: #292929; font-size: 0.7rem; }
  .playback-panel-picker input { display: block; max-width: 100%; margin-top: 6px; font: inherit; }
  .playback-grid-1 { grid-template-rows: minmax(0, 1fr); }
  .playback-grid-1 figure, .playback-grid-2 figure { grid-column: span 12; }
  .playback-grid-3 figure:last-child { grid-column: 4 / span 6; }
  .playback-grid-5 figure, .playback-grid-6 figure { grid-column: span 4; }
  .playback-grid-5 figure:first-child { grid-column: 3 / span 4; }
  .playback-grid-5 figure:nth-child(2) { grid-column: 7 / span 4; }
  .playback-grid-5 figure:nth-child(3) { grid-column: 1 / span 4; }
  .playback-controls, .playback-pages { margin-top: 1rem; }
  .playback-live-toggle { position: absolute; top: 1rem; left: 1rem; z-index: 1; display: flex; align-items: center; gap: 6px; color: #aaa; font-size: 0.75rem; cursor: pointer; }
  .playback-live-toggle input { margin: 0; accent-color: #f2cb05; cursor: pointer; }
  .playback-live-note { min-height: 1.3rem; margin: 0.75rem 0 0; text-align: center; color: #f0f0f0; font-size: 0.85rem; overflow-wrap: anywhere; }
  .playback-live-note strong { color: #f2cb05; }
  .playback-live-note + .playback-seek { margin-top: 0.5rem; }
  .playback-seek { display: flex; align-items: center; gap: 10px; margin-top: 1rem; }
  .playback-seek span { color: #999; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
  .playback-seek input { flex: 1; min-width: 0; margin: 0; accent-color: #f2cb05; cursor: pointer; }
  .playback-seek input:disabled { opacity: 0.4; cursor: default; }
  .playback-seek + .playback-controls { margin-top: 0.5rem; }
  .playback-controls .playback-toggle, .playback-controls .playback-skip { display: flex; align-items: center; justify-content: center; width: 52px; height: 52px; padding: 0; border-radius: 50%; }
  .playback-empty { text-align: center; padding: 3rem 1rem; color: #999; }
  .playback-error { color: #ff8a80; text-align: center; }
  .playback-layout { position: relative; display: flex; align-items: flex-start; gap: 1rem; }
  .playback-layout > .playback-box { flex: 1; min-width: 0; }
  .playback-layout > p { flex: 1; }
  .notes-box { display: flex; flex-direction: column; flex: 0 0 340px; align-self: stretch; background: #1c1c1c; border: 1px solid #303030; border-radius: 12px; padding: 1rem; box-sizing: border-box; }
  .notes-top { display: flex; align-items: center; gap: 8px; margin-bottom: 0.75rem; }
  .notes-top h2 { flex: 1; margin: 0; font-size: 1.1rem; }
  .notes-box .notes-hide, .notes-show { width: 28px; height: 28px; padding: 0; display: flex; align-items: center; justify-content: center; border: 1px solid #555; border-radius: 6px; background: #292929; color: #f0f0f0; font: inherit; font-size: 1rem; line-height: 1; cursor: pointer; }
  .notes-show { position: absolute; top: 0; right: 0; }
  .notes-box .notes-hide:hover, .notes-show:hover { background: #3a3a3a; }
  .notes-list { flex: 1; min-height: 120px; overflow-y: auto; }
  .notes-empty { margin: 0; color: #999; font-size: 0.85rem; }
  .notes-item { position: relative; border-bottom: 1px solid #2a2a2a; }
  .notes-box .notes-jump { display: block; width: 100%; padding: 8px; border: none; border-radius: 6px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .notes-box .notes-jump:hover { background: #262626; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45); }
  .notes-item-top { display: flex; align-items: center; gap: 8px; padding-right: 22px; }
  .notes-item-top strong { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 0.8rem; }
  .notes-item-top time { color: #f2cb05; font-size: 0.75rem; }
  .notes-box .notes-delete { position: absolute; top: 8px; right: 6px; width: 22px; height: 22px; padding: 0; display: flex; align-items: center; justify-content: center; border: none; border-radius: 4px; background: transparent; color: #ff6b6b; font-size: 1rem; line-height: 1; cursor: pointer; }
  .notes-box .notes-delete:hover { background: #472222; }
  .notes-body { display: block; margin-top: 4px; color: #ddd; font-size: 0.85rem; line-height: 1.4; overflow-wrap: anywhere; }
  .notes-error { margin: 8px 0 0; color: #ff8a80; font-size: 0.8rem; }
  .notes-add { display: flex; gap: 8px; margin-top: 0.75rem; }
  .notes-add input { flex: 1; min-width: 0; padding: 0.4rem; border: 1px solid #555; border-radius: 6px; background: #292929; color: #f0f0f0; font: inherit; font-size: 0.85rem; }
  .notes-add button { flex: 0 0 auto; width: 34px; padding: 0; border: 1px solid #555; border-radius: 6px; background: #292929; color: #f0f0f0; font-size: 1.1rem; cursor: pointer; }
  .notes-add button:disabled { opacity: 0.4; cursor: default; }
  @media (max-width: 900px) {
    .playback-layout { flex-direction: column; justify-content: flex-start; }
    .notes-box { flex: 1 1 auto; width: 100%; }
  }
`;
