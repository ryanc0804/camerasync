import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:socket_io_client/socket_io_client.dart' as io;

import 'events.dart';

/// A user connected to the live session room, as sent by the server's
/// `session:members` payload (the `publicUser` shape: id, email, name).
class SessionMember {
  const SessionMember({required this.id, required this.email, this.name});

  final int id;
  final String email;
  final String? name;

  String get displayName =>
      (name != null && name!.isNotEmpty) ? name! : email;

  factory SessionMember.fromJson(Map json) => SessionMember(
        id: (json['id'] as num).toInt(),
        email: (json['email'] ?? '').toString(),
        name: json['name'] as String?,
      );
}

/// A synchronized start command, expressed in both clocks.
///
/// [serverStartAtEpochMs] is the instant the server chose, on the server
/// clock. Every device in the session receives the same value, and it is the
/// key the server files uploaded videos under, so it must be passed back
/// unchanged when the recording is uploaded. [localStartAtEpochMs] is that
/// same instant on this device's clock, for scheduling the actual start.
class RecordingStartCommand {
  const RecordingStartCommand({
    required this.serverStartAtEpochMs,
    required this.localStartAtEpochMs,
    this.recordingNumber,
    this.localBeepAtEpochMs,
  });

  final int serverStartAtEpochMs;
  final int localStartAtEpochMs;

  /// When the device that started the take plays the sync beep, on this
  /// device's clock. Null from servers that predate the beep.
  final int? localBeepAtEpochMs;

  /// 1-based position of this recording within the session ("Recording 3"),
  /// as persisted by the server. Null for start commands that predate it.
  final int? recordingNumber;
}

/// Result of the `session:join` ack.
class JoinResult {
  const JoinResult({
    required this.ok,
    this.error,
    this.sessionName,
    this.canControl = false,
  });

  final bool ok;
  final String? error;
  final String? sessionName;

  /// This user may start and stop takes for everyone: the session's creator,
  /// or an admin or the owner of its group.
  final bool canControl;
}

/// Wraps the Socket.IO connection to the 8kount server and estimates this
/// device's clock offset from the shared server clock.
///
/// The server authenticates the socket handshake with the same session cookie
/// as the REST API, so [cookie] must be the logged-in `session=...` pair.
///
/// Clock sync happens over the server's HTTP `/timesync` endpoint (the same
/// one the web app uses) — NTP-style round trips, keeping the sample with the
/// lowest RTT. When the admin starts recording, the server broadcasts a single
/// future `startAtEpochMs` on the *server* clock; [serverToLocal] converts it
/// to this device's clock so every device fires at the same real instant.
class SyncSocket {
  SyncSocket(this.serverUrl, {this.cookie});

  final String serverUrl;

  /// The `session=...` cookie pair from [ApiClient]. Without it the server
  /// rejects the handshake with "Not authenticated".
  final String? cookie;

  io.Socket? _socket;

  /// localTime ≈ serverTime + _clockOffsetMs
  int _clockOffsetMs = 0;
  bool _clockSynced = false;

  int get clockOffsetMs => _clockOffsetMs;
  bool get clockSynced => _clockSynced;

  final _members = StreamController<List<SessionMember>>.broadcast();
  final _recordingStart = StreamController<RecordingStartCommand>.broadcast();
  final _recordingStop = StreamController<void>.broadcast();
  final _sessionClosed = StreamController<void>.broadcast();
  final _errors = StreamController<String>.broadcast();

  /// Connected users in the joined session.
  Stream<List<SessionMember>> get members => _members.stream;

  /// Emits each synchronized start command, carrying the server's start time
  /// and its conversion to this device's clock.
  Stream<RecordingStartCommand> get recordingStart => _recordingStart.stream;

  /// Emits when recording should stop.
  Stream<void> get recordingStop => _recordingStop.stream;

  /// Emits when the host ends the session.
  Stream<void> get sessionClosed => _sessionClosed.stream;

  /// Connection-level errors (e.g. rejected handshake).
  Stream<String> get errors => _errors.stream;

  bool get connected => _socket?.connected ?? false;

