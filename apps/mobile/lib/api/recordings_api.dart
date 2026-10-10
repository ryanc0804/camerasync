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
    this.groupId,
    this.scheduledAt,
    this.memberCount,
    this.totalRecordings,
    this.createdBy,
  });

  final String id;
  final String name;
  final String status;
  final int activeMemberCount;
  final bool isJoined;
  final String? groupId;
  final DateTime? scheduledAt;

  /// Null for sessions that predate attendance tracking.
  final int? memberCount;
  final int? totalRecordings;

  /// Who scheduled or started it. They can end or cancel it, and so can the
  /// group's admins and owner.
  final int? createdBy;

  bool get isActive => status == 'active';
  bool get isScheduled => status == 'scheduled';
  bool get isComplete => status == 'complete';
  bool get isCancelled => status == 'cancelled';

  factory RecordingSession.fromJson(Map<String, dynamic> json) =>
      RecordingSession(
        id: json['id'] as String,
        name: (json['name'] ?? '').toString(),
        status: (json['status'] ?? '').toString(),
        activeMemberCount: (json['activeMemberCount'] as num?)?.toInt() ?? 0,
        isJoined: json['isJoined'] == true,
        groupId: json['groupId']?.toString(),
        scheduledAt: json['scheduledAt'] == null
            ? null
            : DateTime.tryParse(json['scheduledAt'].toString())?.toLocal(),
        memberCount: (json['memberCount'] as num?)?.toInt(),
        totalRecordings: (json['totalRecordings'] as num?)?.toInt(),
        createdBy: (json['createdBy'] as num?)?.toInt(),
      );
}

/// One device's video within a recording. [url] is null when that member
/// saved a video but has not uploaded it yet.
class AngleVideo {
  const AngleVideo({
    required this.userId,
    required this.name,
    this.url,
    this.startOffsetMs,
  });

  final int userId;
  final String name;
  final String? url;

  /// How much later this camera really began than the take's shared start,
  /// or null if the device didn't report it (treated as on time).
  final int? startOffsetMs;

  factory AngleVideo.fromJson(Map<String, dynamic> json) => AngleVideo(
        userId: (json['userId'] as num).toInt(),
        name: (json['name'] ?? 'Unnamed member').toString(),
        url: json['url'] as String?,
        startOffsetMs: (json['startOffsetMs'] as num?)?.toInt(),
      );
}

/// How far to skip into each angle (by index) so a take's angles line up,
/// like angleTrims in the web app. Cameras start a moment apart, so the
/// shared timeline begins when the last one started and every earlier angle
/// skips ahead by how much earlier it began. Angles that weren't uploaded
/// are left out.
Map<int, Duration> angleTrims(List<AngleVideo> videos) {
  final offsets = <int, int>{
    for (var i = 0; i < videos.length; i++)
      if (videos[i].url != null) i: videos[i].startOffsetMs ?? 0,
  };
  if (offsets.isEmpty) return {};
  final latest = offsets.values.reduce((a, b) => a > b ? a : b);
  return {
    for (final entry in offsets.entries)
      entry.key: Duration(milliseconds: latest - entry.value),
  };
}

/// One synchronized recording within a session: every angle that shares the
/// same server-clock start.
class SessionRecording {
  const SessionRecording({
    required this.startedAtMs,
    required this.number,
    required this.videos,
  });

  final int startedAtMs;
  final int number;
  final List<AngleVideo> videos;

  factory SessionRecording.fromJson(Map<String, dynamic> json) =>
      SessionRecording(
        startedAtMs: (json['startedAt'] as num).toInt(),
        number: (json['number'] as num?)?.toInt() ?? 0,
        videos: ((json['videos'] as List?) ?? const [])
            .map((v) => AngleVideo.fromJson(Map<String, dynamic>.from(v)))
            .toList(),
      );
}

/// The recordings of one session, as returned by GET /sessions/:id/videos.
class SessionVideos {
  const SessionVideos({
    required this.sessionId,
    required this.sessionName,
    required this.recordings,
  });

  final String sessionId;
  final String sessionName;
  final List<SessionRecording> recordings;

  factory SessionVideos.fromJson(Map<String, dynamic> json) {
    final session = Map<String, dynamic>.from(json['session'] as Map);
    return SessionVideos(
      sessionId: session['id'].toString(),
      sessionName: (session['name'] ?? '').toString(),
      recordings: ((json['recordings'] as List?) ?? const [])
          .map((r) => SessionRecording.fromJson(Map<String, dynamic>.from(r)))
          .toList(),
    );
  }
}

/// A timestamped note left on a recording.
class SessionNote {
  const SessionNote({
    required this.id,
    required this.body,
    required this.videoTimeMs,
    required this.authorName,
    this.canDelete = false,
  });

  final int id;
  final String body;
  final int videoTimeMs;
  final String authorName;

  /// The server's verdict for the current user: their own note, or one by a
  /// lower group role.
  final bool canDelete;

