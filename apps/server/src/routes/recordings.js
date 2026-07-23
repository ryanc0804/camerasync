// Recording session REST routes.
//
// Creates and manages recording sessions, delegating the live websocket
// channel work to ../middleware/websocket.js. Mounted at /api/recordings
// (see ../index.js).
//
// SCAFFOLD ONLY: route wiring is in place; handler bodies are intentionally
// left unimplemented (TODO) per academic constraints.

import crypto from "node:crypto";
import { Router } from "express";
import { pool } from "../db/pool.js";
import {
  createSessionSocket,
  getSessionSocket,
  startSessionRecording,
  stopSessionRecording,
  closeSessionSocket,
} from "../sockets/websocket.js";

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

    res.status(501).json({ error: "Not implemented" });
  } catch (err) {
    next(err);
  }
});

// Fetch a session's current info / connected devices.
recordingsRouter.get("/info", async (req, res, next) => {
  try {
    // TODO: read sessionId from req.query, look up getSessionSocket(sessionId).
    res.status(501).json({ error: "Not implemented" });
  } catch (err) {
    next(err);
  }
});

// Update session state (e.g. start/stop recording).
recordingsRouter.patch("/update", async (req, res, next) => {
  try {
    // TODO: branch on desired state -> startSessionRecording / stopSessionRecording.
    res.status(501).json({ error: "Not implemented" });
  } catch (err) {
    next(err);
  }
});

// End a session and tear down its websocket channel.
recordingsRouter.delete("/close", async (req, res, next) => {
  try {
    // TODO: read sessionId, closeSessionSocket(sessionId), mark it ended.
    res.status(501).json({ error: "Not implemented" });
  } catch (err) {
    next(err);
  }
});
