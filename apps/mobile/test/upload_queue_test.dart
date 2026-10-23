import 'dart:io';

import 'package:camerasync_mobile/api/recordings_api.dart';
import 'package:camerasync_mobile/outbox/upload_queue.dart';
import 'package:flutter_test/flutter_test.dart';

/// Records what was uploaded, in order.
class _FakeApi implements RecordingsApi {
  final sent = <String>[];

  @override
  Future<void> saveRecordingDetails(String id, int startedAtMs,
      {int? actualStartedAtMs, String? startClock}) async {}

  @override
  Future<void> uploadSessionVideo(String id, int startedAtMs, String filePath,
      {String? filename,
      int? actualStartedAtMs,
      String? startClock,
      bool preview = false,
      Duration timeout = const Duration(minutes: 10)}) async {
    sent.add('${preview ? 'preview' : 'full'} $startedAtMs');
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory dir;
  setUp(() => dir = Directory.systemTemp.createTempSync('outbox'));
  tearDown(() => dir.deleteSync(recursive: true));

  Future<String> take(String name, int bytes) async {
    final file = File('${dir.path}/$name.mp4');
    await file.writeAsBytes(List.filled(bytes, 1));
    return file.path;
  }

  Future<void> settle(UploadQueue queue) async {
    for (var i = 0; i < 100 && (queue.waiting > 0 || queue.sending != null); i++) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
  }

  test('sends every waiting preview before any full video', () async {
    final api = _FakeApi();
    final queue = UploadQueue(api,
        dir: Directory('${dir.path}/queue')..createSync(),
        makePreview: (path) async {
      final copy = File('$path.small.mp4');
      await copy.writeAsBytes(List.filled(8192, 2));
      return copy.path;
    });
    queue.pause('take');
    for (final at in [1, 2]) {
      await queue.add(
          sessionId: 's',
          startedAtMs: at,
          sourcePath: await take('t$at', UploadQueue.previewFromBytes),
          filename: 't$at.mp4');
    }
    queue.resume('take');
    await settle(queue);
    expect(api.sent, ['preview 1', 'preview 2', 'full 1', 'full 2']);
    // Nothing left behind on the phone.
    expect(Directory('${dir.path}/queue').listSync().whereType<File>()
        .where((f) => f.path.endsWith('.mp4')), isEmpty);
  });

  test('a small take, or one whose preview fails, goes as it is', () async {
    final api = _FakeApi();
    final queue = UploadQueue(api,
        dir: Directory('${dir.path}/queue')..createSync(),
        makePreview: (_) async => null);
    await queue.add(
        sessionId: 's',
        startedAtMs: 1,
        sourcePath: await take('big', UploadQueue.previewFromBytes),
        filename: 'big.mp4');
    await settle(queue);
    await queue.add(
        sessionId: 's',
        startedAtMs: 2,
        sourcePath: await take('small', 8192),
        filename: 'small.mp4');
    await settle(queue);
    expect(api.sent, ['full 1', 'full 2']);
  });
}
