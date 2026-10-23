// A device's real recording start, as an offset from the shared start time.
//
// Clients send actualStartedAt: the server-clock ms when their camera really
// began, next to startedAt, the shared start every angle of a take is keyed
// on. The difference is stored per video so playback can line the angles up.
// Anything missing or implausible (more than 10 s early or 30 s late, which
// only a broken clock produces) is stored as unknown rather than rejected,
// so an upload never fails over it.

const MIN_OFFSET_MS = -10_000;
const MAX_OFFSET_MS = 30_000;

/// What a device's reported start was measured from ('frame' or 'call'), or
/// null for clients that don't say.
export function startClock(value) {
  return value === "frame" || value === "call" ? value : null;
}

// Saving a reported start: a first-frame time replaces a rougher one, else
// the first value saved is kept (a retried save must not overwrite it). For
// ON CONFLICT ... DO UPDATE SET, on recording_session_videos.
export const START_OFFSET_UPSERT_SQL = `
  start_offset_ms = CASE
    WHEN EXCLUDED.start_offset_source = 'frame'
         AND EXCLUDED.start_offset_ms IS NOT NULL
         AND recording_session_videos.start_offset_source IS DISTINCT FROM 'frame'
    THEN EXCLUDED.start_offset_ms
    ELSE COALESCE(recording_session_videos.start_offset_ms, EXCLUDED.start_offset_ms) END,
  start_offset_source = CASE
    WHEN EXCLUDED.start_offset_source = 'frame'
         AND EXCLUDED.start_offset_ms IS NOT NULL
         AND recording_session_videos.start_offset_source IS DISTINCT FROM 'frame'
    THEN 'frame'
    WHEN recording_session_videos.start_offset_ms IS NULL
    THEN EXCLUDED.start_offset_source
    ELSE recording_session_videos.start_offset_source END`;

export function startOffsetMs(actualStartedAt, startedAt) {
  if (actualStartedAt === undefined || actualStartedAt === null || actualStartedAt === "") {
    return null;
  }
  const actual = Number(actualStartedAt);
  if (!Number.isSafeInteger(actual) || !Number.isSafeInteger(startedAt)) return null;
  const offset = actual - startedAt;
  return offset < MIN_OFFSET_MS || offset > MAX_OFFSET_MS ? null : offset;
}
