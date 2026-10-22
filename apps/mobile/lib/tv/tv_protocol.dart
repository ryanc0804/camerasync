/// Messages between the phone and the TV screen (see tv_link.dart and
/// tv_screen.dart). Values are plain maps and lists so they cross between
/// the two Flutter engines unchanged.
abstract final class TvAction {
  // Phone → TV.

  /// Shows one recording: `{session, recording, cookie, angles: [{name,
  /// url, trimMs}], atMs, playing}`.
  static const load = 'load';

  /// Back to the idle screen.
  static const idle = 'idle';

  /// `{atMs}`: start or stop every angle at that moment.
  static const play = 'play';
  static const pause = 'pause';

  /// `{atMs}`
  static const seek = 'seek';

  /// `{page}`
  static const page = 'page';

  /// `{angle}`: an index into the loaded angles, or -1 for the grid.
  static const focus = 'focus';

  /// `{author, body}` while a comment is up, or null.
  static const comment = 'comment';

  /// `{angle}`: the angle whose sound plays (an index into the loaded
  /// angles), or -1 for none. Only one plays at a time.
  static const sound = 'sound';

  // TV → phone.

  /// `{positionMs, durationMs, playing, page, pageCount, focused, sound}`,
  /// several times a second.
  static const state = 'state';
}

/// What the TV reports back.
class TvState {
  const TvState({
    required this.position,
    required this.duration,
    required this.playing,
    required this.page,
    required this.pageCount,
    required this.focused,
    this.sound,
  });

  final Duration position;
  final Duration duration;
  final bool playing;
  final int page;
  final int pageCount;

  /// The expanded angle, or null for the grid.
  final int? focused;

  /// The angle whose sound is playing, or null when muted.
  final int? sound;

  Map<String, Object?> toMap() => {
        'positionMs': position.inMilliseconds,
        'durationMs': duration.inMilliseconds,
        'playing': playing,
        'page': page,
        'pageCount': pageCount,
        'focused': focused ?? -1,
        'sound': sound ?? -1,
      };

  static TvState? fromMap(Object? value) {
    if (value is! Map) return null;
    int number(String key) => (value[key] as num?)?.toInt() ?? 0;
    final focused = number('focused');
    final sound = (value['sound'] as num?)?.toInt() ?? -1;
    return TvState(
      position: Duration(milliseconds: number('positionMs')),
      duration: Duration(milliseconds: number('durationMs')),
      playing: value['playing'] == true,
      page: number('page'),
      pageCount: number('pageCount'),
      focused: focused < 0 ? null : focused,
      sound: sound < 0 ? null : sound,
    );
  }
}
