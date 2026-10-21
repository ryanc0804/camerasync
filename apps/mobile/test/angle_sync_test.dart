import 'package:camerasync_mobile/playback/angle_sync.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('AngleSync.speedFor', () {
    test('leaves an angle within half a frame alone', () {
      expect(AngleSync.speedFor(0), 1.0);
      expect(AngleSync.speedFor(15), 1.0);
      expect(AngleSync.speedFor(-15), 1.0);
    });

    test('slows an angle that is ahead and speeds up one that is behind', () {
      expect(AngleSync.speedFor(30), lessThan(1.0));
      expect(AngleSync.speedFor(-30), greaterThan(1.0));
      expect(AngleSync.speedFor(30), closeTo(1 - 0.0198, 1e-9));
    });

    test('never changes speed by more than 5%', () {
      expect(AngleSync.speedFor(390), 0.95);
      expect(AngleSync.speedFor(-390), 1.05);
    });
  });
}
