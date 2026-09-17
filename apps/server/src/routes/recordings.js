// Recording session REST routes.
//
// Creates and manages recording sessions, delegating the live websocket
// channel work to ../middleware/websocket.js. Mounted at /api/recordings
// (see ../index.js).

import crypto from "node:crypto";
import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  createRecordingSession,
  getRecordingSession,
  startSessionRecording,
  stopSessionRecording,
  closeSessionSocket,
} from "../sockets/websocket.js";
import { deleteRecordingFiles } from "./file.js";
import { EVENTS } from "../sockets/events.js";

export const recordingsRouter = Router();
const SOCKET_STATUSES = new Set(['recording', 'stopped']);
const SESSION_ID_CHARACTERS = "abcdefghijklmnopqrstuvwxyz0123456789";
const SESSION_ID_PATTERN = /^[a-z0-9]{6}$/;

// Count this account's uploaded videos across all groups.
recordingsRouter.get("/my-video-count", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS count FROM recording_session_videos
       WHERE user_id = $1 AND file_id IS NOT NULL`,
      [req.user.id]
    );
    res.json({ count: Number(rows[0].count) });
  } catch (err) {
    next(err);
  }
});

// makes a random six character session id
function createSessionId() {
  return Array.from(
    { length: 6 },
    () => SESSION_ID_CHARACTERS[crypto.randomInt(SESSION_ID_CHARACTERS.length)]
  ).join("");
}

// shapes session rows for the frontend
function publicSession(row) {
  return {
    id: row.id,
    groupId: row.group_id,
    name: row.name,
    scheduledAt: row.scheduled_at,
    createdAt: row.created_at,
    createdBy: Number(row.created_by),
    status: row.status,
    memberCount: row.member_count == null ? null : Number(row.member_count),
    totalRecordings: row.total_recordings == null ? null : Number(row.total_recordings),
    activeMemberCount: Number(row.active_member_count ?? 0),
    isJoined: Boolean(row.is_joined),
  };
}

// lists sessions visible to the current user's groups
recordingsRouter.get("/sessions", requireAuth, async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE recording_sessions rs
          SET status = 'active'
        WHERE rs.status = 'scheduled'
          AND EXISTS (
            SELECT 1
              FROM recording_session_members rsm
             WHERE rsm.session_id = rs.id
          )`
    );

    await pool.query(
      `UPDATE recording_sessions rs
          SET status = 'complete'
        WHERE rs.status = 'scheduled'
          AND rs.scheduled_at + INTERVAL '15 minutes' < NOW()
          AND NOT EXISTS (
            SELECT 1
              FROM recording_session_members rsm
             WHERE rsm.session_id = rs.id
          )`
    );

    const { rows } = await pool.query(
      `SELECT rs.id, rs.group_id, rs.name, rs.scheduled_at,
              rs.created_at, rs.created_by, rs.status,
              CASE WHEN rs.counts_tracked THEN
                (SELECT COUNT(*) FROM recording_session_participants p
                  WHERE p.session_id = rs.id) END AS member_count,
              CASE WHEN rs.counts_tracked THEN
                (SELECT COUNT(*) FROM recording_session_videos v
                  WHERE v.session_id = rs.id) END AS total_recordings,
              (
                SELECT COUNT(*)
                  FROM recording_session_members rsm
                 WHERE rsm.session_id = rs.id
              ) AS active_member_count,
              EXISTS (
                SELECT 1
                  FROM recording_session_members rsm
                 WHERE rsm.session_id = rs.id
                   AND rsm.user_id = $1
              ) AS is_joined
        FROM recording_sessions rs
         JOIN group_members gm ON gm.group_id = rs.group_id
        WHERE gm.user_id = $1
        ORDER BY
          rs.status <> 'active',
          rs.scheduled_at < NOW(),
          CASE
            WHEN rs.scheduled_at >= NOW() THEN rs.scheduled_at
          END,
          CASE
            WHEN rs.scheduled_at < NOW() THEN rs.scheduled_at
          END DESC,
          rs.created_at`,
      [req.user.id]
    );

    res.json({ sessions: rows.map(publicSession) });
  } catch (err) {
    next(err);
  }
});

