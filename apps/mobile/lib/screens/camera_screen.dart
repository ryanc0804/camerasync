import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'dart:async';
import '../socket/sync_socket.dart';

/// Camera view. Works in two modes:
///
///  * **Session mode** — pass a [socket]; recording starts and stops on the
///    admin's synchronized broadcast, in step with every other device.
///  * **Solo mode** — omit [socket]; the on-screen buttons are the only
///    control. Useful when no other cameras are connected.
class CameraScreen extends StatefulWidget {
  const CameraScreen({
    super.key,
    this.socket,
    this.sessionId,
    this.embedded = false,
  });

  final SyncSocket? socket;
  final String? sessionId;

  /// True when hosted inside a tab (no Scaffold/AppBar of its own, and room
  /// left at the bottom for the floating dock).
  final bool embedded;

  bool get isSolo => socket == null;

  @override
  State<CameraScreen> createState() => _CameraScreenState();
}

class _CameraScreenState extends State<CameraScreen> {
  final List<StreamSubscription> _subs = [];
  Timer? _pendingStart;
  CameraController? _cameraController;
  bool _cameraReady = false;
  bool _recording = false;
  bool _permissionDenied = false;

  @override
  void initState() {
    super.initState();
    _initialize();
  }

  Future<void> _initialize() async {
    // Solo mode can be reached without going through SessionScreen, so ask
    // here too. Already-granted permissions return immediately.
    final statuses = await [Permission.camera, Permission.microphone].request();
    if (!statuses.values.every((s) => s.isGranted)) {
      if (mounted) setState(() => _permissionDenied = true);
      return;
    }

    await _initializeCamera();

    // Only a session-mode screen follows the synchronized broadcast.
    final socket = widget.socket;
    if (socket != null) {
      _subs.add(socket.recordingStart.listen(_scheduleStart));
      _subs.add(socket.recordingStop.listen((_) => _stopRecording()));
    }
  }

  Future<void> _initializeCamera() async {
    try {
      final cameras = await availableCameras();

      if (cameras.isEmpty) {
        debugPrint('No cameras available.');
        return;
      }

      _cameraController = CameraController(
        cameras.first,
        // 1080p. `medium` is only 480p, which looks pixelated full-screen and
        // is too soft to review formations or spacing. Drop to `high` (720p)
        // if upload size or bandwidth becomes the bottleneck.
        ResolutionPreset.veryHigh,
        enableAudio: true,
      );

      await _cameraController!.initialize();

      if (!mounted) return;

      setState(() {
        _cameraReady = true;
      });
    } catch (e) {
      debugPrint('Error initializing camera: $e');
    }
  }

  void _scheduleStart(int localStartEpochMs) {
    final delay =
        localStartEpochMs - DateTime.now().millisecondsSinceEpoch;

    _pendingStart?.cancel();

    _pendingStart = Timer(
      Duration(milliseconds: delay < 0 ? 0 : delay),
      _startRecording,
    );  //Timer
  }

  Future<void> _startRecording() async {
    if (_cameraController == null ||
        !_cameraController!.value.isInitialized) {
      debugPrint('Camera not ready');
      return;
    }

    if (_cameraController!.value.isRecordingVideo) {
      debugPrint('Already recording');
      return;
    }

    try {
      await _cameraController!.startVideoRecording();

      setState(() {
        _recording = true;
      });

      debugPrint('Recording started');
    } catch (e) {
      debugPrint('Start recording error: $e');
    }
  }

  Future<void> _stopRecording() async {
    if (_cameraController == null ||
        !_cameraController!.value.isRecordingVideo) {
      debugPrint('Not recording');
      return;
    }

    try {
      final file = await _cameraController!.stopVideoRecording();

      setState(() => _recording = false);

      debugPrint('Video saved: ${file.path}');
    } catch (e) {
      debugPrint('Stop recording error: $e');
    }
  }

  @override
  void dispose() {
    _pendingStart?.cancel();

    for (final sub in _subs) {
      sub.cancel();
    }
    
    _cameraController?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.embedded) {
      return _body();
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.isSolo ? 'Solo recording' : 'Camera'),
      ),
      body: _body(),
    );
  }

  Widget _body() {
    if (_permissionDenied) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'Camera and microphone permission are required to record.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.redAccent),
          ),
        ),
      );
    }

    if (!_cameraReady || _cameraController == null) {
      return const Center(child: CircularProgressIndicator());
    }

    return Stack(
      fit: StackFit.expand,
      children: [
        _preview(),

        // Recording indicator, kept clear of the status bar.
        if (_recording)
          const Positioned(
            top: 60,
            left: 0,
            right: 0,
            child: Center(
              child: Text(
                '● REC',
                style: TextStyle(
                  color: Colors.redAccent,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1,
                ),
              ),
            ),
          ),

        // Shutter: bottom-centre in portrait, right-hand side and vertically
        // centred in landscape — where your thumb sits holding the phone
        // sideways, and clear of the floating dock either way.
        if (MediaQuery.of(context).orientation == Orientation.landscape)
          Positioned(
            top: 0,
            bottom: 0,
            right: 32,
            child: Center(child: _shutter()),
          )
        else
          Positioned(
            left: 0,
            right: 0,
            bottom: widget.embedded ? 118 : 40,
            child: Center(child: _shutter()),
          ),
      ],
    );
  }

  /// Fills the screen without distorting, in either orientation.
  ///
  /// previewSize is always reported landscape-first (e.g. 1920x1080), so in
  /// portrait the dimensions have to be swapped before covering the viewport
  /// — otherwise the image renders squashed.
  Widget _preview() {
    final size = _cameraController!.value.previewSize!;
    final isPortrait =
        MediaQuery.of(context).orientation == Orientation.portrait;

    return ClipRect(
      child: FittedBox(
        fit: BoxFit.cover,
        child: SizedBox(
          width: isPortrait ? size.height : size.width,
          height: isPortrait ? size.width : size.height,
          child: CameraPreview(_cameraController!),
        ),
      ),
    );
  }

  Widget _shutter() {
    return GestureDetector(
      onTap: _recording ? _stopRecording : _startRecording,
      child: Container(
        width: 72,
        height: 72,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: Colors.white24,
          border: Border.all(color: Colors.white, width: 3),
        ),
        child: Center(
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            width: _recording ? 28 : 56,
            height: _recording ? 28 : 56,
            decoration: BoxDecoration(
              color: Colors.redAccent,
              borderRadius: BorderRadius.circular(_recording ? 6 : 28),
            ),
          ),
        ),
      ),
    );
  }
}