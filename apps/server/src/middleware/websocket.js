// Session WebSocket manager.
//
// Creates and hosts one logical websocket "channel" per recording session so
// phones can be synced independently of each other. This sits on top of the
// shared Socket.IO server (see ../sockets/index.js) and tracks the lifecycle of
// each session's room: create -> host/broadcast -> close.
//
// SCAFFOLD ONLY: signatures and shape are in place; bodies are intentionally
// left unimplemented (TODO) per academic constraints.

import { EVENTS, RECORDING_LEAD_TIME_MS } from "../sockets/events.js";
import { Server as SocketServer } from "socket.io";

// In-memory registry of live session sockets.
// Map<sessionId, { io, room, createdAt, ...state }>
// NOTE: single-node only — move to Redis / the Socket.IO Redis adapter to scale.
const sessionSockets = new Map();

function roomFor(sessionId) {
  return `session:${sessionId}`;
}

/**
 * Stand up a new websocket channel for a recording session.
 * Async so the manager can later back this with a store (Redis/db) that the
 * REST layer awaits before returning to the client.
 *
 * @param {import("socket.io").Server} io   shared Socket.IO server instance
 * @param {string} sessionId
 * @param {object} [options]
 * @returns {Promise<object>} handle describing the created session socket
 */
export async function createSessionSocket(io, sessionId, options = {}) {
  // TODO: guard against duplicate sessionId already in sessionSockets.
  // TODO: register a room/namespace for this session on `io`.
  // TODO: store the handle in sessionSockets and return it.
  throw new Error("createSessionSocket not implemented");
}

/**
 * Look up the live handle for a session, or undefined if none is hosted.
 * @param {string} sessionId
 * @returns {object | undefined}
 */
export function getSessionSocket(sessionId) {
  // TODO: return sessionSockets.get(sessionId).
  throw new Error("getSessionSocket not implemented");
}

/**
 * Broadcast a synchronized recording start to every phone in the session.
 * Picks a single shared future wall-clock instant (Date.now() + lead time).
 * @param {string} sessionId
 * @returns {Promise<{ startAtEpochMs: number }>}
 */
export async function startSessionRecording(sessionId) {
  // TODO: resolve handle, compute startAtEpochMs, emit EVENTS.RECORDING_STARTED.
  throw new Error("startSessionRecording not implemented");
}

/**
 * Broadcast a recording stop to every phone in the session.
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function stopSessionRecording(sessionId) {
  // TODO: resolve handle, emit EVENTS.RECORDING_STOPPED.
  throw new Error("stopSessionRecording not implemented");
}

/**
 * Tear down a session's websocket channel and free its registry entry.
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function closeSessionSocket(sessionId) {
  // TODO: disconnect room members, delete from sessionSockets.
  throw new Error("closeSessionSocket not implemented");
}
