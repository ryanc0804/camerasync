import { Router } from "express";
import bcrypt from "bcryptjs";

import { pool } from "../db/pool.js";
import {
  closeSessionSocket,
  removeMemberFromGroupSessions,
} from "../sockets/websocket.js";
import { deleteRecordingFiles } from "./file.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { ROLE_RANK, atLeast, getGroupRole } from "../middleware/groupRole.js";
import { DEFAULT_TEAM_COLOR, teamColor } from "../groups/teamColors.js";

export const groupRouter = Router();

//group IDs can only use letters and numbers
const GROUP_ID_PATTERN = /^[A-Za-z0-9]+$/;
const COLOR_ERROR = "Pick one of the team colors.";
const WEB_ORIGIN = (process.env.WEB_ORIGIN || "http://localhost:5173").replace(/\/$/, "");

// The link members share to invite people. It opens the web app's join page;
// a private group still asks for its password there.
function inviteUrl(groupId) {
  return `${WEB_ORIGIN}/join/${encodeURIComponent(groupId)}`;
}

//shape a group before sending it to the frontend
function publicGroup(row) {
  return {
    id: row.group_id,
    name: row.name,
    isPublic: row.is_public,
    owner: Number(row.owner_id),
    primaryColor: row.primary_color,
    inviteUrl: inviteUrl(row.group_id),
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
// What an invite link shows before joining: the group's name, color and
// whether it needs a password. Any signed-in user can look; the ID is the
// invitation.
groupRouter.get("/:id/invite", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.group_id, g.name, g.is_public, g.primary_color,
              EXISTS (
                SELECT 1 FROM group_members gm
                 WHERE gm.group_id = g.group_id AND gm.user_id = $2
              ) AS is_member
         FROM groups g
        WHERE LOWER(g.group_id) = LOWER($1)`,
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "This invite link doesn't match a group." });
    }
    const row = rows[0];
    res.json({
      group: {
        id: row.group_id,
        name: row.name,
        isPublic: row.is_public,
        primaryColor: row.primary_color,
        isMember: row.is_member,
      },
    });
  } catch (err) {
    console.error("Unable to load invite:", err);
    res.status(500).json({ error: "Unable to load invite." });
  }
});

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

const MAX_GROUP_NAME_LENGTH = 100; // groups.name is VARCHAR(100)

// Update a group. Admins and the owner can change the team color (SCRUM-71);
// only the owner can rename the group or change its privacy and password.
groupRouter.patch("/:id", async (req, res) => {
  const body = req.body ?? {};
  const wantsColor = body.primaryColor !== undefined;
  const wantsDetails = ["name", "isPublic", "password"].some((key) => body[key] !== undefined);
  if (!wantsColor && !wantsDetails) {
    return res.status(400).json({ error: "Nothing to update." });
  }

  const primaryColor = wantsColor ? teamColor(body.primaryColor) : null;
  if (wantsColor && !primaryColor) {
    return res.status(400).json({ error: COLOR_ERROR });
  }
  const name = body.name === undefined ? null : String(body.name).trim();
  if (name !== null && (!name || name.length > MAX_GROUP_NAME_LENGTH)) {
    return res.status(400).json({
      error: `Group name must be 1 to ${MAX_GROUP_NAME_LENGTH} characters.`,
    });
  }
  if (body.isPublic !== undefined && typeof body.isPublic !== "boolean") {
    return res.status(400).json({ error: "Group visibility is invalid." });
  }
  const password = body.password === undefined ? "" : String(body.password);

  try {
    const role = await getGroupRole(req.params.id, req.user.id);
    if (wantsColor && !atLeast(role, "admin")) {
      return res.status(403).json({
        error: "Only group admins can change the team colors.",
      });
    }
    if (wantsDetails && role !== "owner") {
      return res.status(403).json({
        error: "Only the group owner can change the group's name or privacy.",
      });
    }

    const { rows: current } = await pool.query(
      "SELECT is_public, password_hash FROM groups WHERE group_id = $1",
      [req.params.id]
    );
    const isPublic = body.isPublic ?? current[0].is_public;
    // Public groups keep no password; a private one keeps its current
    // password unless a new one is sent.
    let passwordHash = null;
    if (!isPublic) {
      if (password.trim()) {
        passwordHash = await bcrypt.hash(password, 12);
      } else if (current[0].password_hash) {
        passwordHash = current[0].password_hash;
      } else {
        return res.status(400).json({ error: "Private groups require a password." });
      }
    }

    const { rows } = await pool.query(
      `UPDATE groups g
          SET primary_color = COALESCE($2, g.primary_color),
              name = COALESCE($3, g.name),
              is_public = $4,
              password_hash = $5
         FROM group_members gm
        WHERE g.group_id = $1
          AND gm.group_id = g.group_id
          AND gm.user_id = $6
        RETURNING g.group_id, g.name, g.is_public, g.owner_id,
                  g.primary_color, g.created_at, gm.role, gm.joined_at`,
      [req.params.id, primaryColor, name, isPublic, passwordHash, req.user.id]
    );
    res.json({ group: publicGroup(rows[0]) });
  } catch (err) {
    console.error("Unable to update group:", err);
    res.status(500).json({ error: "Unable to update group." });
  }
});

// Leave a group. Everyone but the owner can; the owner hands the group to
// someone else first (POST /:id/transfer).
groupRouter.post("/:id/leave", async (req, res) => {
  try {
    const role = await getGroupRole(req.params.id, req.user.id);
    if (!role) {
      return res.status(404).json({ error: "You're not in this group." });
    }
    if (role === "owner") {
      return res.status(409).json({
        error: "Hand the group to someone else before leaving it.",
      });
    }
    await pool.query("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2",
      [req.params.id, req.user.id]);
    await pool.query(
      `DELETE FROM recording_session_members rsm USING recording_sessions rs
        WHERE rsm.session_id = rs.id AND rs.group_id = $1 AND rsm.user_id = $2`,
      [req.params.id, req.user.id]
    );
    await removeMemberFromGroupSessions(req.params.id, Number(req.user.id));
    res.json({ ok: true });
  } catch (err) {
    console.error("Unable to leave group:", err);
    res.status(500).json({ error: "Unable to leave group." });
  }
});

// Hand the group to another member (owner only). They become the owner and
// the old owner stays on as an admin, free to leave afterwards.
groupRouter.post("/:id/transfer", async (req, res) => {
  const newOwnerId = Number(req.body?.userId);
  if (!Number.isSafeInteger(newOwnerId) || newOwnerId <= 0) {
    return res.status(400).json({ error: "Pick someone to hand the group to." });
  }
  if (newOwnerId === Number(req.user.id)) {
    return res.status(400).json({ error: "You already own this group." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: groups } = await client.query(
      "SELECT owner_id FROM groups WHERE group_id = $1 FOR UPDATE",
      [req.params.id]
    );
    if (Number(groups[0]?.owner_id) !== Number(req.user.id)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Only the group owner can hand the group over." });
    }
    const { rowCount } = await client.query(
      "UPDATE group_members SET role = 'admin' WHERE group_id = $1 AND user_id = $2",
      [req.params.id, newOwnerId]
    );
    if (rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Pick someone in this group." });
    }
    await client.query("UPDATE groups SET owner_id = $2 WHERE group_id = $1",
      [req.params.id, newOwnerId]);
    const { rows } = await client.query(
      `SELECT g.group_id, g.name, g.is_public, g.owner_id, g.primary_color,
              g.created_at, gm.role, gm.joined_at
         FROM groups g
         JOIN group_members gm ON gm.group_id = g.group_id AND gm.user_id = $2
        WHERE g.group_id = $1`,
      [req.params.id, req.user.id]
    );
    await client.query("COMMIT");
    res.json({ group: publicGroup(rows[0]) });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Unable to transfer group:", err);
    res.status(500).json({ error: "Unable to transfer group." });
  } finally {
    client.release();
  }
});

// Delete a group with all its sessions, recordings and comments (owner only).
groupRouter.delete("/:id", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: groups } = await client.query(
      "SELECT owner_id FROM groups WHERE group_id = $1 FOR UPDATE",
      [req.params.id]
    );
    if (groups.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Group not found." });
    }
    if (Number(groups[0].owner_id) !== Number(req.user.id)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Only the group owner can delete the group." });
    }
    const { rows: sessions } = await client.query(
      "SELECT id, status FROM recording_sessions WHERE group_id = $1",
      [req.params.id]
    );
    const { rows: videos } = await client.query(
      `SELECT v.file_id FROM recording_session_videos v
         JOIN recording_sessions rs ON rs.id = v.session_id
        WHERE rs.group_id = $1 AND v.file_id IS NOT NULL`,
      [req.params.id]
    );
    await client.query("DELETE FROM groups WHERE group_id = $1", [req.params.id]);
    await client.query("COMMIT");

    // The rows are gone; now the files, and anyone still in a live session.
    await deleteRecordingFiles(videos.map((video) => video.file_id));
    for (const session of sessions.filter((item) => item.status === "active")) {
      await closeSessionSocket(session.id).catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Unable to delete group:", err);
    res.status(500).json({ error: "Unable to delete group." });
  } finally {
    client.release();
  }
});


//join a group and check its password when private
const MAX_PASSWORD_TRIES = 5;
const LOCKOUT_MINUTES = 15;

// Counts a wrong group password. Misses older than the lockout window start
// over; the fifth one locks this person out of joining the group for
// LOCKOUT_MINUTES. Returns how many tries are left (0 once locked).
async function recordWrongPassword(groupId, userId) {
  const { rows } = await pool.query(
    `INSERT INTO group_join_attempts (group_id, user_id, failures, last_failed_at)
     VALUES ($1, $2, 1, NOW())
     ON CONFLICT (group_id, user_id) DO UPDATE
       SET failures = CASE
             WHEN group_join_attempts.last_failed_at < NOW() - make_interval(mins => $3)
               OR group_join_attempts.locked_until IS NOT NULL
             THEN 1
             ELSE group_join_attempts.failures + 1
           END,
           last_failed_at = NOW(),
           locked_until = NULL
     RETURNING failures`,
    [groupId, userId, LOCKOUT_MINUTES]
  );
  const failures = rows[0].failures;
  if (failures >= MAX_PASSWORD_TRIES) {
    await pool.query(
      `UPDATE group_join_attempts
          SET locked_until = NOW() + make_interval(mins => $3), failures = 0
        WHERE group_id = $1 AND user_id = $2`,
      [groupId, userId, LOCKOUT_MINUTES]
    );
    return 0;
  }
  return MAX_PASSWORD_TRIES - failures;
}

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
      const { rows: attempts } = await pool.query(
        `SELECT CEIL(EXTRACT(EPOCH FROM (locked_until - NOW())) / 60) AS minutes_left
           FROM group_join_attempts
          WHERE group_id = $1 AND user_id = $2 AND locked_until > NOW()`,
        [group.group_id, req.user.id]
      );
      if (attempts.length > 0) {
        const minutes = Math.max(1, Number(attempts[0].minutes_left));
        return res.status(429).json({
          error: `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        });
      }

      const passwordMatches = await bcrypt.compare(
        password,
        group.password_hash
      );
      if (!passwordMatches) {
        const triesLeft = await recordWrongPassword(group.group_id, req.user.id);
        return res.status(403).json({
          error: triesLeft > 0
            ? `Incorrect group password. ${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left.`
            : `Incorrect group password. Try again in ${LOCKOUT_MINUTES} minutes.`,
        });
      }
      await pool.query(
        "DELETE FROM group_join_attempts WHERE group_id = $1 AND user_id = $2",
        [group.group_id, req.user.id]
      );
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
