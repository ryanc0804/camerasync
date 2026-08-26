import 'dart:async';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'camera_screen.dart';

import '../auth/auth_service.dart';
import '../socket/sync_socket.dart';

/// Recording view for a session. Requests camera/mic only while mounted and
/// releases them on dispose (per the MVP permissions rule — no background
/// access). Connects the authenticated socket, joins the session room, and
/// shows who else is in it; CameraScreen follows the synchronized start/stop.
class SessionScreen extends StatefulWidget {
  const SessionScreen({
    super.key,
    required this.serverUrl,
    required this.auth,
    required this.sessionId,
    this.sessionName,
  });

  final String serverUrl;
  final AuthService auth;
  final String sessionId;
  final String? sessionName;

  @override
  State<SessionScreen> createState() => _SessionScreenState();
}

class _SessionScreenState extends State<SessionScreen> {
  SyncSocket? _socket;
  final List<StreamSubscription> _subs = [];

  bool _permissionsGranted = false;
  bool _initialized = false;
  String? _error;
  List<SessionMember> _members = [];

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    await _requestPermissions();

    final socket = SyncSocket(
      widget.serverUrl,
      cookie: widget.auth.api.cookie,
    );
    _socket = socket;

    _subs.add(socket.members.listen((m) => setState(() => _members = m)));
    _subs.add(socket.errors.listen((message) {
      if (mounted) setState(() => _error = message);
    }));
    _subs.add(socket.sessionClosed.listen((_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('The host ended the session.')),
      );
      Navigator.of(context).popUntil((route) => route.isFirst);
    }));

    try {
      await socket.connect();
      final result = await socket.joinSession(widget.sessionId);
      if (!mounted) return;
      setState(() {
        _initialized = true;
        if (!result.ok) _error = result.error;
      });
    } on SyncSocketException catch (e) {
      if (!mounted) return;
      setState(() {
        _initialized = true;
        _error = e.message;
      });
    }
  }

  Future<void> _requestPermissions() async {
    final statuses = await [Permission.camera, Permission.microphone].request();
    setState(() {
      _permissionsGranted = statuses.values.every((s) => s.isGranted);
    });
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }

    _socket?.leaveSession();
    _socket?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_initialized) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    final socket = _socket!;
    final joined = _error == null;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.sessionName ?? 'Session ${widget.sessionId}'),
      ),
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
            if (_error != null) ...[
              Text(_error!, style: const TextStyle(color: Colors.redAccent)),
              const SizedBox(height: 8),
            ],
            Text(
              socket.clockSynced
                  ? 'Clock offset: ${socket.clockOffsetMs} ms'
                  : 'Clock not synced — recording may drift.',
            ),
            const SizedBox(height: 16),
            Text('Connected devices (${_members.length})'),
            Expanded(
              child: ListView(
                children: _members
                    .map((m) => ListTile(title: Text(m.displayName)))
                    .toList(),
              ),
            ),
            FilledButton(
              onPressed: joined && _permissionsGranted
                  ? () {
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => CameraScreen(
                            socket: socket,
                            sessionId: widget.sessionId,
                          ),
                        ),
                      );
                    }
                  : null,
              child: const Text('Open Camera'),
            ),
          ],
        ),
      ),
    );
  }
}
