import 'dart:async';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../socket/sync_socket.dart';

/// Recording view for a session. Requests camera/mic only while mounted and
/// releases them on dispose (per the MVP permissions rule — no background
/// access). Camera preview/capture is left as a TODO; this wires up the
/// session join + synchronized start/stop signalling.
class SessionScreen extends StatefulWidget {
  const SessionScreen({
    super.key,
    required this.serverUrl,
    required this.sessionId,
    required this.deviceName,
  });

  final String serverUrl;
  final String sessionId;
  final String deviceName;

  @override
  State<SessionScreen> createState() => _SessionScreenState();
}

class _SessionScreenState extends State<SessionScreen> {
  late final SyncSocket _socket;
  final List<StreamSubscription> _subs = [];

  bool _permissionsGranted = false;
  bool _recording = false;
  List<String> _devices = [];
  Timer? _pendingStart;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    await _requestPermissions();

    _socket = SyncSocket(widget.serverUrl)..connect();
    _socket.joinSession(widget.sessionId, widget.deviceName);

    _subs.add(_socket.devices.listen((d) => setState(() => _devices = d)));
    _subs.add(_socket.recordingStart.listen(_scheduleStart));
    _subs.add(_socket.recordingStop.listen((_) => _stopRecording()));
  }

  Future<void> _requestPermissions() async {
    final statuses = await [Permission.camera, Permission.microphone].request();
    setState(() {
      _permissionsGranted =
          statuses.values.every((s) => s.isGranted);
    });
  }

  /// Arm the camera now; begin capture exactly at the shared local start time.
  void _scheduleStart(int localStartEpochMs) {
    final delay = localStartEpochMs - DateTime.now().millisecondsSinceEpoch;
    _pendingStart?.cancel();
    _pendingStart = Timer(
      Duration(milliseconds: delay < 0 ? 0 : delay),
      _startRecording,
    );
  }

  void _startRecording() {
    // TODO: start CameraController video recording here.
    setState(() => _recording = true);
  }

  void _stopRecording() {
    // TODO: stop CameraController + hand the file off for upload.
    _pendingStart?.cancel();
    setState(() => _recording = false);
  }

  @override
  void dispose() {
    _pendingStart?.cancel();
    for (final s in _subs) {
      s.cancel();
    }
    _socket.leaveSession(widget.sessionId);
    _socket.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Session ${widget.sessionId}')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!_permissionsGranted)
              const Text(
                'Camera and microphone permission required.',
                style: TextStyle(color: Colors.red),
              ),
            Text('Device: ${widget.deviceName}'),
            Text('Clock offset: ${_socket.clockOffsetMs} ms'),
            const SizedBox(height: 8),
            Text(
              _recording ? '● RECORDING' : 'Idle',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: _recording ? Colors.red : Colors.grey,
              ),
            ),
            const SizedBox(height: 16),
            Text('Connected devices (${_devices.length})'),
            Expanded(
              child: ListView(
                children: _devices.map((d) => ListTile(title: Text(d))).toList(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
