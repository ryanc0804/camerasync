// Point at your running server.
//   Android emulator : 10.0.2.2 reaches the host machine
//   Physical device  : your machine's LAN IP, or use `adb reverse tcp:4000
//                      tcp:4000` and keep localhost
// Override at run time:
//   flutter run --dart-define=SERVER_URL=http://192.168.1.50:4000
//
// Store builds use production (the default); local testing passes
// SERVER_URL, e.g. http://localhost:4000 with adb reverse.
const String kServerUrl = String.fromEnvironment(
  'SERVER_URL',
  defaultValue: 'https://8kount.app',
);
