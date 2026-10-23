# 8kount copy of camera_android_camerax 0.6.30

Upstream plugin, unchanged except:

- `FirstFrameClock.java` (new): estimates when the current recording's first
  frame was captured, on the phone's wall clock, from CameraX's progress events,
  and answers `get` on the `app.eightkount/first_frame` method channel.
- `PendingRecordingProxyApi.start`: passes each recording event to
  `FirstFrameClock` before the plugin's own listener.
- `CameraAndroidCameraxPlugin.onAttachedToEngine`: sets up that channel.

- Removed (not needed to build): upstream unit tests, pigeons/ (code-generator
  inputs; the output is in lib/), changelog, contributing guide, README, lint
  baseline and the test-only parts of android/build.gradle.

To update the plugin, copy the new upstream version over this folder and
reapply those three changes.
