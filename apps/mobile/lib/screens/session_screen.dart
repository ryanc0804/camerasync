import 'dart:async';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'camera_screen.dart';

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
  List<String> _devices = [];

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
  }

  Future<void> _requestPermissions() async {
    final statuses = await [Permission.camera, Permission.microphone].request();
    setState(() {
      _permissionsGranted =
          statuses.values.every((s) => s.isGranted);
    });
  }


  @override
  void dispose() {
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
            const SizedBox(height: 16),
            Text('Connected devices (${_devices.length})'),
            Expanded(
              child: ListView(
                children: _devices.map((d) => ListTile(title: Text(d))).toList(),
              ),
            ),
            FilledButton(
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => CameraScreen(
                      socket: _socket,
                      sessionId: widget.sessionId,
                  ),
                ),
              );
            },
            child: const Text('Open Camera'),
          ),
          ],
        ),
      ),
    );
  }
}