  /// Connects the socket and runs the first clock sync. Completes once the
  /// socket is connected (or throws on a rejected handshake/timeout).
  Future<void> connect({
    Duration timeout = const Duration(seconds: 10),
  }) async {
    final connectCompleter = Completer<void>();

    final socket = io.io(
      serverUrl,
      io.OptionBuilder()
          .setTransports(['websocket'])
          // The Dart client doesn't send cookies on its own the way a browser
          // does, so replay the API session cookie by hand.
          .setExtraHeaders({if (cookie != null) 'Cookie': cookie!})
          .disableAutoConnect()
          .build(),
    );
    _socket = socket;

    socket.onConnect((_) {
      if (!connectCompleter.isCompleted) connectCompleter.complete();
    });

    socket.onConnectError((err) {
      final message = _connectErrorMessage(err);
      _errors.add(message);
      if (!connectCompleter.isCompleted) {
        connectCompleter.completeError(SyncSocketException(message));
      }
    });

    socket.on(Events.sessionMembers, (data) {
      if (data is! List) return;
      _members.add(
        data.whereType<Map>().map(SessionMember.fromJson).toList(),
      );
    });

    socket.on(Events.recordingStarted, (data) {
      if (data is! Map) return;
      final serverStart = (data['startAtEpochMs'] as num?)?.toInt();
      if (serverStart != null) {
        _recordingStart.add(_startCommand(
          serverStart,
          recordingNumber: (data['recordingNumber'] as num?)?.toInt(),
          serverBeepAtEpochMs: (data['beepAtEpochMs'] as num?)?.toInt(),
        ));
      }
    });

    socket.on(Events.recordingStopped, (_) => _recordingStop.add(null));

    socket.on(Events.closeSession, (_) => _sessionClosed.add(null));

    socket.connect();

    // Clock sync is plain HTTP, so it can run while the socket connects.
    await Future.wait([
      connectCompleter.future.timeout(
        timeout,
        onTimeout: () =>
            throw SyncSocketException("Can't reach the server at $serverUrl."),
      ),
      syncClock(),
    ]);
  }

  static String _connectErrorMessage(dynamic err) {
    if (err is Map && err['message'] is String) return err['message'] as String;
    final text = err?.toString() ?? '';
    if (text.contains('Not authenticated')) {
      return 'Not authenticated — please sign in again.';
    }
    return text.isEmpty ? 'Unable to connect to the server.' : text;
  }

  /// NTP-style clock sync against the server's `/timesync` endpoint (the
  /// `timesync` package's JSON-RPC handler). Runs [rounds] round trips and
  /// keeps the offset from the lowest-RTT sample, assuming a symmetric path:
  /// offset = (t0 + rtt/2) - serverTime.
  Future<void> syncClock({int rounds = 5}) async {
    int? bestRtt;
    int? bestOffset;

    for (var i = 0; i < rounds; i++) {
      try {
        final t0 = DateTime.now().millisecondsSinceEpoch;
        final res = await http
            .post(
              Uri.parse('$serverUrl/timesync'),
              headers: {'Content-Type': 'application/json'},
              body: jsonEncode({
                'jsonrpc': '2.0',
                'id': i,
                'method': 'timesync',
              }),
            )
            .timeout(const Duration(seconds: 3));
        final t1 = DateTime.now().millisecondsSinceEpoch;

        final body = jsonDecode(res.body);
        final serverTime = (body['result'] as num?)?.toInt();
        if (serverTime == null) continue;

        final rtt = t1 - t0;
        if (bestRtt == null || rtt < bestRtt) {
          bestRtt = rtt;
          bestOffset = (t0 + rtt ~/ 2) - serverTime;
        }
      } catch (_) {
        // A dropped round just doesn't contribute a sample.
      }
    }

    if (bestOffset != null) {
      _clockOffsetMs = bestOffset;
      _clockSynced = true;
    }
  }

  int serverToLocal(int serverEpochMs) => serverEpochMs + _clockOffsetMs;

  /// The server clock is the shared reference, so a local instant maps back
  /// by subtracting the same offset [serverToLocal] adds.
  int localToServer(int localEpochMs) => localEpochMs - _clockOffsetMs;

