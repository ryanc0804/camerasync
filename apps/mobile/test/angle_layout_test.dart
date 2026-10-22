import 'dart:ui';

import 'package:camerasync_mobile/recordings/angle_layout.dart';
import 'package:flutter_test/flutter_test.dart';

const h = 16 / 9;
const v = 9 / 16;

void main() {
  test('a phone held sideways shows four horizontal angles as 2 x 2', () {
    final g = bestGrid(const Size(700, 300), 4, h);
    expect([g.columns, g.rows], [2, 2]);
  });

  test('vertical angles line up in one row when sideways', () {
    expect(bestGrid(const Size(700, 300), 4, v).columns, 4);
  });

  test('a TV fits a 3 x 3 of horizontal angles', () {
    // A 1080p TV in DeX, less the title, timeline and controls.
    expect(anglesPerPage(const Size(1878, 820), h), 9);
  });

  test('a small window fits fewer, but always one', () {
    expect(anglesPerPage(const Size(900, 300), h), lessThan(9));
    expect(anglesPerPage(const Size(200, 100), h), 1);
  });

  test('the usual shape wins, horizontal before any load', () {
    expect(commonAspect(const []), closeTo(h, 0.001));
    expect(commonAspect(const [h, h, v]), closeTo(h, 0.001));
    expect(commonAspect(const [v, v, null]), closeTo(v, 0.001));
  });

  test('grid tiles stay on screen, keep their shape and never overlap', () {
    for (final size in const [Size(700, 300), Size(1200, 640), Size(360, 600)]) {
      for (final aspect in const [h, v]) {
        for (var count = 1; count <= 6; count++) {
          final rects = gridLayout(size, count, aspect);
          expect(rects, hasLength(count));
          for (final r in rects) {
            expect(r.left >= -0.01 && r.top >= -0.01, isTrue);
            expect(r.right <= size.width + 0.01 && r.bottom <= size.height + 0.01, isTrue);
            expect(r.width / r.height, closeTo(aspect, 0.001));
          }
          for (var a = 0; a < count; a++) {
            for (var b = a + 1; b < count; b++) {
              expect(rects[a].deflate(0.01).overlaps(rects[b].deflate(0.01)), isFalse);
            }
          }
        }
      }
    }
  });

  group('usePreviews', () {
    // A 1080p TV as Android often reports it: 640 x 360 points at 3x.
    const tv = Size(640, 360);

    test('plays one angle on its own at full quality', () {
      expect(usePreviews(tv, 1, 3), isFalse);
    });

    test('plays previews once the tiles are small', () {
      expect(usePreviews(tv, 6, 3), isTrue);
      expect(usePreviews(tv, 4, 3), isTrue);
    });

    test('keeps the originals while two angles are each big on a 4K TV', () {
      // 3840 x 2160 at 2x: two side by side are ~1900 px wide each.
      expect(usePreviews(const Size(1920, 1080), 2, 2), isFalse);
    });
  });
}
