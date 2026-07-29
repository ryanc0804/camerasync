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
