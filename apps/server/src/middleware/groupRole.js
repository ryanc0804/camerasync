import { pool } from "../db/pool.js";

// Group roles, weakest to strongest. Permission checks compare ranks
// ("at least a member") instead of listing role names at every call site.
// "owner" is not a stored role — the group owner keeps an admin row and the
// lookups below map them to it so they outrank the other admins.
export const ROLE_RANK = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

export function atLeast(role, minRole) {
  return (ROLE_RANK[role] ?? 0) >= ROLE_RANK[minRole];
}

/// The user's effective role in a group, or null when they are not a member.
export async function getGroupRole(groupId, userId) {
  const { rows } = await pool.query(
    `SELECT gm.role, g.owner_id
       FROM group_members gm
       JOIN groups g ON g.group_id = gm.group_id
      WHERE gm.group_id = $1
        AND gm.user_id = $2`,
    [groupId, userId]
  );
  if (rows.length === 0) return null;
  return Number(rows[0].owner_id) === Number(userId) ? "owner" : rows[0].role;
}

/// Same lookup, but keyed by the recording session that belongs to the group.
export async function getSessionRole(sessionId, userId) {
  const { rows } = await pool.query(
    `SELECT gm.role, g.owner_id
       FROM recording_sessions rs
       JOIN groups g ON g.group_id = rs.group_id
       JOIN group_members gm
         ON gm.group_id = rs.group_id AND gm.user_id = $2
      WHERE rs.id = $1`,
    [sessionId, userId]
  );
  if (rows.length === 0) return null;
  return Number(rows[0].owner_id) === Number(userId) ? "owner" : rows[0].role;
}
