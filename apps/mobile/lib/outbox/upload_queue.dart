import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/widgets.dart';
import 'package:path_provider/path_provider.dart';

import '../api/api_client.dart';
import '../api/recordings_api.dart';

/// One finished take waiting to reach the server.
class QueuedTake {
  QueuedTake({
    required this.id,
    required this.sessionId,
    required this.startedAtMs,
    required this.path,
    required this.filename,
    this.actualStartedAtMs,
    this.startClock,
    this.attempts = 0,
  });

  final String id;
  final String sessionId;

  /// The take's shared server-clock start; the server files angles by it.
  final int startedAtMs;
  final int? actualStartedAtMs;

  /// 'frame' when [actualStartedAtMs] is the first frame's capture time.
  final String? startClock;

  /// Where the video sits in the app's own storage until it's uploaded.
  final String path;
  final String filename;
  int attempts;

  /// When the next try may start, after a failed one.
  DateTime? retryAt;
  String? lastError;

  Map<String, dynamic> toJson() => {
        'id': id,
        'sessionId': sessionId,
        'startedAtMs': startedAtMs,
        'actualStartedAtMs': actualStartedAtMs,
        'startClock': startClock,
        'path': path,
        'filename': filename,
        'attempts': attempts,
      };

  static QueuedTake fromJson(Map<String, dynamic> json) => QueuedTake(
        id: json['id'] as String,
        sessionId: json['sessionId'] as String,
        startedAtMs: (json['startedAtMs'] as num).toInt(),
        actualStartedAtMs: (json['actualStartedAtMs'] as num?)?.toInt(),
        startClock: json['startClock'] as String?,
        path: json['path'] as String,
        filename: json['filename'] as String,
        attempts: (json['attempts'] as num?)?.toInt() ?? 0,
      );
}

/// What the queue last did with a take, for the status shown on the camera.
enum UploadEvent { uploaded, unrecorded, rejected }

/// The phone's outbox of finished takes. Every take is moved into the app's
/// own storage and listed here before it's sent, so nothing is lost to a
/// bad connection, a new take, leaving the camera or closing the app: the
/// list is saved and picked up again the next time the app opens.
///
/// Takes go one at a time, and a failed one is tried again after a growing
/// wait (5 s, 15 s, 30 s, 1 min, 2 min, then every 5 min) until it gets
/// through. No upload starts while a take is starting or running ([pause]),
/// so the start and stop messages aren't stuck behind video on a slow
/// network; one already sending is let finish.
class UploadQueue extends ChangeNotifier {
  UploadQueue(this._api);

  /// The app's queue, made when the user is signed in (see HomeShell).
  static UploadQueue? instance;

  final RecordingsApi _api;
  final List<QueuedTake> _items = [];
  final Set<String> _pausedFor = {};
  Directory? _dir;
  bool _loaded = false;
  bool _running = false;
  Timer? _wake;
  late final AppLifecycleListener _lifecycle =
      AppLifecycleListener(onResume: kick);

  /// The take being sent right now, if any.
  QueuedTake? sending;

  /// The most recent outcome, and when, for a short message on the camera.
  UploadEvent? lastEvent;
  DateTime? lastEventAt;

  List<QueuedTake> get items => List.unmodifiable(_items);
  int get waiting => _items.length;
  bool get paused => _pausedFor.isNotEmpty;

  /// The soonest a failed take will be tried again, when nothing is sending.
  DateTime? get nextRetryAt {
    DateTime? soonest;
    for (final item in _items) {
      final at = item.retryAt;
      if (at != null && (soonest == null || at.isBefore(soonest))) soonest = at;
    }
    return soonest;
  }

  /// Takes smaller than this have no video in them: the camera was
  /// interrupted before writing a frame (seen on iPhones), and the server
  /// would only reject them.
  static const minVideoBytes = 4096;

  static const _retryDelays = [5, 15, 30, 60, 120, 300];

  Future<void> start() async {
    if (_loaded) return;
    _loaded = true;
    _lifecycle; // starts listening for the app coming back
    final dir = await _storage();
    final file = File('${dir.path}/queue.json');
    try {
      if (await file.exists()) {
        final list = jsonDecode(await file.readAsString()) as List;
        for (final json in list) {
          final item = QueuedTake.fromJson(Map<String, dynamic>.from(json as Map));
          if (await File(item.path).exists()) _items.add(item);
        }
      }
    } catch (e) {
      debugPrint('Upload queue could not be read: $e');
    }
    notifyListeners();
    kick();
  }

