// Recording session REST routes.
//
// Creates and manages recording sessions, delegating the live websocket
// channel work to ../middleware/websocket.js. Mounted at /api/recordings
// (see ../index.js).

import crypto from "node:crypto";
import { Router } from "express";
import { pool } from "../db/pool.js";
import {
  createRecordingSession,
  getRecordingSession,
  startSessionRecording,
  stopSessionRecording,
  closeSessionSocket,
} from "../sockets/websocket.js";
import { EVENTS } from "../sockets/events.js";

export const recordingsRouter = Router();
const SOCKET_STATUSES = new Set(['recording', 'stopped']);

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

    res.send(200).json(rows[0])
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
