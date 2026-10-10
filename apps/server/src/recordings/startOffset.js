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

export function startOffsetMs(actualStartedAt, startedAt) {
  if (actualStartedAt === undefined || actualStartedAt === null || actualStartedAt === "") {
    return null;
  }
  const actual = Number(actualStartedAt);
  if (!Number.isSafeInteger(actual) || !Number.isSafeInteger(startedAt)) return null;
  const offset = actual - startedAt;
  return offset < MIN_OFFSET_MS || offset > MAX_OFFSET_MS ? null : offset;
}
