# 8kount copy of camera_avfoundation 0.9.23+2

Upstream plugin, unchanged except:

- `FirstFrameClock.swift` (new, in ios/.../Sources/camera_avfoundation): the
  wall-clock time of the current recording's first frame, from the
  presentation time the writer starts the file at; answers `get` on the
  `app.eightkount/first_frame` method channel.
- `DefaultCamera.swift`: resets it when recording starts and notes it at the
  first video sample (next to `startSession(atSourceTime:)`).
- `CameraPlugin.register(with:)`: sets up that channel.
- `DefaultCamera.swift`, `restoreMicrophoneIfNeeded()` (new, called from
  `setupWriter`): puts the audio session back to play-and-record and restarts
  the audio capture session at the start of each recording. Upstream sets it
  up once; the video player or a sound player switching the session to
  playback afterwards stopped the microphone for good.
- `DefaultCamera.captureOutput`: no longer requires the audio capture session
  to be running before writing video. Upstream did, so a stopped microphone
  made every later recording an empty file (seen 2026-10-22).

To update the plugin, copy the new upstream version over this folder and
reapply those changes.
