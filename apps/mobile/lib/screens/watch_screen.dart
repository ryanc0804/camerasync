import 'dart:async';

import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../api/api_client.dart';
import '../api/recordings_api.dart';
import '../auth/auth_service.dart';
import '../recordings/names.dart';
import '../theme.dart';
import '../widgets/empty_state.dart';

/// Multi-angle playback for one session (the "Watch" frame in the Figma):
/// a yellow panel holding a two-column grid of every device's video for the
/// current recording, one shared transport underneath that keeps them in
/// step, and a comments badge that opens the recording's notes.
///
/// Previous / next move between the session's recordings (Recording 001,
/// 002, ...). Every angle is a separate player; play, pause and seek are
/// applied to all of them so they stay on the shared clock.
class WatchScreen extends StatefulWidget {
  const WatchScreen({super.key, required this.auth, required this.session});

  final AuthService auth;
  final RecordingSession session;

  @override
  State<WatchScreen> createState() => _WatchScreenState();
}

class _WatchScreenState extends State<WatchScreen> {
  late final RecordingsApi _recordings = RecordingsApi(widget.auth.api);

  SessionVideos? _videos;
  int _index = 0;
  bool _loading = true;
  String? _error;

  /// One controller per uploaded angle of the current recording, in the
  /// same order as the recording's videos with null for missing uploads.
  List<VideoPlayerController?> _players = [];
  bool _ready = false;
  bool _playing = false;
  Duration _position = Duration.zero;
  Duration _duration = Duration.zero;
  List<SessionNote> _notes = [];

