# Camera Sync — Mobile (Flutter)

The recording app. Members join a session, grant camera/mic permission, and
record when the admin fires the synchronized start command.

## What's here

Real app source is committed:

```
lib/
  main.dart                  # app entry + join screen
  screens/session_screen.dart# recording view, permissions, sync start/stop
  socket/sync_socket.dart    # Socket.IO client + clock-offset sync
  socket/events.dart         # event-name contract (mirrors the server)
test/widget_test.dart
pubspec.yaml
```

The platform folders (`android/`, `ios/`, etc.) are **not** committed — they're
generated. Flutter wasn't available in the scaffolding environment.

## First-time setup

From this directory, with the Flutter SDK installed:

```bash
# Generates android/ ios/ etc. WITHOUT overwriting the committed lib/ + pubspec
flutter create --org com.camerasync --project-name camerasync_mobile .
flutter pub get
flutter run
```

`flutter create .` over an existing project only adds the missing platform
scaffolding; it leaves `lib/`, `pubspec.yaml`, and `test/` intact.

## Running against the server

- Android emulator: server is reachable at `http://10.0.2.2:4000` (the default).
- Physical device: pass your machine's LAN IP, e.g.
  `flutter run --dart-define=SERVER_URL=http://192.168.1.50:4000`

## Permissions (per MVP)

Camera + mic are requested only on entering the recording view and released on
exit — no background access. Native permission strings still need to be added
after `flutter create`:

- iOS: `NSCameraUsageDescription` + `NSMicrophoneUsageDescription` in `Info.plist`
- Android: `CAMERA` + `RECORD_AUDIO` in `AndroidManifest.xml`

## Socket contract

Event names live in `lib/socket/events.dart` and mirror
[`apps/server/src/sockets/events.js`](../server/src/sockets/events.js). On
`recording:started`, the server's `startAtEpochMs` is converted to this device's
local clock (via the measured offset) so every device begins at the same instant.
