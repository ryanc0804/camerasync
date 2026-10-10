import 'package:camerasync_mobile/api/recordings_api.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('earlier angles skip ahead to the last camera\'s start', () {
    // The laptop began on time and the phone 870 ms late, so the laptop
    // skips 870 ms and both show the same moment.
    final trims = angleTrims(const [
      AngleVideo(userId: 1, name: 'Laptop', url: '/a.webm', startOffsetMs: 0),
      AngleVideo(userId: 2, name: 'Phone', url: '/b.mp4', startOffsetMs: 870),
    ]);
    expect(trims[0], const Duration(milliseconds: 870));
    expect(trims[1], Duration.zero);
  });

  test('angles that did not report count as on time; missing ones are left out', () {
    final trims = angleTrims(const [
      AngleVideo(userId: 1, name: 'A', url: '/a.webm'),
      AngleVideo(userId: 2, name: 'B', url: '/b.mp4', startOffsetMs: 300),
      AngleVideo(userId: 3, name: 'C', startOffsetMs: 5000),
    ]);
    expect(trims[0], const Duration(milliseconds: 300));
    expect(trims[1], Duration.zero);
    expect(trims.containsKey(2), isFalse);
  });

  test('reads startOffsetMs from the server', () {
    final video = AngleVideo.fromJson(
        {'userId': 2, 'name': 'Phone', 'url': '/b.mp4', 'startOffsetMs': 870});
    expect(video.startOffsetMs, 870);
    expect(AngleVideo.fromJson({'userId': 1, 'startOffsetMs': null}).startOffsetMs,
        isNull);
  });
}
