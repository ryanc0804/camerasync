import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'dart:async';
import '../socket/sync_socket.dart';

class CameraScreen extends StatefulWidget {
  const CameraScreen({
    super.key,
    required this.socket,
    required this.sessionId,
  });

  final SyncSocket socket;
  final String sessionId;

  @override
  State<CameraScreen> createState() => _CameraScreenState();
}

class _CameraScreenState extends State<CameraScreen> {
  late final SyncSocket _socket = widget.socket;
  final List<StreamSubscription> _subs = [];
  Timer? _pendingStart;
  CameraController? _cameraController;
  bool _cameraReady = false;
  bool _recording = false;
  XFile? _recordedFile;

  @override
  void initState() {
    super.initState();
    _initialize();
  }

  Future<void> _initialize() async {
    await _initializeCamera();

    _subs.add(
      _socket.recordingStart.listen(_scheduleStart),
    );

    _subs.add(
      _socket.recordingStop.listen((_) {
        _stopRecording();
      }),
    );
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
        ResolutionPreset.medium,
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

      setState(() {
        _recordedFile = file;
        _recording = false;
      });

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
    return Scaffold(
      appBar: AppBar(
        title: const Text('Camera'),
      ),
      body: Center(
        child: _cameraReady && _cameraController != null
            ? Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  AspectRatio(
                    aspectRatio: _cameraController!.value.aspectRatio,
                    child: CameraPreview(_cameraController!),
                  ),

                  const SizedBox(height: 20),

                  Text(
                    _recording ? '🔴 Recording' : 'Idle',
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                    ),
                  ),

                  const SizedBox(height: 20),

                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      FilledButton(
                        onPressed: _recording ? null : _startRecording,
                        child: const Text('Start'),
                      ),

                      const SizedBox(width: 20),

                      FilledButton(
                        onPressed: _recording ? _stopRecording : null,
                        child: const Text('Stop'),
                      ),
                    ],
                  ),
                ],
              )
            : const CircularProgressIndicator(),
      ),
    );
  }
}