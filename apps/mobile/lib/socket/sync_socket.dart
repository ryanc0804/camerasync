import 'dart:async';
import 'package:socket_io_client/socket_io_client.dart' as io;

import 'events.dart';

/// Wraps the Socket.IO connection to the Camera Sync server and estimates this
/// device's clock offset from the shared server clock (TrueTime-style).
///
/// When the admin starts recording, the server broadcasts a single future
/// `startAtEpochMs` on the *server* clock. Convert it to this device's local
/// clock with [serverToLocal] so every device fires at the same real instant.
class SyncSocket {
  SyncSocket(this.serverUrl);

  final String serverUrl;
  late final io.Socket _socket;

  /// localTime ≈ serverTime + _clockOffsetMs
  int _clockOffsetMs = 0;
  int get clockOffsetMs => _clockOffsetMs;

  final _devices = StreamController<List<String>>.broadcast();
  final _recordingStart = StreamController<int>.broadcast();
  final _recordingStop = StreamController<void>.broadcast();

  /// Connected device names in the joined session.
  Stream<List<String>> get devices => _devices.stream;

  /// Emits the synchronized start time, already converted to *local* epoch ms.
  Stream<int> get recordingStart => _recordingStart.stream;

  /// Emits when recording should stop.
  Stream<void> get recordingStop => _recordingStop.stream;

  bool get connected => _socket.connected;

  void connect() {
    _socket = io.io(
      serverUrl,
      io.OptionBuilder().setTransports(['websocket']).build(),
    );

    _socket.onConnect((_) => _syncClock());

    _socket.on(Events.deviceList, (data) {
      final list = (data as List)
          .map((d) => (d['deviceName'] ?? 'Unnamed device').toString())
          .toList();
      _devices.add(list);
    });

    _socket.on(Events.recordingStarted, (data) {
      final serverStart = (data['startAtEpochMs'] as num).toInt();
      _recordingStart.add(serverToLocal(serverStart));
    });

    _socket.on(Events.recordingStopped, (_) => _recordingStop.add(null));
  }

  /// Round-trip clock sync. Uses the standard NTP-style estimate assuming a
  /// symmetric path: offset = serverTime - (t0 + rtt/2).
  void _syncClock() {
    final t0 = DateTime.now().millisecondsSinceEpoch;
    _socket.emitWithAck(Events.timeSync, t0, ack: (reply) {
      final t1 = DateTime.now().millisecondsSinceEpoch;
      final serverTime = (reply['serverTimeEpochMs'] as num).toInt();
      final rtt = t1 - t0;
      _clockOffsetMs = (t0 + rtt ~/ 2) - serverTime;
    });
  }

  int serverToLocal(int serverEpochMs) => serverEpochMs + _clockOffsetMs;

  void joinSession(String sessionId, String deviceName) {
    _socket.emit(Events.joinSession, {
      'sessionId': sessionId,
      'deviceName': deviceName,
    });
  }

  void leaveSession(String sessionId) {
    _socket.emit(Events.leaveSession, {'sessionId': sessionId});
  }

  void dispose() {
    _socket.dispose();
    _devices.close();
    _recordingStart.close();
    _recordingStop.close();
  }
}
