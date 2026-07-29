//backend URL used by the web app
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

//send a request with the user's login cookie
async function request(path, options = {}) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    credentials: "include",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    ...options,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Something went wrong.");
  }
  return data;
}

//get the groups the current user belongs to
export async function getGroups() {
  const data = await request("/api/groups");
  return data.groups;
}

//create a new group
export async function createGroup(group) {
  const data = await request("/api/groups", {
    method: "POST",
    body: JSON.stringify(group),
  });
  return data.group;
}

//search for groups by ID
export async function searchGroups(query) {
  const data = await request(
    `/api/groups/search?q=${encodeURIComponent(query)}`
  );
  return data.groups;
}

//join a public or private group
export async function joinGroup(id, password = "") {
  const data = await request(`/api/groups/${encodeURIComponent(id)}/join`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  return data.group;
}
