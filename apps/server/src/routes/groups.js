import { Router } from "express";
import bcrypt from "bcryptjs";

import { pool } from "../db/pool.js";
import { removeMemberFromGroupSessions } from "../sockets/websocket.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { ROLE_RANK, atLeast, getGroupRole } from "../middleware/groupRole.js";
import { DEFAULT_TEAM_COLOR, teamColor } from "../groups/teamColors.js";

export const groupRouter = Router();

//group IDs can only use letters and numbers
const GROUP_ID_PATTERN = /^[A-Za-z0-9]+$/;
const COLOR_ERROR = "Pick one of the team colors.";

//shape a group before sending it to the frontend
function publicGroup(row) {
  return {
    id: row.group_id,
    name: row.name,
    isPublic: row.is_public,
    owner: Number(row.owner_id),
    primaryColor: row.primary_color,
    createdAt: row.created_at,
    joinedAt: row.joined_at,
    role: row.role,
  };
}

//shape the smaller group search result
function groupSearchResult(row) {
  return {
    id: row.group_id,
    name: row.name,
    isPublic: row.is_public,
    isMember: row.is_member,
  };
}

//all group routes require a logged-in user
groupRouter.use(requireAuth);

//get every group the current user belongs to
groupRouter.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.group_id, g.name, g.is_public, g.owner_id,
              g.primary_color, g.created_at, gm.role, gm.joined_at
         FROM groups g
         JOIN group_members gm ON gm.group_id = g.group_id
        WHERE gm.user_id = $1
        ORDER BY g.created_at DESC`,
      [req.user.id]
    );

    res.json({ groups: rows.map(publicGroup) });
  } catch (err) {
    console.error("Unable to load groups:", err);
    res.status(500).json({ error: "Unable to load groups." });
  }
});

//search for up to five groups by ID
groupRouter.get("/search", async (req, res) => {
  const query = String(req.query.q ?? "").trim();

  if (!query) {
    return res.json({ groups: [] });
  }
  if (!GROUP_ID_PATTERN.test(query)) {
    return res.status(400).json({
      error: "Group ID must contain only letters and numbers.",
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT g.group_id, g.name, g.is_public,
              EXISTS (
                SELECT 1
                  FROM group_members gm
                 WHERE gm.group_id = g.group_id
                   AND gm.user_id = $2
              ) AS is_member
         FROM groups g
        WHERE LOWER(g.group_id) LIKE '%' || LOWER($1) || '%'
        ORDER BY
          CASE
            WHEN LOWER(g.group_id) = LOWER($1) THEN 0
            WHEN LOWER(g.group_id) LIKE LOWER($1) || '%' THEN 1
            ELSE 2
          END,
          LENGTH(g.group_id),
          g.group_id
        LIMIT 5`,
      [query, req.user.id]
    );

    res.json({ groups: rows.map(groupSearchResult) });
  } catch (err) {
    console.error("Unable to search groups:", err);
    res.status(500).json({ error: "Unable to search groups." });
  }
});

//list members in join order, with the creator first
groupRouter.get("/:id/members", async (req, res) => {
  try {
    const membership = await pool.query(
      "SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2",
      [req.params.id, req.user.id]
    );
    if (membership.rows.length === 0) {
      return res.status(403).json({ error: "Join this group to view its roster." });
    }

    const { rows } = await pool.query(
      `SELECT u.user_id, u.display_name, gm.role
         FROM group_members gm
         JOIN users u ON u.user_id = gm.user_id
         JOIN groups g ON g.group_id = gm.group_id
        WHERE gm.group_id = $1
        ORDER BY (gm.user_id = g.owner_id) DESC, gm.joined_at, gm.user_id`,
      [req.params.id]
    );
    res.json({ members: rows.map((row) => ({
      id: Number(row.user_id),
      name: row.display_name || "Unnamed member",
      role: row.role,
    })) });
  } catch (err) {
    console.error("Unable to load roster:", err);
    res.status(500).json({ error: "Unable to load roster." });
  }
});

// Rank rules: you need to outrank someone to change or remove them, and you
// can never hand out a role above your own. So the owner manages everyone,
// admins manage members and viewers (including promoting them to admin), and
// nobody touches the owner.
async function changeMember(req, res) {
  const memberId = Number(req.params.memberId);
  const removing = req.method === "DELETE";
  const role = req.body?.role;
  if (!Number.isSafeInteger(memberId) || memberId <= 0 ||
      (!removing && !["admin", "member", "viewer"].includes(role))) {
    return res.status(400).json({ error: "Invalid member or role." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Keep simultaneous role changes from using outdated permissions.
    const { rows: groups } = await client.query(
      "SELECT owner_id FROM groups WHERE group_id = $1 FOR UPDATE",
      [req.params.id]
    );
    const { rows: members } = await client.query(
      "SELECT user_id, role FROM group_members WHERE group_id = $1 AND user_id IN ($2, $3)",
      [req.params.id, req.user.id, memberId]
    );
    const actor = members.find((member) => Number(member.user_id) === Number(req.user.id));
    const target = members.find((member) => Number(member.user_id) === memberId);
    const ownerId = Number(groups[0]?.owner_id);
    const actorRole =
      Number(req.user.id) === ownerId ? "owner" : actor?.role;
    const allowed = actor && target && memberId !== ownerId &&
      atLeast(actorRole, "admin") &&
      ROLE_RANK[actorRole] > (ROLE_RANK[target.role] ?? 0) &&
      (removing || ROLE_RANK[role] <= ROLE_RANK[actorRole]);
    if (!allowed) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "You cannot change this member." });
    }

    if (removing) {
      await client.query("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2",
        [req.params.id, memberId]);
      await client.query(
        `DELETE FROM recording_session_members rsm USING recording_sessions rs
          WHERE rsm.session_id = rs.id AND rs.group_id = $1 AND rsm.user_id = $2`,
        [req.params.id, memberId]
      );
    } else {
      await client.query("UPDATE group_members SET role = $3 WHERE group_id = $1 AND user_id = $2",
        [req.params.id, memberId, role]);
    }
    await client.query("COMMIT");
    if (removing) await removeMemberFromGroupSessions(req.params.id, memberId);
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Unable to update member:", err);
    res.status(500).json({ error: "Unable to update member." });
  } finally {
    client.release();
  }
}

