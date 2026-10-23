# 8kount copy of camera_avfoundation 0.9.23+2

Upstream plugin, unchanged except:

- `FirstFrameClock.swift` (new, in ios/.../Sources/camera_avfoundation): the
  wall-clock time of the current recording's first frame, from the
  presentation time the writer starts the file at; answers `get` on the
  `app.eightkount/first_frame` method channel.
- `DefaultCamera.swift`: resets it when recording starts and notes it at the
  first video sample (next to `startSession(atSourceTime:)`).
- `CameraPlugin.register(with:)`: sets up that channel.

- Removed (not needed to build): pigeons/ (code-generator inputs; the output
  is in lib/), changelog and README.

To update the plugin, copy the new upstream version over this folder and
reapply those changes.
