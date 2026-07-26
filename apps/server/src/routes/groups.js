import { Router } from "express";
import bcrypt from "bcryptjs";

import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const groupRouter = Router();

//group IDs can only use letters and numbers
const GROUP_ID_PATTERN = /^[A-Za-z0-9]+$/;
//colors use a standard six-digit hex value
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

//shape a group before sending it to the frontend
function publicGroup(row) {
  return {
    id: row.group_id,
    name: row.name,
    isPublic: row.is_public,
    owner: Number(row.owner_id),
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    createdAt: row.created_at,
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
              g.primary_color, g.secondary_color, g.created_at, gm.role
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

//create a group and make its owner an admin
groupRouter.post("/", async (req, res) => {
  const id = String(req.body?.id ?? "").trim();
  const name = String(req.body?.name ?? "").trim();
  const isPublic = req.body?.isPublic;
  const password = String(req.body?.password ?? "");
  const primaryColor = req.body?.primaryColor ?? "#ffc72c";
  const secondaryColor = req.body?.secondaryColor ?? "#0d0d0d";

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
  if (
    !COLOR_PATTERN.test(primaryColor) ||
    !COLOR_PATTERN.test(secondaryColor)
  ) {
    return res.status(400).json({ error: "Group colors are invalid." });
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
         group_id, name, is_public, password_hash, owner_id,
         primary_color, secondary_color
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING group_id, name, is_public, owner_id,
                 primary_color, secondary_color, created_at`,
      [
        id,
        name,
        isPublic,
        passwordHash,
        req.user.id,
        primaryColor,
        secondaryColor,
      ]
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
              g.primary_color, g.secondary_color, g.created_at, gm.role
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
