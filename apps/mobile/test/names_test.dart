import 'package:flutter_test/flutter_test.dart';

import 'package:camerasync_mobile/recordings/names.dart';

void main() {
  test('recordingDisplayName pads the number and uses local time', () {
    final local = DateTime(2026, 9, 30, 14, 5, 9);
    expect(
      recordingDisplayName(local.millisecondsSinceEpoch, 3),
      '26-09-30 14:05:09 - Recording 003',
    );
  });

  test('formatClock switches to hours when needed', () {
    expect(formatClock(const Duration(seconds: 5)), '00:05');
    expect(formatClock(const Duration(minutes: 10, seconds: 23)), '10:23');
    expect(formatClock(const Duration(hours: 1, minutes: 2, seconds: 3)), '1:02:03');
  });
}
