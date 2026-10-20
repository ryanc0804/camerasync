import 'dart:async';

import 'package:flutter/material.dart';

import '../socket/sync_socket.dart';
import '../sync_beep.dart';
import '../widgets/shutter_side_button.dart';

/// A session with this phone's camera off: a host or admin starts and stops
/// every other camera from here without recording on this phone. The start
/// still plays the sync beep from this phone, like the host's shutter does.
class ControllerScreen extends StatefulWidget {
  const ControllerScreen({
    super.key,
    required this.socket,
    required this.sessionId,
    required this.members,
    required this.topBar,
    required this.onUseCamera,
    required this.onWatch,
  });

  final SyncSocket socket;
  final String sessionId;
  final List<SessionMember> members;
  final Widget topBar;

  /// Turns this phone's camera back on; null while switching.
  final VoidCallback? onUseCamera;

  /// Opens the session's recordings (greyed out while a take runs).
  final VoidCallback onWatch;

  @override
  State<ControllerScreen> createState() => _ControllerScreenState();
}

class _ControllerScreenState extends State<ControllerScreen> {
  final List<StreamSubscription> _subs = [];

  /// The take's shared start is scheduled but hasn't arrived yet.
  Timer? _pendingStart;
  bool _recording = false;
  bool _requesting = false;

  /// This phone pressed Start, so it plays the sync beep for the take.
  bool _beepOnNextStart = false;
  SyncBeep? _beep;
  Timer? _pendingBeep;

  /// The stop is in; the cameras roll on until its time to record the end
  /// beep, which this phone plays if it pressed Stop.
  Timer? _pendingStop;
  bool _beepOnNextStop = false;
  SyncBeep? _endBeep;
  Timer? _pendingEndBeep;

  @override
  void initState() {
    super.initState();
    _subs.add(widget.socket.recordingStart.listen(_scheduleStart));
    _subs.add(widget.socket.recordingStop.listen(_scheduleStop));
  }

  void _scheduleStop(RecordingStopCommand command) {
    final now = DateTime.now().millisecondsSinceEpoch;
    final wasStarting = _pendingStart?.isActive ?? false;
    _pendingStart?.cancel();
    if (wasStarting) _pendingBeep?.cancel();

    final endBeepAt = command.localEndBeepAtEpochMs;
    if (_beepOnNextStop && endBeepAt != null && _endBeep != null) {
      _pendingEndBeep?.cancel();
      _pendingEndBeep = Timer(
        Duration(milliseconds: endBeepAt < now ? 0 : endBeepAt - now),
        () => _endBeep?.play(),
      );
    }
    _beepOnNextStop = false;

    final stopAt = command.localStopAtEpochMs;
    final wait = stopAt == null || stopAt < now ? 0 : stopAt - now;
    _pendingStop?.cancel();
    _pendingStop = Timer(Duration(milliseconds: wait), () {
      if (mounted) setState(() => _recording = false);
    });
    if (mounted) setState(() {});
  }

  void _scheduleStart(RecordingStartCommand command) {
    final now = DateTime.now().millisecondsSinceEpoch;
    final beepAt = command.localBeepAtEpochMs;
    if (_beepOnNextStart && beepAt != null && _beep != null) {
      _beepOnNextStart = false;
      _pendingBeep?.cancel();
      final wait = beepAt - now;
      _pendingBeep = Timer(
        Duration(milliseconds: wait < 0 ? 0 : wait),
        () => _beep?.play(),
      );
    }

    final delay = command.localStartAtEpochMs - now;
    _pendingStart?.cancel();
    _pendingStart = Timer(Duration(milliseconds: delay < 0 ? 0 : delay), () {
      if (mounted) setState(() => _recording = true);
    });
    setState(() {});
  }

  Future<void> _startOrStop() async {
    if (_requesting || (_pendingStop?.isActive ?? false)) return;
    final stopping = _recording || (_pendingStart?.isActive ?? false);
    setState(() => _requesting = true);
    if (!stopping) {
      _beepOnNextStart = true;
      _beep ??= SyncBeep();
      await _beep!.prepare().catchError((_) {});
    } else {
      _beepOnNextStop = true;
      _endBeep ??= SyncBeep(tones: kEndBeepTonesHz);
      await _endBeep!.prepare().catchError((_) {});
    }
    final error = stopping
        ? await widget.socket.requestStop(widget.sessionId)
        : await widget.socket.requestStart(widget.sessionId);
    if (!mounted) return;
    setState(() => _requesting = false);
    if (error != null) {
      _beepOnNextStart = false;
      _beepOnNextStop = false;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error)));
    }
  }

  @override
  void dispose() {
    _pendingStart?.cancel();
    _pendingBeep?.cancel();
    _beep?.dispose();
    _pendingStop?.cancel();
    _pendingEndBeep?.cancel();
    _endBeep?.dispose();
    for (final sub in _subs) {
      sub.cancel();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cameras = widget.members.where((m) => m.camera).length;
    final controlling = widget.members.length - cameras;
    final starting = _pendingStart?.isActive ?? false;
    final stoppingTake = _pendingStop?.isActive ?? false;
    final active = _recording || starting;

    final String status;
    if (_recording && stoppingTake) {
      status = 'Stopping…';
    } else if (_recording) {
      status = 'Recording on $cameras ${cameras == 1 ? 'camera' : 'cameras'}';
    } else if (starting) {
      status = 'Starting…';
    } else if (cameras == 0) {
      status = 'No cameras have joined yet';
    } else {
      status = 'Ready: $cameras ${cameras == 1 ? 'camera' : 'cameras'}';
    }

    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Column(
          children: [
            widget.topBar,
            Expanded(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 32),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        active ? Icons.fiber_manual_record : Icons.videocam_off_outlined,
                        size: 44,
                        color: active ? Colors.redAccent : Colors.white54,
                      ),
                      const SizedBox(height: 12),
                      Text(
                        status,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        "Control only: this phone isn't recording."
                        '${controlling > 1 ? ' $controlling people are controlling.' : ''}',
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Colors.white70, height: 1.4),
                      ),
                      if (!active) ...[
                        const SizedBox(height: 6),
                        const Text(
                          'Starting plays the sync beep from this phone, so keep it near the middle of the room.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.white54, fontSize: 12, height: 1.4),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                ShutterSideButton(
                  icon: Icons.video_library_outlined,
                  tooltip: 'Watch recordings',
                  onPressed: active ? null : widget.onWatch,
                ),
                const SizedBox(width: 28),
                Semantics(
                  button: true,
                  label: active ? 'Stop all cameras' : 'Start all cameras',
                  child: GestureDetector(
                    onTap: _startOrStop,
                    child: Container(
                      width: 80,
                      height: 80,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Colors.white24,
                        border: Border.all(color: Colors.white, width: 3),
                      ),
                      child: Center(
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 180),
                          width: active ? 30 : 62,
                          height: active ? 30 : 62,
                          decoration: BoxDecoration(
                            color: Colors.redAccent,
                            borderRadius:
                                BorderRadius.circular(active ? 6 : 31),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 28),
                ShutterSideButton(
                  icon: Icons.videocam_off,
                  color: Colors.orangeAccent,
                  tooltip: "Use this phone's camera",
                  onPressed: active ? null : widget.onUseCamera,
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              active ? 'Stop all cameras' : 'Start all cameras',
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 12),
          ],
        ),
      ),
    );
  }
}
