import 'package:camerasync_mobile/tv/tv_protocol.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('the TV state survives the trip to the phone', () {
    const state = TvState(
      position: Duration(milliseconds: 4250),
      duration: Duration(seconds: 20),
      playing: true,
      page: 1,
      pageCount: 2,
      focused: 3,
      sound: 2,
    );
    final back = TvState.fromMap(state.toMap())!;
    expect(back.position, state.position);
    expect(back.duration, state.duration);
    expect(back.playing, isTrue);
    expect([back.page, back.pageCount, back.focused], [1, 2, 3]);
    expect(back.sound, 2);
  });

  test('no angle expanded comes back as null', () {
    const state = TvState(
      position: Duration.zero,
      duration: Duration.zero,
      playing: false,
      page: 0,
      pageCount: 1,
      focused: null,
    );
    expect(TvState.fromMap(state.toMap())!.focused, isNull);
    // Muted.
    expect(TvState.fromMap(state.toMap())!.sound, isNull);
    expect(TvState.fromMap('not a map'), isNull);
  });
}