// Only the group owner can delete a completed session and its videos.
recordingsRouter.delete("/sessions/:id", requireAuth, async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT rs.status, g.owner_id FROM recording_sessions rs
       JOIN groups g ON g.group_id = rs.group_id
       WHERE rs.id = $1 FOR UPDATE OF rs`,
      [req.params.id]
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Session not found." });
    }
    if (Number(rows[0].owner_id) !== Number(req.user.id)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Only the group owner can delete sessions." });
    }
    if (rows[0].status !== "complete") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "End this session before deleting it." });
    }
    const { rows: videos } = await client.query(
      "SELECT file_id FROM recording_session_videos WHERE session_id = $1 FOR UPDATE",
      [req.params.id]
    );
    await deleteRecordingFiles(videos.filter((video) => video.file_id).map((video) => video.file_id));
    await client.query("DELETE FROM recording_sessions WHERE id = $1", [req.params.id]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    next(err);
  } finally {
    client?.release();
  }
});

// Load the session's recordings for members of its group.
recordingsRouter.get("/sessions/:id/videos", requireAuth, async (req, res, next) => {
  try {
    const { rows: sessions } = await pool.query(
      `SELECT rs.id, rs.name FROM recording_sessions rs
       JOIN group_members gm ON gm.group_id = rs.group_id
       WHERE rs.id = $1 AND gm.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (sessions.length === 0) {
      return res.status(404).json({ error: "Session not found." });
    }
    const { rows } = await pool.query(
      `SELECT v.started_at_ms, v.user_id, v.file_id, u.display_name
       FROM recording_session_videos v JOIN users u ON u.user_id = v.user_id
       WHERE v.session_id = $1 ORDER BY v.started_at_ms, v.user_id`,
      [req.params.id]
    );
    const recordings = [];
    for (const row of rows) {
      const startedAt = Number(row.started_at_ms);
      let recording = recordings[recordings.length - 1];
      if (!recording || recording.startedAt !== startedAt) {
        recording = { startedAt, videos: [] };
        recordings.push(recording);
      }
      recording.videos.push({
        userId: Number(row.user_id),
        name: row.display_name || "Unnamed member",
        url: row.file_id ? `/api/files/get/${row.file_id}` : null,
      });
    }
    res.json({ session: sessions[0], recordings });
  } catch (err) {
    next(err);
  }
});

