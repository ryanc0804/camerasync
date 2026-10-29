const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

// sends api requests with the login cookie
async function request(path, options = {}) {
  const response = await fetch(`${SERVER_URL}${path}`, {
    credentials: "include",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    ...options,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Something went wrong.");
  }
  return data;
}

// counts the signed-in user's uploaded videos
export async function getMyVideoCount() {
  const data = await request("/api/recordings/my-video-count");
  return data.count;
}

// loads sessions visible to the current user
export async function getSessions() {
  const data = await request("/api/recordings/sessions");
  for (const session of data.sessions) {
    if (session.thumbnailUrl) session.thumbnailUrl = `${SERVER_URL}${session.thumbnailUrl}`;
  }
  return data.sessions;
}

// creates either a scheduled or live session
export async function scheduleSession(session) {
  const data = await request("/api/recordings/sessions", {
    method: "POST",
    body: JSON.stringify(session),
  });
  return data.session;
}

export async function createLiveSession(session) {
  const data = await request("/api/recordings/sessions/live", {
    method: "POST",
    body: JSON.stringify(session),
  });
  return data.session;
}

// updates session membership and status
export async function joinSession(id) {
  const data = await request(
    `/api/recordings/sessions/${encodeURIComponent(id)}/join`,
    { method: "POST" }
  );
  return data.session;
}

export async function leaveSession(id) {
  await request(
    `/api/recordings/sessions/${encodeURIComponent(id)}/join`,
    { method: "DELETE" }
  );
}

export async function endSession(id) {
  const data = await request(
    `/api/recordings/sessions/${encodeURIComponent(id)}/end`,
    { method: "PATCH" }
  );
  return data.session;
}

export async function cancelSession(id) {
  const data = await request(
    `/api/recordings/sessions/${encodeURIComponent(id)}/cancel`,
    { method: "PATCH" }
  );
  return data.session;
}

// startedAt is the take's shared start; actualStartedAt (optional) is when
// this device's camera really began, both on the server clock. Playback
// shifts the angle by the difference to line it up with the others.
// startClock says what actualStartedAt is: "frame" for the first frame's
// capture time, "call" for when the recorder said it started.
export async function saveRecordingDetails(id, startedAt, actualStartedAt, startClock) {
  await request(`/api/recordings/sessions/${encodeURIComponent(id)}/videos`, {
    method: "POST",
    body: JSON.stringify({ startedAt, actualStartedAt, startClock }),
  });
}

export async function getSessionVideos(id) {
  const data = await request(`/api/recordings/sessions/${encodeURIComponent(id)}/videos`);
  for (const recording of data.recordings) {
    for (const video of recording.videos) {
      if (video.url) video.url = `${SERVER_URL}${video.url}`;
      if (video.previewUrl) video.previewUrl = `${SERVER_URL}${video.previewUrl}`;
    }
  }
  return data;
}

// The whole session as one zip (a folder per recording, an angle per
// member), for keeping on a computer or USB stick. A plain link: the
// browser downloads it with the login cookie.
export function sessionDownloadUrl(id) {
  return `${SERVER_URL}/api/recordings/sessions/${encodeURIComponent(id)}/download`;
}

export async function uploadSessionVideo(
  id, startedAt, video, filename, actualStartedAt, startClock
) {
  const body = new FormData();
  // Multipart uploads need the plain media type, without recorder codec details.
  const upload = new Blob([video], { type: video.type.split(";")[0] });
  body.append("file", upload, filename);
  const actual = Number.isFinite(actualStartedAt)
    ? `&actualStartedAt=${Math.round(actualStartedAt)}${startClock ? `&startClock=${startClock}` : ""}`
    : "";
  // XMLHttpRequest rather than fetch: it reports upload progress, which
  // goes to the server every few seconds for the bars viewers see.
  let reportedAt = 0;
  const { status, data } = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST",
      `${SERVER_URL}/api/files/upload?sessionId=${encodeURIComponent(id)}&startedAt=${startedAt}${actual}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || Date.now() - reportedAt < PROGRESS_EVERY_MS) return;
      reportedAt = Date.now();
      reportUploadProgress(id, startedAt, "full", event.loaded / event.total).catch(() => {});
    };
    xhr.onload = () => {
      let parsed = null;
      try { parsed = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      resolve({ status: xhr.status, data: parsed });
    };
    xhr.onerror = () => reject(new Error("Could not upload this recording."));
    xhr.send(body);
  });
  if (status < 200 || status >= 300) {
    throw new Error(data?.error || "Could not upload this recording.");
  }
}

// Often enough for the bars to look alive, rarely enough not to compete
// with the upload on a slow connection.
const PROGRESS_EVERY_MS = 3000;

// How far along this device's upload of one angle is (stage "preview" or
// "full"), for the progress bars under angles still uploading.
export async function reportUploadProgress(id, startedAt, stage, fraction) {
  // No reply body (204), so not through request().
  await fetch(`${SERVER_URL}/api/recordings/sessions/${encodeURIComponent(id)}/upload-progress`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startedAt, stage, fraction }),
  });
}

export async function deleteSession(id) {
  await request(`/api/recordings/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// loads the notes left on one recording of a session
export async function getSessionNotes(id, startedAt) {
  const data = await request(
    `/api/recordings/sessions/${encodeURIComponent(id)}/notes?startedAt=${startedAt}`
  );
  return data.notes;
}

// adds a note at a point in that recording
export async function createSessionNote(id, startedAt, body, videoTimeMs) {
  await request(`/api/recordings/sessions/${encodeURIComponent(id)}/notes`, {
    method: "POST",
    body: JSON.stringify({ startedAt, body, videoTimeMs }),
  });
}

export async function deleteSessionNote(id, noteId) {
  await request(
    `/api/recordings/sessions/${encodeURIComponent(id)}/notes/${noteId}`,
    { method: "DELETE" }
  );
}
