import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:camerasync_mobile/api/api_client.dart';

/// Exercises [ApiClient.postFile] against a tiny local HTTP server, since the
/// real upload route lives in apps/server and needs Postgres.
void main() {
  late HttpServer server;
  late Directory tempDir;
  late File clip;

  setUp(() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    tempDir = await Directory.systemTemp.createTemp('camerasync_upload_test');
    clip = File('${tempDir.path}/clip.mp4');
    await clip.writeAsBytes(List<int>.generate(64, (i) => i));
  });

  tearDown(() async {
    await server.close(force: true);
    await tempDir.delete(recursive: true);
  });

  String baseUrl() => 'http://${server.address.address}:${server.port}';

  test('postFile sends a multipart form with the cookie and file', () async {
    late HttpRequest received;
    late String body;
    server.listen((req) async {
      received = req;
      body = await utf8.decoder.bind(req).join();
      req.response
        ..statusCode = 201
        ..headers.contentType = ContentType.json
        ..write(jsonEncode({'file': {'id': 'abc.mp4'}}));
      await req.response.close();
    });

    final api = ApiClient(baseUrl());
    final data = await api.postFile(
      '/api/files/upload?sessionId=abc123&startedAt=5',
      filePath: clip.path,
      filename: 'clip.mp4',
    );

    expect(received.method, 'POST');
    expect(received.uri.path, '/api/files/upload');
    expect(received.uri.queryParameters, {'sessionId': 'abc123', 'startedAt': '5'});
    expect(received.headers.contentType?.mimeType, 'multipart/form-data');
    expect(body, contains('name="file"'));
    expect(body, contains('filename="clip.mp4"'));
    expect((data as Map)['file']['id'], 'abc.mp4');
  });

  test('postFile surfaces the server error message', () async {
    server.listen((req) async {
      await req.drain<void>();
      req.response
        ..statusCode = 415
        ..headers.contentType = ContentType.json
        ..write(jsonEncode({'error': 'Unsupported file type.'}));
      await req.response.close();
    });

    final api = ApiClient(baseUrl());

    await expectLater(
      api.postFile('/api/files/upload', filePath: clip.path),
      throwsA(
        isA<ApiException>()
            .having((e) => e.statusCode, 'statusCode', 415)
            .having((e) => e.message, 'message', 'Unsupported file type.'),
      ),
    );
  });
}
