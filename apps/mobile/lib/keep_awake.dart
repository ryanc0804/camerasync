import 'package:wakelock_plus/wakelock_plus.dart';

/// Keeps the screen on while any screen that records or runs a live session
/// is open, so a phone left on the camera between takes doesn't lock. A
/// locked phone drops its connection and its camera, and then starts the
/// next take seconds late or not at all.
///
/// Counted, because those screens nest (a session holds its camera screen):
/// the screen may sleep again only once the last of them has closed.
class KeepAwake {
  KeepAwake._();

  static int _holders = 0;

  static void acquire() {
    _holders += 1;
    if (_holders == 1) WakelockPlus.enable().catchError((_) {});
  }

  static void release() {
    if (_holders == 0) return;
    _holders -= 1;
    if (_holders == 0) WakelockPlus.disable().catchError((_) {});
  }
}
