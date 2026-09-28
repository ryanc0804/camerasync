import 'api_client.dart';

/// A recording session, as shaped by the server's `publicSession`
/// (apps/server/src/routes/recordings.js).
class RecordingSession {
  const RecordingSession({
    required this.id,
    required this.name,
    required this.status,
    required this.activeMemberCount,
    required this.isJoined,
    this.scheduledAt,
  });

  final String id;
  final String name;
  final String status;
  final int activeMemberCount;
  final bool isJoined;
  final DateTime? scheduledAt;

  bool get isActive => status == 'active';
  bool get isScheduled => status == 'scheduled';

  factory RecordingSession.fromJson(Map<String, dynamic> json) =>
      RecordingSession(
        id: json['id'] as String,
        name: (json['name'] ?? '').toString(),
        status: (json['status'] ?? '').toString(),
        activeMemberCount: (json['activeMemberCount'] as num?)?.toInt() ?? 0,
        isJoined: json['isJoined'] == true,
        scheduledAt: json['scheduledAt'] == null
            ? null
            : DateTime.tryParse(json['scheduledAt'].toString())?.toLocal(),
      );
}

/// REST calls for recording sessions, mirroring apps/web/src/api/recordings.js.
class RecordingsApi {
  const RecordingsApi(this._api);

  final ApiClient _api;

  /// Sessions visible to the current user's groups.
  Future<List<RecordingSession>> getSessions() async {
    final data = await _api.get('/api/recordings/sessions');
    final sessions = (data as Map)['sessions'] as List;
    return sessions
        .map((s) => RecordingSession.fromJson(Map<String, dynamic>.from(s)))
        .toList();
  }

  /// Joins (or re-joins) a session, which also flips a scheduled session to
  /// active. Must succeed before the socket room will accept this user.
  Future<RecordingSession> joinSession(String id) async {
    final data = await _api.post('/api/recordings/sessions/$id/join');
    return RecordingSession.fromJson(
      Map<String, dynamic>.from((data as Map)['session'] as Map),
    );
  }

  /// Records that this user finished a video for the recording that started
  /// at [startedAtMs] (server clock), so the session's video counts include
  /// it even if the upload itself fails. Safe to repeat.
  Future<void> saveRecordingDetails(String id, int startedAtMs) =>
      _api.post('/api/recordings/sessions/$id/videos', {
        'startedAt': startedAtMs,
      });

  /// Uploads a finished recording so it appears in the session's playback.
  ///
  /// [startedAtMs] must be the server-clock start the whole session shared
  /// (see `RecordingStartCommand.serverStartAtEpochMs`); the server lines this
  /// angle up with every other device's by that value.
  Future<void> uploadSessionVideo(
    String id,
    int startedAtMs,
    String filePath, {
    String? filename,
  }) =>
      _api.postFile(
        '/api/files/upload'
        '?sessionId=${Uri.encodeQueryComponent(id)}&startedAt=$startedAtMs',
        filePath: filePath,
        filename: filename,
      );
}