  factory SessionNote.fromJson(Map<String, dynamic> json) => SessionNote(
        id: (json['id'] as num).toInt(),
        body: (json['body'] ?? '').toString(),
        videoTimeMs: (json['videoTimeMs'] as num?)?.toInt() ?? 0,
        authorName: (json['author'] ?? 'Unnamed member').toString(),
        canDelete: json['canDelete'] == true,
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
  /// How many videos this account has uploaded, across all groups.
  Future<int> getMyVideoCount() async {
    final data = await _api.get('/api/recordings/my-video-count');
    return ((data as Map)['count'] as num).toInt();
  }

  /// Schedule a session for one of the user's groups (admins and owner).
  Future<RecordingSession> scheduleSession({
    required String groupId,
    required String name,
    required DateTime scheduledAt,
  }) async {
    final data = await _api.post('/api/recordings/sessions', {
      'groupId': groupId,
      'name': name,
      'scheduledAt': scheduledAt.toUtc().toIso8601String(),
    });
    return RecordingSession.fromJson(
        Map<String, dynamic>.from((data as Map)['session'] as Map));
  }

  /// Start a session right now (admins and owner).
  Future<RecordingSession> createLiveSession({
    required String groupId,
    required String name,
  }) async {
    final data = await _api.post('/api/recordings/sessions/live', {
      'groupId': groupId,
      'name': name,
    });
    return RecordingSession.fromJson(
        Map<String, dynamic>.from((data as Map)['session'] as Map));
  }

  /// End a live session for everyone (its host, or a group admin).
  Future<void> endSession(String id) async {
    await _api.patch('/api/recordings/sessions/$id/end', const {});
  }

  /// Cancel a scheduled session (its creator, or a group admin).
  Future<void> cancelSession(String id) async {
    await _api.patch('/api/recordings/sessions/$id/cancel', const {});
  }

  /// Delete a finished session and its videos (group admins and owner).
  Future<void> deleteSession(String id) async {
    await _api.delete('/api/recordings/sessions/$id');
  }

  Future<RecordingSession> joinSession(String id) async {
    final data = await _api.post('/api/recordings/sessions/$id/join');
    return RecordingSession.fromJson(
      Map<String, dynamic>.from((data as Map)['session'] as Map),
    );
  }

  /// Every recording of a session with each device's video. Video URLs are
  /// server-relative and need the session cookie; see [absoluteUrl].
  Future<SessionVideos> getSessionVideos(String id) async {
    final data = await _api.get('/api/recordings/sessions/$id/videos');
    return SessionVideos.fromJson(Map<String, dynamic>.from(data as Map));
  }

  /// Notes on one recording, ordered by the moment in the video they refer to.
  Future<List<SessionNote>> getSessionNotes(String id, int startedAtMs) async {
    final data = await _api.get(
      '/api/recordings/sessions/$id/notes?startedAt=$startedAtMs',
    );
    final notes = ((data as Map)['notes'] as List?) ?? const [];
    return notes
        .map((n) => SessionNote.fromJson(Map<String, dynamic>.from(n)))
        .toList();
  }

  /// Leaves a note [videoTimeMs] into the recording that started at
  /// [startedAtMs]. Viewers get a 403 with the server's message.
  Future<void> createSessionNote(
    String id,
    int startedAtMs,
    String body,
    int videoTimeMs,
  ) async {
    await _api.post('/api/recordings/sessions/$id/notes', {
      'startedAt': startedAtMs,
      'body': body,
      'videoTimeMs': videoTimeMs,
    });
  }

  Future<void> deleteSessionNote(String id, int noteId) async {
    await _api.delete('/api/recordings/sessions/$id/notes/$noteId');
  }

  /// Turns a server-relative path like `/api/files/get/x.mp4` into a full URL.
  String absoluteUrl(String path) =>
      path.startsWith('http') ? path : '${_api.baseUrl}$path';

  /// Records that this user finished a video for the recording that started
  /// at [startedAtMs] (server clock), so the session's video counts include
  /// it even if the upload itself fails. Safe to repeat.
  ///
  /// [actualStartedAtMs] is when this phone's camera really began (server
  /// clock); playback shifts the angle by how late that was.
  Future<void> saveRecordingDetails(String id, int startedAtMs,
          {int? actualStartedAtMs}) =>
      _api.post('/api/recordings/sessions/$id/videos', {
        'startedAt': startedAtMs,
        if (actualStartedAtMs != null) 'actualStartedAt': actualStartedAtMs,
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
    int? actualStartedAtMs,
  }) =>
      _api.postFile(
        '/api/files/upload'
        '?sessionId=${Uri.encodeQueryComponent(id)}&startedAt=$startedAtMs'
        '${actualStartedAtMs == null ? '' : '&actualStartedAt=$actualStartedAtMs'}',
        filePath: filePath,
        filename: filename,
      );
}