  SessionRecording? get _recording {
    final list = _videos?.recordings;
    if (list == null || list.isEmpty) return null;
    return list[_index.clamp(0, list.length - 1)];
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final videos = await _recordings.getSessionVideos(widget.session.id);
      if (!mounted) return;
      _videos = videos;
      // Newest recording first is how the web lists them; open on the
      // first one here too.
      _index = 0;
      await _openRecording();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    }
  }

  /// Tears down the current players and builds one per uploaded angle.
  Future<void> _openRecording() async {
    await _disposePlayers();
    final recording = _recording;
    setState(() {
      _loading = recording != null;
      _ready = false;
      _playing = false;
      _position = Duration.zero;
      _duration = Duration.zero;
      _notes = [];
    });
    if (recording == null) return;

    final cookie = widget.auth.api.cookie;
    final players = <VideoPlayerController?>[];
    for (final video in recording.videos) {
      final url = video.url;
      if (url == null) {
        players.add(null);
        continue;
      }
      players.add(VideoPlayerController.networkUrl(
        Uri.parse(_recordings.absoluteUrl(url)),
        httpHeaders: {if (cookie != null) 'Cookie': cookie},
      ));
    }

    // Initialize in parallel; an angle that fails to load is dropped rather
    // than blocking the rest.
    await Future.wait([
      for (var i = 0; i < players.length; i++)
        if (players[i] != null)
          players[i]!.initialize().catchError((_) {
            players[i]!.dispose();
            players[i] = null;
          }),
    ]);
    if (!mounted) {
      for (final p in players) {
        p?.dispose();
      }
      return;
    }

    _players = players;
    final durations = [
      for (final p in players)
        if (p != null) p.value.duration,
    ];
    _duration = durations.isEmpty
        ? Duration.zero
        : durations.reduce((a, b) => a > b ? a : b);
    _clock?.removeListener(_onTick);
    _clock?.addListener(_onTick);

    setState(() {
      _loading = false;
      _ready = durations.isNotEmpty;
    });

    _loadNotes(recording);
  }

  /// The first live player drives the on-screen clock.
  VideoPlayerController? get _clock {
    for (final p in _players) {
      if (p != null) return p;
    }
    return null;
  }

  void _onTick() {
    final clock = _clock;
    if (clock == null || !mounted) return;
    final value = clock.value;
    final ended = value.position >= value.duration && value.duration > Duration.zero;
    if (ended && _playing) {
      _pause();
      return;
    }
    if (value.position.inSeconds != _position.inSeconds) {
      setState(() => _position = value.position);
    }
  }

  Future<void> _loadNotes(SessionRecording recording) async {
    try {
      final notes = await _recordings.getSessionNotes(
        widget.session.id,
        recording.startedAtMs,
      );
      if (mounted && _recording == recording) setState(() => _notes = notes);
    } catch (_) {
      // Notes are optional; the player still works without them.
    }
  }

  Future<void> _disposePlayers() async {
    _clock?.removeListener(_onTick);
    final old = _players;
    _players = [];
    for (final p in old) {
      await p?.dispose();
    }
  }

  void _play() {
    for (final p in _players) {
      p?.play();
    }
    setState(() => _playing = true);
  }

  void _pause() {
    for (final p in _players) {
      p?.pause();
    }
    setState(() => _playing = false);
  }

  Future<void> _seek(Duration to) async {
    final target = to < Duration.zero
        ? Duration.zero
        : (to > _duration ? _duration : to);
    await Future.wait([
      for (final p in _players)
        if (p != null) p.seekTo(target),
    ]);
    if (mounted) setState(() => _position = target);
  }

  void _step(int delta) {
    final list = _videos?.recordings;
    if (list == null) return;
    final next = _index + delta;
    if (next < 0 || next >= list.length) return;
    _index = next;
    _openRecording();
  }

  @override
  void dispose() {
    _disposePlayers();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final recording = _recording;
    final count = _videos?.recordings.length ?? 0;

    return Scaffold(
      backgroundColor: kBackground,
      body: SafeArea(
        child: Column(
          children: [
            _header(),
            if (recording != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(21, 0, 21, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        recordingDisplayName(
                          recording.startedAtMs,
                          recording.number,
                        ),
                        style: const TextStyle(color: kMuted, fontSize: 13),
                      ),
                    ),
                    if (count > 1)
                      Text(
                        '${_index + 1} / $count',
                        style: const TextStyle(color: kMuted, fontSize: 13),
                      ),
                  ],
                ),
              ),
            Expanded(child: _body()),
            _transport(),
          ],
        ),
      ),
    );
  }

  Widget _header() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 4, 12, 4),
      child: Row(
        children: [
          IconButton(
            onPressed: () => Navigator.of(context).maybePop(),
            icon: const Icon(Icons.arrow_back, color: Colors.white, size: 28),
            tooltip: 'Back',
          ),
          Expanded(
            child: Text(
              widget.session.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: kGold,
                fontSize: 24,
                fontWeight: FontWeight.w800,
                letterSpacing: -0.24,
              ),
            ),
          ),
          if (_recording != null) _commentsBadge(),
        ],
      ),
    );
  }

  Widget _commentsBadge() {
    return TextButton.icon(
      onPressed: _showNotes,
      style: TextButton.styleFrom(foregroundColor: Colors.white),
      icon: const Icon(Icons.chat_bubble_outline, size: 22),
      label: Text(
        '${_notes.length}',
        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
      ),
    );
  }

  Widget _body() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator(color: kGold));
    }
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(20),
        child: EmptyState(
          title: "Couldn't load this session",
          message: _error!,
          actionLabel: 'Retry',
          onAction: _load,
        ),
      );
    }
    final recording = _recording;
    if (recording == null) {
      return const Padding(
        padding: EdgeInsets.all(20),
        child: EmptyState(
          title: 'No videos uploaded yet',
          message: 'Videos from this session appear here as each phone '
              'finishes uploading.',
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(21, 0, 21, 12),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: kGold,
          borderRadius: BorderRadius.circular(6),
        ),
        child: GridView.builder(
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2,
            mainAxisSpacing: 16,
            crossAxisSpacing: 16,
            childAspectRatio: 142 / 144,
          ),
          itemCount: recording.videos.length,
          itemBuilder: (context, i) => _AngleTile(
            video: recording.videos[i],
            player: i < _players.length ? _players[i] : null,
          ),
        ),
      ),
    );
  }

  Widget _transport() {
    final count = _videos?.recordings.length ?? 0;
    final enabled = _ready;

    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 0, 21, 16),
      child: Row(
        children: [
          IconButton(
            onPressed: _index > 0 ? () => _step(-1) : null,
            tooltip: 'Previous recording',
            icon: const Icon(Icons.skip_previous),
            color: kGold,
            disabledColor: kFaint,
            iconSize: 30,
          ),
          Material(
            color: enabled ? kGold : kFaint,
            shape: const CircleBorder(),
            child: InkWell(
              onTap: enabled ? (_playing ? _pause : _play) : null,
              customBorder: const CircleBorder(),
              child: SizedBox(
                width: 44,
                height: 44,
                child: Icon(
                  _playing ? Icons.pause : Icons.play_arrow,
                  color: Colors.black,
                  size: 28,
                ),
              ),
            ),
          ),
          IconButton(
            onPressed: _index < count - 1 ? () => _step(1) : null,
            tooltip: 'Next recording',
            icon: const Icon(Icons.skip_next),
            color: kGold,
            disabledColor: kFaint,
            iconSize: 30,
          ),
          const Spacer(),
          GestureDetector(
            // Tapping the clock nudges back ten seconds; the web has a scrub
            // bar, which can come once thumbnails land.
            onTap: enabled
                ? () => _seek(_position - const Duration(seconds: 10))
                : null,
            child: Text(
              '${formatClock(_position)} / ${formatClock(_duration)}',
              style: TextStyle(
                color: kGold.withValues(alpha: 0.8),
                fontSize: 22,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _showNotes() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: kGoldActive,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => _NotesSheet(
        notes: _notes,
        onSeek: (ms) {
          Navigator.of(context).pop();
          _seek(Duration(milliseconds: ms));
        },
      ),
    );
  }
}

/// One angle in the grid: the player, or a grey placeholder when that
/// member has not uploaded, with the member's name along the bottom.
class _AngleTile extends StatelessWidget {
  const _AngleTile({required this.video, required this.player});

  final AngleVideo video;
  final VideoPlayerController? player;

  static const _panel = Color(0xFF49454F);

  @override
  Widget build(BuildContext context) {
    final p = player;
    return ClipRRect(
      borderRadius: BorderRadius.circular(4),
      child: Container(
        color: _panel,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (p != null && p.value.isInitialized)
              FittedBox(
                fit: BoxFit.cover,
                child: SizedBox(
                  width: p.value.size.width,
                  height: p.value.size.height,
                  child: VideoPlayer(p),
                ),
              )
            else
              const Center(
                child: Text(
                  'Not uploaded',
                  style: TextStyle(color: Color(0xFFCFCBD6), fontSize: 12),
                ),
              ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                color: Colors.black45,
                child: Text(
                  video.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white, fontSize: 11),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The comments drawer from the design, as a bottom sheet: each note shows
/// the moment it refers to and jumps the players there when tapped.
class _NotesSheet extends StatelessWidget {
  const _NotesSheet({required this.notes, required this.onSeek});

  final List<SessionNote> notes;
  final ValueChanged<int> onSeek;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  '${notes.length}',
                  style: const TextStyle(
                    color: Colors.black,
                    fontSize: 32,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(width: 8),
                const Icon(Icons.chat_bubble_outline, color: Colors.black, size: 30),
                const Spacer(),
                const Text(
                  'Comments',
                  style: TextStyle(color: Colors.black54, fontSize: 14),
                ),
              ],
            ),
            const SizedBox(height: 8),
            if (notes.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Text(
                  'No comments on this recording yet. Add them from the web '
                  'while watching.',
                  style: TextStyle(color: Colors.black54),
                ),
              )
            else
              Flexible(
                child: ListView.separated(
                  shrinkWrap: true,
                  itemCount: notes.length,
                  separatorBuilder: (_, __) =>
                      const Divider(color: Colors.black12, height: 1),
                  itemBuilder: (context, i) {
                    final n = notes[i];
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      onTap: () => onSeek(n.videoTimeMs),
                      leading: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.black,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          formatClock(Duration(milliseconds: n.videoTimeMs)),
                          style: const TextStyle(
                            color: kGold,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      title: Text(
                        n.body,
                        style: const TextStyle(color: Colors.black),
                      ),
                      subtitle: Text(
                        n.authorName,
                        style: const TextStyle(color: Colors.black54),
                      ),
                    );
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}
