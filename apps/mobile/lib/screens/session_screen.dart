import 'dart:async';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'camera_screen.dart';
import 'controller_screen.dart';
import 'watch_screen.dart';

import '../api/recordings_api.dart';
import '../auth/auth_service.dart';
import '../socket/sync_socket.dart';

/// Recording view for a session. Requests camera/mic only while mounted and
/// releases them on dispose (per the MVP permissions rule — no background
/// access). Connects the authenticated socket, joins the session room, and
/// goes straight to the camera, with the session's name and how many devices
/// are connected across the top. CameraScreen follows the synchronized
/// start/stop. A host or admin can turn this phone's camera off and run the
/// session from ControllerScreen instead.
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

  /// The connection dropped and is retrying; the camera stays up.
  bool _reconnecting = false;
  List<SessionMember> _members = [];
  bool _canControl = false;

  /// Running the session without recording on this phone.
  bool _controllerOnly = false;

  /// A take is scheduled or running; the camera can't be switched mid-take.
  bool _takeRunning = false;
  bool _switching = false;

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
    _subs.add(socket.recordingStart.listen((_) {
      if (!mounted) return;
      setState(() => _takeRunning = true);
      // Watching when the next take starts: back to the camera, which is
      // already recording underneath.
      final here = _sessionRoute;
      if (_watching && here != null) {
        Navigator.of(context).popUntil((route) => route == here);
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('A new take started.')));
      }
    }));
    _subs.add(socket.recordingStop.listen((_) {
      if (mounted) setState(() => _takeRunning = false);
    }));
    _subs.add(socket.errors.listen((message) {
      if (mounted) setState(() => _error = message);
    }));
    _subs.add(socket.connection.listen((connected) {
      if (mounted) setState(() => _reconnecting = !connected);
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
        _canControl = result.canControl;
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

  Future<void> _setControllerOnly(bool controllerOnly) async {
    final socket = _socket;
    if (socket == null || _switching || _takeRunning) return;
    setState(() => _switching = true);
    final result =
        await socket.joinSession(widget.sessionId, camera: !controllerOnly);
    if (!mounted) return;
    setState(() {
      _switching = false;
      if (result.ok) _controllerOnly = controllerOnly;
    });
    if (!result.ok) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(result.error ?? "Couldn't switch the camera.")));
    }
  }

  /// The session's recordings, watched without leaving it: the camera (or
  /// the controls) stays up underneath and comes back when the next take
  /// starts.
  bool _watching = false;
  ModalRoute<dynamic>? _sessionRoute;

  Future<void> _watchRecordings() async {
    // Not mid-take: the take has to finish (and upload) first.
    if (_takeRunning) return;
    _sessionRoute = ModalRoute.of(context);
    setState(() => _watching = true);
    await Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => WatchScreen(
        auth: widget.auth,
        session: RecordingSession(
          id: widget.sessionId,
          name: widget.sessionName ?? 'Session ${widget.sessionId}',
          status: 'active',
          activeMemberCount: _members.length,
          isJoined: true,
        ),
      ),
    ));
    if (mounted) setState(() => _watching = false);
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
        backgroundColor: Colors.black,
        body: Center(child: CircularProgressIndicator()),
      );
    }

    final socket = _socket!;
    final joined = _error == null;

    final topBar = _SessionTopBar(
      name: widget.sessionName ?? 'Session ${widget.sessionId}',
      code: widget.sessionId,
      members: _members,
      clockSynced: socket.clockSynced,
      reconnecting: _reconnecting,
    );

    if (joined && _controllerOnly) {
      return ControllerScreen(
        socket: socket,
        sessionId: widget.sessionId,
        members: _members,
        topBar: topBar,
        onUseCamera: _switching ? null : () => _setControllerOnly(false),
        onWatch: _watchRecordings,
      );
    }

    if (joined && _permissionsGranted) {
      return CameraScreen(
        socket: socket,
        sessionId: widget.sessionId,
        recordings: RecordingsApi(widget.auth.api),
        canControl: _canControl,
        topBar: topBar,
        onWatch: _watchRecordings,
        // Hosts and admins can turn their camera off and just run the take.
        onControlOnly: _canControl && !_switching
            ? () => _setControllerOnly(true)
            : null,
      );
    }

    // Couldn't join, or camera/microphone access was refused.
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        title: Text(widget.sessionName ?? 'Session ${widget.sessionId}'),
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            _error ?? 'Camera and microphone permission are required to record.',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.redAccent, height: 1.4),
          ),
        ),
      ),
    );
  }
}

/// The bar across the top of a session's camera: back, the session's name,
/// and how many devices are connected (a hint when the clock isn't synced).
/// The recordings and the camera on/off switch sit beside the shutter.
class _SessionTopBar extends StatelessWidget {
  const _SessionTopBar({
    required this.name,
    required this.code,
    required this.members,
    required this.clockSynced,
    this.reconnecting = false,
  });

  final String name;

  /// The session's code, so others can join with it.
  final String code;
  final List<SessionMember> members;
  final bool clockSynced;

  /// The connection dropped; Start and Stop won't reach this phone until
  /// it's back.
  final bool reconnecting;

  @override
  Widget build(BuildContext context) {
    const shadow = [Shadow(blurRadius: 6, color: Colors.black)];
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 4, 12, 4),
      child: Row(
        children: [
          IconButton(
            onPressed: () => Navigator.of(context).maybePop(),
            icon: const Icon(Icons.arrow_back, color: Colors.white, shadows: shadow),
            tooltip: 'Leave session',
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    shadows: shadow,
                  ),
                ),
                Text(
                  'Code $code',
                  style: const TextStyle(color: Colors.white70, fontSize: 12, shadows: shadow),
                ),
                if (reconnecting)
                  const Text(
                    'Connection lost. Reconnecting…',
                    style: TextStyle(color: Colors.orangeAccent, fontSize: 12, shadows: shadow),
                  )
                else if (!clockSynced)
                  const Text(
                    'Clock not synced; recordings may drift.',
                    style: TextStyle(color: Colors.orangeAccent, fontSize: 12, shadows: shadow),
                  ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: Colors.black54,
              borderRadius: BorderRadius.circular(999),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.circle, size: 9, color: Color(0xFF4ADE80)),
                const SizedBox(width: 6),
                Text(
                  '${members.length} ${members.length == 1 ? 'device' : 'devices'} connected',
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
