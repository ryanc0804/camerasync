import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'dart:async';
import '../api/api_client.dart';
import '../api/recordings_api.dart';
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
    this.recordings,
    this.embedded = false,
  });

  final SyncSocket? socket;
  final String? sessionId;

  /// Where finished recordings are uploaded. Only used in session mode: a
  /// video is uploaded when both [sessionId] and this are set.
  final RecordingsApi? recordings;

  /// True when hosted inside a tab (no Scaffold/AppBar of its own, and room
  /// left at the bottom for the floating dock).
  final bool embedded;

  bool get isSolo => socket == null;

  @override
  State<CameraScreen> createState() => _CameraScreenState();
}

enum _UploadState { idle, uploading, done, failed }

class _CameraScreenState extends State<CameraScreen> {
  final List<StreamSubscription> _subs = [];
  Timer? _pendingStart;
  CameraController? _cameraController;
  bool _cameraReady = false;
  bool _recording = false;
  bool _permissionDenied = false;

  /// Server-clock start of the recording in progress. Every device in the
  /// session shares this value, and the server groups uploads by it.
  int? _plannedStartAtEpochMs;

  /// "Recording N" for the current session recording, when the server said.
  int? _recordingNumber;

  /// The most recent finished recording, kept so a failed upload can be
  /// retried without recording again.
  String? _lastVideoPath;
  String? _lastVideoName;
  int? _lastStartedAtEpochMs;

  _UploadState _upload = _UploadState.idle;
  String _uploadMessage = '';

  bool get _uploadsEnabled =>
      widget.sessionId != null && widget.recordings != null;

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

  void _scheduleStart(RecordingStartCommand command) {
    _plannedStartAtEpochMs = command.serverStartAtEpochMs;
    _recordingNumber = command.recordingNumber;

    final delay = command.localStartAtEpochMs -
        DateTime.now().millisecondsSinceEpoch;

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

    // A manual shutter tap in session mode has no shared start command, so
    // stamp it with the server-clock "now" and it uploads on its own.
    final socket = widget.socket;
    if (_plannedStartAtEpochMs == null && socket != null) {
      _plannedStartAtEpochMs =
          socket.localToServer(DateTime.now().millisecondsSinceEpoch);
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

    final startedAt = _plannedStartAtEpochMs;
    _plannedStartAtEpochMs = null;
    _recordingNumber = null;

    try {
      final file = await _cameraController!.stopVideoRecording();

      setState(() => _recording = false);

      debugPrint('Video saved: ${file.path}');

      if (_uploadsEnabled && startedAt != null) {
        _lastVideoPath = file.path;
        _lastVideoName = file.name;
        _lastStartedAtEpochMs = startedAt;
        await _uploadLastVideo();
      }
    } catch (e) {
      debugPrint('Stop recording error: $e');
    }
  }

  /// Registers the finished video with the session and uploads it so it shows
  /// up in playback next to the other angles. The details call comes first so
  /// the session's video count includes this recording even if the upload
  /// fails; the upload can then be retried from the banner.
  Future<void> _uploadLastVideo() async {
    final sessionId = widget.sessionId;
    final api = widget.recordings;
    final path = _lastVideoPath;
    final startedAt = _lastStartedAtEpochMs;
    if (sessionId == null || api == null || path == null || startedAt == null) {
      return;
    }
    if (!mounted) return;

    setState(() {
      _upload = _UploadState.uploading;
      _uploadMessage = 'Uploading recording…';
    });

    try {
      await api.saveRecordingDetails(sessionId, startedAt);
      await api.uploadSessionVideo(
        sessionId,
        startedAt,
        path,
        filename: _lastVideoName,
      );
      if (!mounted) return;
      setState(() {
        _upload = _UploadState.done;
        _uploadMessage = 'Uploaded for playback';
      });
    } on ApiException catch (e) {
      debugPrint('Upload failed: ${e.message}');
      if (!mounted) return;
      setState(() {
        _upload = _UploadState.failed;
        _uploadMessage = 'Upload failed: ${e.message}';
      });
    } catch (e) {
      debugPrint('Upload failed: $e');
      if (!mounted) return;
      setState(() {
        _upload = _UploadState.failed;
        _uploadMessage = 'Upload failed. The video is still on this phone.';
      });
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
          Positioned(
            top: 60,
            left: 0,
            right: 0,
            child: Center(
              child: Text(
                _recordingNumber == null
                    ? '● REC'
                    : '● REC  ·  Recording ${_recordingNumber!.toString().padLeft(3, '0')}',
                style: const TextStyle(
                  color: Colors.redAccent,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1,
                ),
              ),
            ),
          ),

        // Upload status for the last recording, with a retry when it failed.
        if (_upload != _UploadState.idle)
          Positioned(
            top: 96,
            left: 16,
            right: 16,
            child: Center(child: _uploadBanner()),
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

  Widget _uploadBanner() {
    final failed = _upload == _UploadState.failed;
    final uploading = _upload == _UploadState.uploading;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.black54,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (uploading)
            const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: Colors.white,
              ),
            )
          else
            Icon(
              failed ? Icons.error_outline : Icons.cloud_done_outlined,
              size: 18,
              color: failed ? Colors.redAccent : Colors.greenAccent,
            ),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              _uploadMessage,
              style: const TextStyle(color: Colors.white, fontSize: 13),
            ),
          ),
          if (failed) ...[
            const SizedBox(width: 6),
            TextButton(
              onPressed: _uploadLastVideo,
              style: TextButton.styleFrom(
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: const Text('Retry'),
            ),
          ],
        ],
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