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

//get the roster for one of your groups
export async function getGroupMembers(id) {
  const data = await request(`/api/groups/${encodeURIComponent(id)}/members`);
  return data.members;
}

//create a new group
export async function createGroup(group) {
  const data = await request("/api/groups", {
    method: "POST",
    body: JSON.stringify(group),
  });
  return data.group;
}

// Rename the group or change its privacy and password (owner only). A
// private group needs a password unless it already has one.
export async function updateGroupDetails(id, { name, isPublic, password }) {
  const data = await request(`/api/groups/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ name, isPublic, ...(password ? { password } : {}) }),
  });
  return data.group;
}

// What an invite link shows before joining: name, color, and whether the
// group needs a password.
export async function getGroupInvite(id) {
  const data = await request(`/api/groups/${encodeURIComponent(id)}/invite`);
  return data.group;
}

// Leave a group. The owner has to hand it to someone else first.
export async function leaveGroup(id) {
  await request(`/api/groups/${encodeURIComponent(id)}/leave`, { method: "POST" });
}

// Make another member the owner (owner only); the old owner stays an admin.
export async function transferGroup(id, userId) {
  const data = await request(`/api/groups/${encodeURIComponent(id)}/transfer`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
  return data.group;
}

// Delete the group with all its sessions and recordings (owner only).
export async function deleteGroup(id) {
  await request(`/api/groups/${encodeURIComponent(id)}`, { method: "DELETE" });
}

//change a group's team color (admins and the owner only)
export async function updateGroupColor(id, primaryColor) {
  const data = await request(`/api/groups/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ primaryColor }),
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

export async function changeGroupMemberRole(groupId, memberId, role) {
  await request(`/api/groups/${encodeURIComponent(groupId)}/members/${memberId}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export async function removeGroupMember(groupId, memberId) {
  await request(`/api/groups/${encodeURIComponent(groupId)}/members/${memberId}`, {
    method: "DELETE",
  });
}

// The user's primary group, whose color the app takes: the one saved on the
// account (Settings or a group's page), or else the first group they joined.
export function getPrimaryGroupId(user, groups) {
  const saved = user?.primaryGroupId;
  if (saved && groups.some((group) => group.id === saved)) return saved;
  let firstGroup = null;
  for (const group of groups) {
    if (!firstGroup || new Date(group.joinedAt || group.createdAt) <
        new Date(firstGroup.joinedAt || firstGroup.createdAt)) {
      firstGroup = group;
    }
  }
  return firstGroup?.id || "";
}