  /// Adds a finished take. The video is moved out of the camera's temporary
  /// folder (which the phone may clear) into the app's own storage first.
  Future<void> add({
    required String sessionId,
    required int startedAtMs,
    int? actualStartedAtMs,
    String? startClock,
    required String sourcePath,
    required String filename,
  }) async {
    await start();
    final source = File(sourcePath);
    final size = await source.exists() ? await source.length() : 0;
    if (size < minVideoBytes) {
      await source.delete().catchError((_) => source);
      _event(UploadEvent.unrecorded);
      return;
    }
    final dir = await _storage();
    final id = '${DateTime.now().microsecondsSinceEpoch}';
    final ext = filename.contains('.') ? filename.split('.').last : 'mp4';
    final dest = '${dir.path}/$id.$ext';
    try {
      await source.rename(dest);
    } on FileSystemException {
      await source.copy(dest);
      await source.delete().catchError((_) => source);
    }
    _items.add(QueuedTake(
      id: id,
      sessionId: sessionId,
      startedAtMs: startedAtMs,
      actualStartedAtMs: actualStartedAtMs,
      startClock: startClock,
      path: dest,
      filename: filename,
    ));
    await _save();
    notifyListeners();
    kick();
  }

  /// Holds new uploads back while [reason] lasts (a take starting or
  /// running); [resume] with the same reason lets them go again.
  void pause(String reason) {
    if (_pausedFor.add(reason)) notifyListeners();
  }

  void resume(String reason) {
    if (_pausedFor.remove(reason)) {
      notifyListeners();
      kick();
    }
  }

  /// Tries every waiting take now, without waiting out its retry time (the
  /// "Try now" button, after moving somewhere with better signal).
  void retryNow() {
    for (final item in _items) {
      item.retryAt = null;
    }
    kick();
  }

  /// Tries the queue now: after a new take, coming back to the app, or the
  /// end of a pause. Failed takes still wait out their retry time.
  void kick() {
    if (_running || paused || _items.isEmpty) return;
    unawaited(_run());
  }

  Future<void> _run() async {
    _running = true;
    _wake?.cancel();
    try {
      while (!paused) {
        final now = DateTime.now();
        final next = _items
            .where((item) => item.retryAt == null || !item.retryAt!.isAfter(now))
            .firstOrNull;
        if (next == null) break;
        await _send(next);
      }
    } finally {
      _running = false;
      sending = null;
      notifyListeners();
      _scheduleWake();
    }
  }

  Future<void> _send(QueuedTake item) async {
    sending = item;
    notifyListeners();
    try {
      await _api.saveRecordingDetails(item.sessionId, item.startedAtMs,
          actualStartedAtMs: item.actualStartedAtMs, startClock: item.startClock);
      await _api.uploadSessionVideo(
        item.sessionId,
        item.startedAtMs,
        item.path,
        filename: item.filename,
        actualStartedAtMs: item.actualStartedAtMs,
        startClock: item.startClock,
        timeout: const Duration(minutes: 30),
      );
      await _remove(item);
      _event(UploadEvent.uploaded);
    } on ApiException catch (e) {
      // The server looked at it and said no (not a video, session gone):
      // trying again won't change that. Anything else (no connection, the
      // server busy, signed out) is worth another go.
      final permanent = e.statusCode >= 400 &&
          e.statusCode < 500 &&
          !const {401, 403, 408, 429}.contains(e.statusCode);
      if (permanent) {
        debugPrint('Upload rejected (${e.statusCode}): ${e.message}');
        await _remove(item);
        _event(UploadEvent.rejected);
      } else {
        _failed(item, e.message);
      }
    } catch (e) {
      _failed(item, '$e');
    }
  }

  void _failed(QueuedTake item, String error) {
    item.attempts += 1;
    item.lastError = error;
    final wait = _retryDelays[math.min(item.attempts - 1, _retryDelays.length - 1)];
    item.retryAt = DateTime.now().add(Duration(seconds: wait));
    debugPrint('Upload failed (try ${item.attempts}), again in ${wait}s: $error');
    unawaited(_save());
    notifyListeners();
  }

  Future<void> _remove(QueuedTake item) async {
    _items.remove(item);
    await File(item.path).delete().catchError((_) => File(item.path));
    await _save();
  }

  void _event(UploadEvent event) {
    lastEvent = event;
    lastEventAt = DateTime.now();
    notifyListeners();
  }

  void _scheduleWake() {
    _wake?.cancel();
    final at = nextRetryAt;
    if (at == null || paused) return;
    final wait = at.difference(DateTime.now());
    _wake = Timer(wait.isNegative ? Duration.zero : wait, kick);
  }

  Future<Directory> _storage() async {
    final existing = _dir;
    if (existing != null) return existing;
    final base = await getApplicationSupportDirectory();
    final dir = Directory('${base.path}/upload_queue');
    await dir.create(recursive: true);
    return _dir = dir;
  }

  Future<void> _save() async {
    final dir = await _storage();
    final file = File('${dir.path}/queue.json');
    await file.writeAsString(jsonEncode([for (final item in _items) item.toJson()]));
  }
}
