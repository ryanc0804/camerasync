// Ends live sessions that were left on: nobody's device has been in the
// session for an hour and no take is running. A session with phones still
// connected is never ended, however long the practice runs.

import { pool } from "../db/pool.js";
import { closeSessionSocket, sessionInUse } from "../sockets/websocket.js";

export const IDLE_END_AFTER_MS = 60 * 60 * 1000;
const CHECK_EVERY_MS = 5 * 60 * 1000;

// Live sessions whose last join or leave is older than the idle limit.
// The room is checked too, since a device that stays connected doesn't
// touch last_active_at.
export async function endIdleSessions({
  inUse = sessionInUse,
  close = closeSessionSocket,
} = {}) {
  const { rows } = await pool.query(
    `SELECT id FROM recording_sessions
      WHERE status = 'active'
        AND COALESCE(last_active_at, created_at) < NOW() - make_interval(secs => $1)`,
    [IDLE_END_AFTER_MS / 1000]
  );
  const ended = [];
  for (const { id } of rows) {
    if (await inUse(id)) continue;
    const result = await pool.query(
      `UPDATE recording_sessions SET status = 'complete'
        WHERE id = $1 AND status = 'active'`,
      [id]
    );
    if (result.rowCount > 0) {
      await close(id);
      ended.push(id);
    }
  }
  if (ended.length > 0) {
    console.log(`[sessions] ended ${ended.length} idle session(s): ${ended.join(", ")}`);
  }
  return ended;
}

// Checks every few minutes. The first check waits one interval, so after a
// restart every device has had time to reconnect and rejoin.
export function startIdleSessionChecks() {
  const timer = setInterval(() => {
    endIdleSessions().catch((err) => console.error("Idle session check failed:", err));
  }, CHECK_EVERY_MS);
  timer.unref();
  return timer;
}
