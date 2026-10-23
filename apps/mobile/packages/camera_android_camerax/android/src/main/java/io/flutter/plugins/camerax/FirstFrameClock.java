// Added for 8kount (not part of the upstream plugin).

package io.flutter.plugins.camerax;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.camera.video.VideoRecordEvent;
import io.flutter.plugin.common.BinaryMessenger;
import io.flutter.plugin.common.MethodChannel;

/**
 * When the current recording's first frame was captured, on this phone's wall
 * clock (ms since the epoch), so the app can line angles up by time instead of
 * by sound.
 *
 * <p>CameraX doesn't report that moment, but every progress event says how much
 * has been recorded so far. The first frame came that long before the event,
 * plus however long the event took to arrive, so the earliest of these
 * estimates over the first few seconds is the closest.
 */
final class FirstFrameClock {
  private FirstFrameClock() {}

  /** Only the first seconds of a take are used: plenty of events by then. */
  private static final long WINDOW_NANOS = 3_000_000_000L;

  @Nullable private static Long estimateMs;
  private static int samples;

  static synchronized void onEvent(@NonNull VideoRecordEvent event) {
    if (event instanceof VideoRecordEvent.Start) {
      estimateMs = null;
      samples = 0;
      return;
    }
    if (!(event instanceof VideoRecordEvent.Status)) return;
    long recordedNanos = event.getRecordingStats().getRecordedDurationNanos();
    if (recordedNanos <= 0 || recordedNanos > WINDOW_NANOS) return;
    long estimate = System.currentTimeMillis() - recordedNanos / 1_000_000L;
    if (estimateMs == null || estimate < estimateMs) estimateMs = estimate;
    samples += 1;
  }

  static synchronized void setUp(@NonNull BinaryMessenger messenger) {
    new MethodChannel(messenger, "app.eightkount/first_frame")
        .setMethodCallHandler(
            (call, result) -> {
              if ("get".equals(call.method)) {
                synchronized (FirstFrameClock.class) {
                  // A few events in, so the earliest estimate has settled.
                  result.success(samples >= 3 ? estimateMs : null);
                }
              } else {
                result.notImplemented();
              }
            });
  }
}
