import 'package:video_player/video_player.dart';

/// Keeps a take's angles on one timeline while they play, so every angle
/// shows the same real moment. Each video is untouched: this only decides
/// which of its frames is on screen when.
///
/// Players each run on their own clock and drift apart. An angle a little
/// off plays slightly faster or slower ([speedFor]) until it's back in line,
/// which can't be seen; one far off (it stalled to load) jumps back. Same
/// rules as the web player (PlaybackScreen.jsx).
class AngleSync {
  AngleSync._();

  /// Closer than this counts as in line: under half a frame at 30 fps.
  static const inLineMs = 15;

  /// Further than this is caught up by jumping straight to the right frame.
  static const jumpBeyondMs = 400;

  /// The most an angle's speed is changed by while catching up (5%).
  static const maxNudge = 0.05;

  /// Speed for an angle [driftMs] ahead of where it should be (negative:
  /// behind). Corrects about two thirds of the drift each second.
  static double speedFor(int driftMs) {
    if (driftMs.abs() <= inLineMs) return 1.0;
    final nudge = (driftMs / 1000 * 0.66).clamp(-maxNudge, maxNudge);
    return 1.0 - nudge;
  }

  /// Brings each of [others] (player -> its trim) in line with [clock],
  /// whose own trim is [clockTrim]. Positions are read fresh from the
  /// players, not from their values, which only update every 100 ms.
  static Future<void> keepInLine({
    required VideoPlayerController clock,
    required Duration clockTrim,
    required Map<VideoPlayerController, Duration> others,
  }) async {
    final players = others.keys.toList();
    final positions = await Future.wait(
        [clock.position, for (final player in players) player.position]);
    final clockAt = positions.first;
    if (clockAt == null) return;
    final timeline = clockAt - clockTrim;
    for (var k = 0; k < players.length; k++) {
      final player = players[k];
      final at = positions[k + 1];
      final value = player.value;
      if (at == null || !value.isInitialized || value.isBuffering) continue;
      final target = timeline + others[player]!;
      if (target < Duration.zero || target >= value.duration) continue;
      final driftMs = (at - target).inMilliseconds;
      if (driftMs.abs() > jumpBeyondMs) {
        await player.seekTo(target);
        await _setSpeed(player, 1.0);
      } else {
        await _setSpeed(player, speedFor(driftMs));
      }
    }
  }

  /// Back to normal speed, for a pause or a seek, where every angle is put
  /// on the exact same moment instead.
  static Future<void> resetSpeeds(Iterable<VideoPlayerController> players) =>
      Future.wait([for (final player in players) _setSpeed(player, 1.0)]);

  static Future<void> _setSpeed(VideoPlayerController player, double speed) {
    if ((player.value.playbackSpeed - speed).abs() < 0.002) {
      return Future.value();
    }
    return player.setPlaybackSpeed(speed).catchError((_) {});
  }
}