// Count each finished local video once, including when a save is retried.
recordingsRouter.post("/sessions/:id/videos", requireAuth, async (req, res, next) => {
  const startedAt = req.body?.startedAt;
  if (!SESSION_ID_PATTERN.test(req.params.id) ||
      !Number.isSafeInteger(startedAt) || startedAt <= 0 || startedAt > Date.now()) {
    return res.status(400).json({ error: "Invalid recording details." });
  }
  try {
    const participant = await pool.query(
      `SELECT 1 FROM recording_session_participants
        WHERE session_id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (participant.rows.length === 0) {
      return res.status(403).json({ error: "You did not join this session." });
    }
    await pool.query(
      `INSERT INTO recording_session_videos (session_id, user_id, started_at_ms)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [req.params.id, req.user.id, startedAt]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// --- Session notes -------------------------------------------------------
//
// The owner outranks admins and admins outrank members. You may always delete
// your own note; otherwise you need a strictly higher rank than its author,
// so an admin cannot delete another admin's note and a member can only delete
// their own.

function roleRank(role) {
  if (role === "owner") return 3;
  if (role === "admin") return 2;
  return 1;
}

// The current user's rank in the group that owns this session, or null when
// they are not a member of it.
async function getSessionRole(sessionId, userId) {
  const { rows } = await pool.query(
    `SELECT gm.role, g.owner_id FROM recording_sessions rs
     JOIN groups g ON g.group_id = rs.group_id
     JOIN group_members gm
       ON gm.group_id = rs.group_id AND gm.user_id = $2
     WHERE rs.id = $1`,
    [sessionId, userId]
  );
  if (rows.length === 0) return null;
  return Number(rows[0].owner_id) === Number(userId) ? "owner" : rows[0].role;
}

// The group owner is stored on groups.owner_id, so a note's author only counts
// as "owner" when their id matches it.
function noteAuthorRole(row) {
  return Number(row.owner_id) === Number(row.user_id) ? "owner" : row.role || "member";
}

function canDeleteNote(row, viewerId, viewerRole) {
  if (Number(row.user_id) === Number(viewerId)) return true;
  return roleRank(viewerRole) > roleRank(noteAuthorRole(row));
}

// shapes note rows for the frontend
function publicNote(row, viewerId, viewerRole) {
  return {
    id: Number(row.note_id),
    body: row.body,
    videoTimeMs: Number(row.video_time_ms),
    author: row.display_name || "Unnamed member",
    canDelete: canDeleteNote(row, viewerId, viewerRole),
  };
}

// lists one recording's notes for members of the session's group
recordingsRouter.get("/sessions/:id/notes", requireAuth, async (req, res, next) => {
  const startedAt = Number(req.query.startedAt);
  if (!Number.isSafeInteger(startedAt) || startedAt <= 0) {
    return res.status(400).json({ error: "Invalid recording." });
  }
  try {
    const role = await getSessionRole(req.params.id, req.user.id);
    if (!role) {
      return res.status(404).json({ error: "Session not found." });
    }
    const { rows } = await pool.query(
      `SELECT n.note_id, n.body, n.video_time_ms, n.user_id,
              u.display_name, g.owner_id, gm.role
       FROM session_notes n
       JOIN recording_sessions rs ON rs.id = n.session_id
       JOIN groups g ON g.group_id = rs.group_id
       JOIN users u ON u.user_id = n.user_id
       LEFT JOIN group_members gm
         ON gm.group_id = rs.group_id AND gm.user_id = n.user_id
       WHERE n.session_id = $1 AND n.started_at_ms = $2
       ORDER BY n.video_time_ms, n.note_id`,
      [req.params.id, startedAt]
    );
    res.json({ notes: rows.map((row) => publicNote(row, req.user.id, role)) });
  } catch (err) {
    next(err);
  }
});

// adds a note at a point in one of the session's recordings
recordingsRouter.post("/sessions/:id/notes", requireAuth, async (req, res, next) => {
  const body = String(req.body?.body ?? "").trim();
  const startedAt = Number(req.body?.startedAt);
  const videoTimeMs = Math.round(Number(req.body?.videoTimeMs ?? 0));
  if (!body || body.length > 500) {
    return res.status(400).json({ error: "Notes must be 1 to 500 characters." });
  }
  if (!Number.isSafeInteger(startedAt) || startedAt <= 0) {
    return res.status(400).json({ error: "Invalid recording." });
  }
  if (!Number.isFinite(videoTimeMs) || videoTimeMs < 0) {
    return res.status(400).json({ error: "Invalid note time." });
  }
  try {
    const role = await getSessionRole(req.params.id, req.user.id);
    if (!role) {
      return res.status(404).json({ error: "Session not found." });
    }
    await pool.query(
      `INSERT INTO session_notes (session_id, started_at_ms, user_id, body, video_time_ms)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.params.id, startedAt, req.user.id, body, videoTimeMs]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// deletes a note the current user outranks, or one of their own
recordingsRouter.delete("/sessions/:id/notes/:noteId", requireAuth, async (req, res, next) => {
  const noteId = Number(req.params.noteId);
  if (!Number.isInteger(noteId)) {
    return res.status(400).json({ error: "Invalid note." });
  }
  try {
    const role = await getSessionRole(req.params.id, req.user.id);
    if (!role) {
      return res.status(404).json({ error: "Session not found." });
    }
    const { rows } = await pool.query(
      `SELECT n.user_id, g.owner_id, gm.role
       FROM session_notes n
       JOIN recording_sessions rs ON rs.id = n.session_id
       JOIN groups g ON g.group_id = rs.group_id
       LEFT JOIN group_members gm
         ON gm.group_id = rs.group_id AND gm.user_id = n.user_id
       WHERE n.note_id = $1 AND n.session_id = $2`,
      [noteId, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Note not found." });
    }
    if (!canDeleteNote(rows[0], req.user.id, role)) {
      return res.status(403).json({ error: "You cannot delete this note." });
    }
    await pool.query("DELETE FROM session_notes WHERE note_id = $1", [noteId]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// schedules a session for one of the user's groups
recordingsRouter.post("/sessions", requireAuth, async (req, res, next) => {
  const groupId = String(req.body?.groupId ?? "").trim();
  const name = String(req.body?.name ?? "").trim();
  const scheduledAt = new Date(req.body?.scheduledAt);

  if (!groupId) {
    return res.status(400).json({ error: "Group is required." });
  }
  if (!name) {
    return res.status(400).json({ error: "Session name is required." });
  }
  if (Number.isNaN(scheduledAt.getTime())) {
    return res.status(400).json({ error: "Session date is invalid." });
  }
  if (scheduledAt.getTime() <= Date.now()) {
    return res.status(400).json({
      error: "Sessions must be scheduled for a future date and time.",
    });
  }

  try {
    const membership = await pool.query(
      `SELECT 1
         FROM group_members
        WHERE group_id = $1
          AND user_id = $2
          AND role = 'admin'`,
      [groupId, req.user.id]
    );

    if (membership.rowCount === 0) {
      return res.status(403).json({
        error: "Only owners and admins can schedule a session.",
      });
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const id = createSessionId();

      try {
        const { rows } = await pool.query(
          `INSERT INTO recording_sessions (
             id, group_id, name, scheduled_at, created_by
           )
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, group_id, name, scheduled_at,
                     created_at, created_by, status`,
          [id, groupId, name, scheduledAt, req.user.id]
        );

        return res.status(201).json({
          session: publicSession(rows[0]),
        });
      } catch (err) {
        if (err.code !== "23505") throw err;
      }
    }

    res.status(500).json({ error: "Unable to create a unique session ID." });
  } catch (err) {
    next(err);
  }
});

// starts a live session with its creator as the first member
recordingsRouter.post("/sessions/live", requireAuth, async (req, res, next) => {
  const groupId = String(req.body?.groupId ?? "").trim();
  const name = String(req.body?.name ?? "").trim();

  if (!groupId) {
    return res.status(400).json({ error: "Group is required." });
  }
  if (!name) {
    return res.status(400).json({ error: "Session name is required." });
  }

  let client;
  try {
    const membership = await pool.query(
      `SELECT 1
         FROM group_members
        WHERE group_id = $1
          AND user_id = $2
          AND role = 'admin'`,
      [groupId, req.user.id]
    );

    if (membership.rowCount === 0) {
      return res.status(403).json({
        error: "Only owners and admins can create a session.",
      });
    }

    client = await pool.connect();
    await client.query("BEGIN");

    let sessionRow = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const id = createSessionId();

      const { rows } = await client.query(
        `INSERT INTO recording_sessions (
           id, group_id, name, scheduled_at, created_by, status
         )
         VALUES ($1, $2, $3, NOW(), $4, 'active')
         ON CONFLICT (id) DO NOTHING
         RETURNING id, group_id, name, scheduled_at,
                   created_at, created_by, status`,
        [id, groupId, name, req.user.id]
      );

      if (rows.length > 0) {
        sessionRow = rows[0];
        break;
      }
    }

    if (!sessionRow) {
      await client.query("ROLLBACK");
      return res.status(500).json({
        error: "Unable to create a unique session ID.",
      });
    }

    await client.query(
      `INSERT INTO recording_session_members (session_id, user_id)
       VALUES ($1, $2)`,
      [sessionRow.id, req.user.id]
    );
    await client.query(
      `INSERT INTO recording_session_participants (session_id, user_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [sessionRow.id, req.user.id]
    );
    await client.query("COMMIT");

    res.status(201).json({
      session: publicSession({
        ...sessionRow,
        active_member_count: 1,
        is_joined: true,
      }),
    });
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    next(err);
  } finally {
    client?.release();
  }
});

// joins live sessions or scheduled sessions in their join window
recordingsRouter.post(
  "/sessions/:id/join",
  requireAuth,
  async (req, res, next) => {
    const id = String(req.params.id ?? "").trim();

    if (!SESSION_ID_PATTERN.test(id)) {
      return res.status(400).json({ error: "Session ID is invalid." });
    }

    try {
      const { rows } = await pool.query(
        `SELECT rs.id, rs.group_id, rs.name, rs.scheduled_at,
                rs.created_at, rs.created_by, rs.status,
                EXISTS (
                  SELECT 1
                    FROM recording_session_members rsm
                   WHERE rsm.session_id = rs.id
                ) AS has_members
           FROM recording_sessions rs
           JOIN group_members gm ON gm.group_id = rs.group_id
          WHERE rs.id = $1
            AND gm.user_id = $2`,
        [id, req.user.id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Session not found." });
      }

      const session = rows[0];
      if (!["active", "scheduled"].includes(session.status)) {
        return res.status(409).json({
          error: "This session is no longer open for joining.",
        });
      }

      const joinOpensAt =
        new Date(session.scheduled_at).getTime() - 15 * 60 * 1000;
      const joinClosesAt =
        new Date(session.scheduled_at).getTime() + 15 * 60 * 1000;

      if (session.status === "scheduled" && !session.has_members) {
        if (Date.now() < joinOpensAt) {
          return res.status(409).json({
            error: "Scheduled sessions open 15 minutes before they start.",
          });
        }
        if (Date.now() > joinClosesAt) {
          await pool.query(
            `UPDATE recording_sessions
                SET status = 'complete'
              WHERE id = $1
                AND status = 'scheduled'`,
            [id]
          );
          return res.status(409).json({
            error: "This session's join window has closed.",
          });
        }
      }

      await pool.query(
        `INSERT INTO recording_session_members (session_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (session_id, user_id) DO NOTHING`,
        [id, req.user.id]
      );

      await pool.query(
        `INSERT INTO recording_session_participants (session_id, user_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id, req.user.id]
      );

      if (session.status === "scheduled") {
        await pool.query(
          `UPDATE recording_sessions
              SET status = 'active'
            WHERE id = $1
              AND status = 'scheduled'`,
          [id]
        );
        session.status = "active";
      }

      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*) AS active_member_count
           FROM recording_session_members
          WHERE session_id = $1`,
        [id]
      );

      res.json({
        session: publicSession({
          ...session,
          active_member_count: countRows[0].active_member_count,
          is_joined: true,
        }),
      });
    } catch (err) {
      next(err);
    }
  }
);

// leaves a session without ending it for everyone
recordingsRouter.delete(
  "/sessions/:id/join",
  requireAuth,
  async (req, res, next) => {
    const id = String(req.params.id ?? "").trim();

    if (!SESSION_ID_PATTERN.test(id)) {
      return res.status(400).json({ error: "Session ID is invalid." });
    }

    try {
      const { rows } = await pool.query(
        `SELECT created_by, status
           FROM recording_sessions
          WHERE id = $1`,
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Session not found." });
      }
      if (Number(rows[0].created_by) === Number(req.user.id)) {
        return res.status(403).json({
          error: "The session creator must end the session.",
        });
      }
      if (rows[0].status !== "active") {
        return res.status(409).json({
          error: "Only live sessions can be left.",
        });
      }

      await pool.query(
        `DELETE FROM recording_session_members
          WHERE session_id = $1
            AND user_id = $2`,
        [id, req.user.id]
      );

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

// ends a live session for every connected member
recordingsRouter.patch(
  "/sessions/:id/end",
  requireAuth,
  async (req, res, next) => {
    const id = String(req.params.id ?? "").trim();

    if (!SESSION_ID_PATTERN.test(id)) {
      return res.status(400).json({ error: "Session ID is invalid." });
    }

    try {
      const { rows } = await pool.query(
        `UPDATE recording_sessions
            SET status = 'complete'
          WHERE id = $1
            AND created_by = $2
            AND status = 'active'
          RETURNING id, group_id, name, scheduled_at,
                    created_at, created_by, status`,
        [id, req.user.id]
      );

      if (rows.length === 0) {
        const sessionExists = await pool.query(
          `SELECT created_by, status
             FROM recording_sessions
            WHERE id = $1`,
          [id]
        );

        if (sessionExists.rowCount === 0) {
          return res.status(404).json({ error: "Session not found." });
        }
        if (
          Number(sessionExists.rows[0].created_by) !== Number(req.user.id)
        ) {
          return res.status(403).json({
            error: "Only the session creator can end it.",
          });
        }
        return res.status(409).json({
          error: "Only live sessions can be ended.",
        });
      }

      const { rows: memberRows } = await pool.query(
        `SELECT COUNT(*) AS active_member_count,
                BOOL_OR(user_id = $2) AS is_joined
           FROM recording_session_members
          WHERE session_id = $1`,
        [id, req.user.id]
      );

      await closeSessionSocket(id);

      res.json({
        session: publicSession({
          ...rows[0],
          ...memberRows[0],
        }),
      });
    } catch (err) {
      next(err);
    }
  }
);

// cancels a session but keeps it in the database
recordingsRouter.patch(
  "/sessions/:id/cancel",
  requireAuth,
  async (req, res, next) => {
    const id = String(req.params.id ?? "").trim();

    if (!SESSION_ID_PATTERN.test(id)) {
      return res.status(400).json({ error: "Session ID is invalid." });
    }

    try {
      const { rows } = await pool.query(
        `UPDATE recording_sessions
            SET status = 'cancelled'
          WHERE id = $1
            AND created_by = $2
            AND status = 'scheduled'
          RETURNING id, group_id, name, scheduled_at,
                    created_at, created_by, status`,
        [id, req.user.id]
      );

      if (rows.length === 0) {
        const sessionExists = await pool.query(
          `SELECT created_by, status
             FROM recording_sessions
            WHERE id = $1`,
          [id]
        );

        if (sessionExists.rowCount === 0) {
          return res.status(404).json({ error: "Session not found." });
        }
        if (sessionExists.rows[0].status !== "scheduled") {
          return res.status(409).json({
            error: "Only scheduled sessions can be cancelled.",
          });
        }
        return res.status(403).json({
          error: "Only the session creator can cancel it.",
        });
      }

      res.json({ session: publicSession(rows[0]) });
    } catch (err) {
      next(err);
    }
  }
);

// Create a new recording session (and host its websocket channel).
recordingsRouter.post("/create", async (req, res, next) => {
  try {
    // TODO: validate body, generate sessionId (crypto.randomUUID()),
    // persist the session, then createSessionSocket(io, sessionId).
    // TODO: return 201 with the new session + how phones should connect.
    const {name} = req.body ?? {};
    if (name !== undefined && typeof name !== "string") {
      return res.status(400).json({error: "name must be a string"});
    }

    const sessionId = crypto.randomUUID();

    const { rows } = await pool.query(`
      INSERT INTO recordings (id, name, status)
      VALUES ($1, $2, 'created')
      RETURNING id, name, status, created_at
      `,
    [sessionId, name ?? null]);

    createRecordingSession(sessionId);

    res.status(200).json({
      session: rows[0],
      connect: {
        sessionId,
        event: EVENTS.JOIN_SESSION
      }
    })
  } catch (err) {
    next(err);
  }
});

// Fetch a session's current info / connected devices.
recordingsRouter.get("/info", async (req, res, next) => {
  try {
    const {sessionId} = req.query;
    if (!sessionId) {
      return res.status(400).json({message: "sessionId is requred."});
    }

    const { rows } = await pool.query(`
      SELECT id, name, status, created_at, started_at, stopped_at, closed_at
      FROM recordings WHERE id = $1`,
    [sessionId]);

    if (rows.length === 0) {
      return res.status(404).json({message: "sessionId not found."})
    }

    const currentSocket = await getRecordingSession(sessionId);

    // ... is spread op to unpack data
    res.status(200).json({ ...rows[0], ...currentSocket})
  } catch (err) {
    next(err);
  }
});

// Update session state (e.g. start/stop recording).
recordingsRouter.patch("/update", async (req, res, next) => {
  try {
    const {sessionId, status} = req.body ?? {};
    if (!sessionId) {
      return res.status(400).json({message: "sessionId is requred."});
    }

    if(!SOCKET_STATUSES.has(status)) {
      return res.status(403).json({message: "requested status is not valid"});
    }

    const timestampCol = status === "recording" ? "started_at" : "stopped_at"

    const { rows } = await pool.query(
      `UPDATE recordings
      SET status = $1, ${timestampCol} = now()
      WHERE id = $2 AND status != 'closed'
      RETURNING id, name, status, started_at, stopped_at`,
      [status, sessionId]
    );

    if (rows.length === 0) {
      return res.status(404).json({message: "sessionId not found."})
    }

    if (status === "recording") {
      startSessionRecording(sessionId);
    } else {
      stopSessionRecording(sessionId);
    }

    res.status(200).json(rows[0])
  } catch (err) {
    next(err);
  }
});

// End a session and tear down its websocket channel.
recordingsRouter.delete("/close", async (req, res, next) => {
  try {
    const {sessionId, status} = req.body ?? {};
    if (!sessionId) {
      return res.status(400).json({message: "sessionId is requred."});
    }

    const {rows} = await pool.query(
      `UPDATE recordings
      SET status = 'closed', closed_at = now()
      WHERE id = $1
      RETURNING id, status, closed_at`,
      [sessionId]
    );
    if (rows.length === 0) {
      return res.status(404).json({message: "sessionId not found."})
    }

    await closeSessionSocket(sessionId);

    res.status(200).json(rows[0]);
  } catch (err) {
    next(err);
  }
});
