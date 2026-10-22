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

  group('JumpAim', () {
    final start = DateTime(2026, 10, 22, 12);
    DateTime at(int ms) => start.add(Duration(milliseconds: ms));

    test('jumps an angle that is far off, but not one a little off', () {
      final aim = JumpAim();
      expect(aim.shouldJump(-300, at(0)), isFalse);
      expect(aim.shouldJump(-900, at(0)), isTrue);
    });

    test('learns from a landing behind to aim further ahead', () {
      final aim = JumpAim();
      aim.jumped(at(0));
      // Landed 700 ms behind the others.
      expect(aim.shouldJump(-700, at(600)), isFalse); // too soon to jump again
      expect(aim.lead, const Duration(milliseconds: 700));
      // Still behind after the cool-down: jump again, now aimed ahead.
      expect(aim.shouldJump(-650, at(1600)), isTrue);
    });

    test('aims less far after overshooting, never behind', () {
      final aim = JumpAim()..lead = const Duration(milliseconds: 400);
      aim.jumped(at(0));
      aim.shouldJump(250, at(600)); // landed 250 ms ahead
      expect(aim.lead, const Duration(milliseconds: 150));
      aim.jumped(at(2000));
      aim.shouldJump(500, at(2600));
      expect(aim.lead, Duration.zero);
    });

    test('waits for a jump to settle before judging where it landed', () {
      final aim = JumpAim();
      aim.jumped(at(0));
      aim.shouldJump(-2000, at(200)); // still loading the jump
      expect(aim.lead, Duration.zero);
    });
  });
}