groupRouter.patch("/:id/members/:memberId", changeMember);
groupRouter.delete("/:id/members/:memberId", changeMember);

//create a group and make its owner an admin
groupRouter.post("/", async (req, res) => {
  const id = String(req.body?.id ?? "").trim();
  const name = String(req.body?.name ?? "").trim();
  const isPublic = req.body?.isPublic;
  const password = String(req.body?.password ?? "");
  const primaryColor = teamColor(req.body?.primaryColor ?? DEFAULT_TEAM_COLOR);

  if (!name) {
    return res.status(400).json({ error: "Group name is required." });
  }
  if (!id || !GROUP_ID_PATTERN.test(id)) {
    return res.status(400).json({
      error: "Group ID must contain only letters and numbers.",
    });
  }
  if (typeof isPublic !== "boolean") {
    return res.status(400).json({ error: "Group visibility is required." });
  }
  if (!isPublic && !password.trim()) {
    return res.status(400).json({
      error: "Private groups require a password.",
    });
  }
  if (!primaryColor) {
    return res.status(400).json({ error: COLOR_ERROR });
  }

  //public groups do not save a password
  const passwordHash = isPublic
    ? null
    : await bcrypt.hash(password, 12);

  //save the group and owner membership together
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const { rows } = await client.query(
      `INSERT INTO groups (
         group_id, name, is_public, password_hash, owner_id, primary_color
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING group_id, name, is_public, owner_id,
                 primary_color, created_at`,
      [id, name, isPublic, passwordHash, req.user.id, primaryColor]
    );

    await client.query(
      `INSERT INTO group_members (group_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [id, req.user.id]
    );

    await client.query("COMMIT");
    res.status(201).json({
      group: publicGroup({ ...rows[0], role: "admin" }),
    });
  } catch (err) {
    if (client) await client.query("ROLLBACK");

    if (err.code === "23505") {
      return res.status(409).json({ error: "That group ID already exists." });
    }

    console.error("Unable to create group:", err);
    res.status(500).json({ error: "Unable to create group." });
  } finally {
    client?.release();
  }
});

//change a group's team color (SCRUM-71); admins and the owner only
groupRouter.patch("/:id", async (req, res) => {
  if (req.body?.primaryColor === undefined) {
    return res.status(400).json({ error: "Nothing to update." });
  }
  const primaryColor = teamColor(req.body.primaryColor);
  if (!primaryColor) {
    return res.status(400).json({ error: COLOR_ERROR });
  }

  try {
    const role = await getGroupRole(req.params.id, req.user.id);
    if (!atLeast(role, "admin")) {
      return res.status(403).json({
        error: "Only group admins can change the team colors.",
      });
    }

    const { rows } = await pool.query(
      `UPDATE groups g
          SET primary_color = $2
         FROM group_members gm
        WHERE g.group_id = $1
          AND gm.group_id = g.group_id
          AND gm.user_id = $3
        RETURNING g.group_id, g.name, g.is_public, g.owner_id,
                  g.primary_color, g.created_at, gm.role, gm.joined_at`,
      [req.params.id, primaryColor, req.user.id]
    );
    res.json({ group: publicGroup(rows[0]) });
  } catch (err) {
    console.error("Unable to update group:", err);
    res.status(500).json({ error: "Unable to update group." });
  }
});

//join a group and check its password when private
groupRouter.post("/:id/join", async (req, res) => {
  const id = String(req.params.id ?? "").trim();
  const password = String(req.body?.password ?? "");

  if (!id || !GROUP_ID_PATTERN.test(id)) {
    return res.status(400).json({ error: "Group ID is invalid." });
  }

  try {
    const { rows } = await pool.query(
      `SELECT g.group_id, g.name, g.is_public, g.password_hash, g.owner_id,
              g.primary_color, g.created_at, gm.role
         FROM groups g
         LEFT JOIN group_members gm
           ON gm.group_id = g.group_id
          AND gm.user_id = $2
        WHERE LOWER(g.group_id) = LOWER($1)`,
      [id, req.user.id]
    );

    const group = rows[0];
    if (!group) {
      return res.status(404).json({ error: "Could not find group." });
    }
    if (group.role) {
      return res.json({ group: publicGroup(group) });
    }

    if (!group.is_public) {
      const passwordMatches = await bcrypt.compare(
        password,
        group.password_hash
      );
      if (!passwordMatches) {
        return res.status(403).json({ error: "Incorrect group password." });
      }
    }

    await pool.query(
      `INSERT INTO group_members (group_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [group.group_id, req.user.id]
    );

    res.status(201).json({
      group: publicGroup({ ...group, role: "member" }),
    });
  } catch (err) {
    console.error("Unable to join group:", err);
    res.status(500).json({ error: "Unable to join group." });
  }
});
