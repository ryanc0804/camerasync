/// Seconds to skip at the start of each angle so a take's angles line up.
///
/// Cameras don't all begin at the take's shared start: phones start a moment
/// late, by a different amount each time. Each video reports how much later
/// it really began (startOffsetMs). The shared timeline starts when the last
/// camera began, and every earlier angle skips ahead by how much earlier it
/// started. Angles that didn't report count as on time.
///
/// Returns a Map of userId -> seconds to skip.
export function angleTrims(videos) {
  const reported = videos.filter((video) => video?.url);
  const offsets = reported.map((video) => video.startOffsetMs ?? 0);
  const latest = offsets.length ? Math.max(...offsets) : 0;
  return new Map(
    reported.map((video, index) => [video.userId, (latest - offsets[index]) / 1000])
  );
}
