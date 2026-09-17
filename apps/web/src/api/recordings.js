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

export async function saveRecordingDetails(id, startedAt) {
  await request(`/api/recordings/sessions/${encodeURIComponent(id)}/videos`, {
    method: "POST",
    body: JSON.stringify({ startedAt }),
  });
}

export async function getSessionVideos(id) {
  const data = await request(`/api/recordings/sessions/${encodeURIComponent(id)}/videos`);
  for (const recording of data.recordings) {
    for (const video of recording.videos) {
      if (video.url) video.url = `${SERVER_URL}${video.url}`;
    }
  }
  return data;
}

export async function uploadSessionVideo(id, startedAt, video, filename) {
  const body = new FormData();
  // Multipart uploads need the plain media type, without recorder codec details.
  const upload = new Blob([video], { type: video.type.split(";")[0] });
  body.append("file", upload, filename);
  const response = await fetch(
    `${SERVER_URL}/api/files/upload?sessionId=${encodeURIComponent(id)}&startedAt=${startedAt}`,
    { method: "POST", credentials: "include", body }
  );
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "Could not upload this recording.");
  }
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