  RecordingStartCommand _startCommand(
    int serverStartAtEpochMs, {
    int? recordingNumber,
    int? serverBeepAtEpochMs,
  }) =>
      RecordingStartCommand(
        serverStartAtEpochMs: serverStartAtEpochMs,
        localStartAtEpochMs: serverToLocal(serverStartAtEpochMs),
        recordingNumber: recordingNumber,
        localBeepAtEpochMs: serverBeepAtEpochMs == null
            ? null
            : serverToLocal(serverBeepAtEpochMs),
      );

  /// Joins the session's socket room. The server requires an ack callback and
  /// replies `{ok, error?, members?, recording?, session?}`; it identifies the
  /// user from the handshake cookie, so no device name is sent.
  Future<JoinResult> joinSession(String sessionId) {
    final socket = _socket;
    if (socket == null || !socket.connected) {
      return Future.value(
        const JoinResult(ok: false, error: 'Not connected to the server.'),
      );
    }

    final completer = Completer<JoinResult>();

    socket.emitWithAck(
      Events.joinSession,
      {'sessionId': sessionId},
      ack: (reply) {
        if (completer.isCompleted) return;
        if (reply is! Map || reply['ok'] != true) {
          completer.complete(JoinResult(
            ok: false,
            error: (reply is Map ? reply['error'] : null)?.toString() ??
                'Unable to join the live session.',
          ));
          return;
        }

        final membersData = reply['members'];
        if (membersData is List) {
          _members.add(
            membersData.whereType<Map>().map(SessionMember.fromJson).toList(),
          );
        }

        // If a synchronized recording is already underway, schedule this
        // device to fall in rather than waiting for the next start command.
        final recording = reply['recording'];
        if (recording is Map && recording['stopAtEpochMs'] == null) {
          final serverStart = (recording['startAtEpochMs'] as num?)?.toInt();
          if (serverStart != null) {
            _recordingStart.add(_startCommand(
              serverStart,
              recordingNumber: (recording['recordingNumber'] as num?)?.toInt(),
            ));
          }
        }

        final session = reply['session'];
        completer.complete(JoinResult(
          ok: true,
          sessionName:
              session is Map ? session['name']?.toString() : null,
          canControl: session is Map && session['canControl'] == true,
        ));
      },
    );

    return completer.future.timeout(
      const Duration(seconds: 10),
      onTimeout: () => const JoinResult(
        ok: false,
        error: 'The server did not answer the join request.',
      ),
    );
  }

  /// Asks the server to start a take on every device in [sessionId], at a
  /// shared time [bufferMs] from now. Returns null when it started, or the
  /// reason it didn't.
  Future<String?> requestStart(String sessionId, {int bufferMs = 1500}) =>
      _command(Events.startRecording,
          {'sessionId': sessionId, 'bufferMs': bufferMs}, 'start');

  /// Asks the server to stop the take on every device in [sessionId].
  Future<String?> requestStop(String sessionId) =>
      _command(Events.stopRecording, {'sessionId': sessionId}, 'stop');

  Future<String?> _command(
      String event, Map<String, dynamic> payload, String verb) {
    final socket = _socket;
    if (socket == null || !socket.connected) {
      return Future.value('Not connected to the server.');
    }
    final completer = Completer<String?>();
    socket.emitWithAck(event, payload, ack: (reply) {
      if (completer.isCompleted) return;
      completer.complete(reply is Map && reply['ok'] == true
          ? null
          : (reply is Map ? reply['error'] : null)?.toString() ??
              'Unable to $verb recording.');
    });
    return completer.future.timeout(
      const Duration(seconds: 10),
      onTimeout: () => 'The server did not answer.',
    );
  }

  /// Leaves the current session room. The server tracks which room this
  /// socket is in, so no payload is needed.
  void leaveSession() {
    _socket?.emit(Events.leaveSession);
  }

  void dispose() {
    _socket?.dispose();
    _members.close();
    _recordingStart.close();
    _recordingStop.close();
    _sessionClosed.close();
    _errors.close();
  }
}

class SyncSocketException implements Exception {
  SyncSocketException(this.message);

  final String message;

  @override
  String toString() => message;
}
