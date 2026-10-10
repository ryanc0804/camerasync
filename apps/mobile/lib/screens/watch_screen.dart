import 'dart:async';

import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../api/api_client.dart';
import '../api/recordings_api.dart';
import '../auth/auth_service.dart';
import '../recordings/names.dart';
import '../team_accent.dart';
import '../theme.dart';
import '../widgets/empty_state.dart';

/// A screen at least this big (a TV, a monitor, a tablet on its side) shows
/// every angle at once like the desktop app. Phones, even turned sideways,
/// show one camera at a time and decode only that one video.
bool isBigScreen(Size size) => size.width >= 900 && size.height >= 500;

/// Playback for one session (the "Watch" frame in the Figma). On a phone it
/// plays one camera at a time, with a row of buttons to switch cameras; on a
/// big screen it shows a grid of every angle like the desktop app. Either
/// way one shared transport keeps the players on the same clock, and a
/// comments badge opens the recording's notes.
///
/// Previous / next move between the session's recordings (Recording 001,
/// 002, ...).
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

  /// Open players by angle index in the current recording. On a phone only
  /// the selected angle is open; on a big screen every uploaded one is.
  final Map<int, VideoPlayerController> _players = {};
  int _selected = 0;
  bool _bigScreen = false;
  VideoPlayerController? _clockPlayer;
  int _syncGeneration = 0;

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

  List<int> get _uploadedAngles => [
        for (var i = 0; i < (_recording?.videos.length ?? 0); i++)
          if (_recording!.videos[i].url != null) i,
      ];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final big = isBigScreen(MediaQuery.sizeOf(context));
    if (big != _bigScreen) {
      _bigScreen = big;
      // Plugging into a TV or rotating a tablet opens or closes the other
      // angles' players.
      if (_recording != null && !_loading) _syncPlayers();
    }
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

  /// Closes the current players and opens the new recording on its first
  /// uploaded angle.
  Future<void> _openRecording() async {
    await _closeAllPlayers();
    final recording = _recording;
    final uploaded = _uploadedAngles;
    setState(() {
      _loading = recording != null;
      _ready = false;
      _playing = false;
      _position = Duration.zero;
      _duration = Duration.zero;
      _notes = [];
      _selected = uploaded.isEmpty ? 0 : uploaded.first;
    });
    if (recording == null) return;
    await _syncPlayers();
    if (!mounted) return;
    setState(() => _loading = false);
    _loadNotes(recording);
  }

  /// Opens the players this screen size needs and closes the rest. A new
  /// player joins at the current position, playing if the others are.
  Future<void> _syncPlayers() async {
    final recording = _recording;
    if (recording == null) return;
    final generation = ++_syncGeneration;
    final wanted = _bigScreen ? _uploadedAngles.toSet() : {_selected};

    _position = _clockPlayer?.value.position ?? _position;
    for (final i in _players.keys.toList()) {
      if (!wanted.contains(i)) {
        final player = _players.remove(i)!;
        if (player == _clockPlayer) _setClock(null);
        await player.dispose();
      }
    }

    final missing = wanted.where((i) => !_players.containsKey(i)).toList();
    final opened =
        await Future.wait(missing.map((i) => _openPlayer(recording, i)));
    if (!mounted || generation != _syncGeneration || recording != _recording) {
      for (final player in opened) {
        await player?.dispose();
      }
      return;
    }

    for (var k = 0; k < missing.length; k++) {
      final player = opened[k];
      if (player == null) continue;
      _players[missing[k]] = player;
      await player.seekTo(_position);
      if (_playing) player.play();
    }

    _setClock(_players[_selected] ??
        (_players.isEmpty ? null : _players.values.first));
    final durations = [for (final p in _players.values) p.value.duration];
    setState(() {
      _duration = durations.isEmpty
          ? Duration.zero
          : durations.reduce((a, b) => a > b ? a : b);
      _ready = _players.isNotEmpty;
    });
  }

  /// One angle's player, or null if it fails to load (the tile then shows
  /// "Not uploaded" rather than blocking the other angles).
  Future<VideoPlayerController?> _openPlayer(
      SessionRecording recording, int i) async {
    final url = recording.videos[i].url;
    if (url == null) return null;
    final cookie = widget.auth.api.cookie;
    final player = VideoPlayerController.networkUrl(
      Uri.parse(_recordings.absoluteUrl(url)),
      httpHeaders: {if (cookie != null) 'Cookie': cookie},
    );
    try {
      await player.initialize();
      return player;
    } catch (_) {
      await player.dispose();
      return null;
    }
  }

  /// The player that drives the on-screen clock: the camera being watched,
  /// or on a big screen the first open one.
  void _setClock(VideoPlayerController? player) {
    if (player == _clockPlayer) return;
    _clockPlayer?.removeListener(_onTick);
    _clockPlayer = player;
    _clockPlayer?.addListener(_onTick);
  }

  VideoPlayerController? get _clock => _clockPlayer;

  void _onTick() {
    final clock = _clockPlayer;
    if (clock == null || !mounted) return;
    final value = clock.value;
    final ended =
        value.position >= value.duration && value.duration > Duration.zero;
    if (ended && _playing) {
      _pause();
      return;
    }
    if (value.position.inSeconds != _position.inSeconds) {
      setState(() => _position = value.position);
    }
  }

  Future<void> _selectAngle(int i) async {
    if (i == _selected) return;
    setState(() => _selected = i);
    if (_bigScreen) {
      _setClock(_players[i] ?? _clockPlayer);
    } else {
      await _syncPlayers();
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

  Future<void> _closeAllPlayers() async {
    _syncGeneration++;
    _setClock(null);
    final old = _players.values.toList();
    _players.clear();
    for (final p in old) {
      await p.dispose();
    }
  }

  void _play() {
    for (final p in _players.values) {
      p.play();
    }
    setState(() => _playing = true);
  }

  void _pause() {
    for (final p in _players.values) {
      p.pause();
    }
    setState(() => _playing = false);
  }

  Future<void> _seek(Duration to) async {
    final target =
        to < Duration.zero ? Duration.zero : (to > _duration ? _duration : to);
    await Future.wait([
      for (final p in _players.values) p.seekTo(target),
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
    _closeAllPlayers();
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
            if (recording != null && !_bigScreen && recording.videos.length > 1)
              _cameraButtons(recording),
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
              style: TextStyle(
                color: TeamAccent.of(context).accent,
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
    final team = TeamAccent.of(context);
    if (_loading) {
      return Center(child: CircularProgressIndicator(color: team.accent));
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

    final panel = BoxDecoration(
      color: team.fill,
      borderRadius: BorderRadius.circular(6),
    );

    if (!_bigScreen) {
      // One camera, as large as the screen allows, with the panel shaped to
      // the video instead of filling a tall phone screen with grey.
      final player = _players[_selected];
      final ratio = player != null && player.value.isInitialized
          ? player.value.aspectRatio
          : 16 / 9;
      return Padding(
        padding: const EdgeInsets.fromLTRB(21, 0, 21, 12),
        child: Center(
          child: AspectRatio(
            aspectRatio: ratio,
            child: Container(
              padding: const EdgeInsets.all(8),
              decoration: panel,
              child: _AngleTile(
                video: recording.videos[_selected],
                player: player,
                fit: BoxFit.contain,
              ),
            ),
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(21, 0, 21, 12),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: panel,
        child: LayoutBuilder(
          builder: (context, constraints) {
            // As many columns as keep each angle a sensible size, like the
            // desktop's grid.
            final n = recording.videos.length;
            final columns = n <= 1 ? 1 : (n <= 4 ? 2 : 3);
            final rows = (n / columns).ceil();
            const gap = 12.0;
            final width =
                (constraints.maxWidth - gap * (columns - 1)) / columns;
            final height = (constraints.maxHeight - gap * (rows - 1)) / rows;
            return GridView.builder(
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: columns,
                mainAxisSpacing: gap,
                crossAxisSpacing: gap,
                childAspectRatio: width / height,
              ),
              itemCount: n,
              itemBuilder: (context, i) => _AngleTile(
                video: recording.videos[i],
                player: _players[i],
                fit: BoxFit.contain,
              ),
            );
          },
        ),
      ),
    );
  }

  /// One button per camera; the selected one is filled with the team color.
  Widget _cameraButtons(SessionRecording recording) {
    final team = TeamAccent.of(context);
    return SizedBox(
      height: 48,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 21),
        itemCount: recording.videos.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, i) {
          final video = recording.videos[i];
          final selected = i == _selected;
          final uploaded = video.url != null;
          return Center(
            child: Semantics(
              selected: selected,
              child: ChoiceChip(
                label: Text(
                    uploaded ? video.name : '${video.name} (not uploaded)'),
                selected: selected,
                onSelected: uploaded ? (_) => _selectAngle(i) : null,
                showCheckmark: false,
                avatar: Icon(
                  Icons.videocam,
                  size: 18,
                  color: selected ? team.ink : Colors.white70,
                ),
                selectedColor: team.fill,
                backgroundColor: const Color(0xFF262626),
                labelStyle: TextStyle(
                  color: selected ? team.ink : Colors.white,
                  fontWeight: FontWeight.w600,
                ),
                side: BorderSide.none,
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _transport() {
    final team = TeamAccent.of(context);
    final count = _videos?.recordings.length ?? 0;
    final enabled = _ready;

    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 4, 21, 16),
      child: Row(
        children: [
          IconButton(
            onPressed: _index > 0 ? () => _step(-1) : null,
            tooltip: 'Previous recording',
            icon: const Icon(Icons.skip_previous),
            color: team.accent,
            disabledColor: kFaint,
            iconSize: 30,
          ),
          Material(
            color: enabled ? team.fill : kFaint,
            shape: const CircleBorder(),
            child: InkWell(
              onTap: enabled ? (_playing ? _pause : _play) : null,
              customBorder: const CircleBorder(),
              child: SizedBox(
                width: 44,
                height: 44,
                child: Icon(
                  _playing ? Icons.pause : Icons.play_arrow,
                  color: enabled ? team.ink : Colors.black,
                  size: 28,
                ),
              ),
            ),
          ),
          IconButton(
            onPressed: _index < count - 1 ? () => _step(1) : null,
            tooltip: 'Next recording',
            icon: const Icon(Icons.skip_next),
            color: team.accent,
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
                color: team.accent.withValues(alpha: 0.8),
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
    final recording = _recording;
    if (recording == null) return;
    // Typing takes a while, so hold the picture still: a new comment is
    // stamped with the moment on screen when the sheet opened.
    if (_playing) _pause();
    final at = _clock?.value.position ?? _position;

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: TeamAccent.of(context).fillLight,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => _NotesSheet(
        notes: _notes,
        at: at,
        onAdd: (body) => _addNote(recording, body, at),
        onDelete: (note) => _deleteNote(recording, note),
        onSeek: (ms) {
          Navigator.of(context).pop();
          _seek(Duration(milliseconds: ms));
        },
      ),
    );
  }

  Future<List<SessionNote>> _addNote(
    SessionRecording recording,
    String body,
    Duration at,
  ) async {
    await _recordings.createSessionNote(
      widget.session.id,
      recording.startedAtMs,
      body,
      at.inMilliseconds,
    );
    final notes = await _recordings.getSessionNotes(
      widget.session.id,
      recording.startedAtMs,
    );
    if (mounted && _recording == recording) setState(() => _notes = notes);
    return notes;
  }

  Future<List<SessionNote>> _deleteNote(
    SessionRecording recording,
    SessionNote note,
  ) async {
    await _recordings.deleteSessionNote(widget.session.id, note.id);
    final notes = [
      for (final n in _notes)
        if (n.id != note.id) n,
    ];
    if (mounted && _recording == recording) setState(() => _notes = notes);
    return notes;
  }
}

/// One angle: the player, or a grey placeholder when that member has not
/// uploaded, with the member's name along the bottom.
class _AngleTile extends StatelessWidget {
  const _AngleTile(
      {required this.video, required this.player, this.fit = BoxFit.cover});

  final AngleVideo video;
  final VideoPlayerController? player;
  final BoxFit fit;

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
                fit: fit,
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
/// the moment it refers to and jumps the players there when tapped. The box
/// at the bottom adds a note at [at], the paused position.
class _NotesSheet extends StatefulWidget {
  const _NotesSheet({
    required this.notes,
    required this.at,
    required this.onAdd,
    required this.onDelete,
    required this.onSeek,
  });

  final List<SessionNote> notes;
  final Duration at;

  /// Saves a note and returns the recording's refreshed notes.
  final Future<List<SessionNote>> Function(String body) onAdd;
  final Future<List<SessionNote>> Function(SessionNote note) onDelete;
  final ValueChanged<int> onSeek;

  @override
  State<_NotesSheet> createState() => _NotesSheetState();
}

class _NotesSheetState extends State<_NotesSheet> {
  late List<SessionNote> _notes = widget.notes;
  final _text = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  /// Runs a save or delete, showing the server's message if it fails.
  /// Returns whether it succeeded.
  Future<bool> _run(Future<List<SessionNote>> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final notes = await action();
      if (mounted) setState(() => _notes = notes);
      return true;
    } catch (e) {
      if (mounted) {
        setState(() => _error =
            e is ApiException ? e.message : 'Something went wrong. Try again.');
      }
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _add() async {
    final body = _text.text.trim();
    if (body.isEmpty || _busy) return;
    // On failure the text stays so it can be sent again.
    if (await _run(() => widget.onAdd(body))) _text.clear();
  }

  Future<void> _delete(SessionNote note) async {
    if (_busy) return;
    await _run(() => widget.onDelete(note));
  }

  @override
  Widget build(BuildContext context) {
    final notes = _notes;
    // The sheet is a light tint of the team color; text is black or white,
    // whichever reads on it.
    final sheet = TeamAccent.of(context).fillLight;
    final ink = inkOn(sheet);
    return SafeArea(
      child: Padding(
        // Keeps the comment box above the keyboard.
        padding: EdgeInsets.fromLTRB(
          20,
          16,
          20,
          20 + MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  '${notes.length}',
                  style: TextStyle(
                    color: ink,
                    fontSize: 32,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(width: 8),
                Icon(Icons.chat_bubble_outline, color: ink, size: 30),
                const Spacer(),
                Text(
                  'Comments',
                  style: TextStyle(
                      color: ink.withValues(alpha: 0.6), fontSize: 14),
                ),
              ],
            ),
            const SizedBox(height: 8),
            if (notes.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 24),
                child: Text(
                  'No comments on this recording yet. Add the first one below.',
                  style: TextStyle(color: ink.withValues(alpha: 0.6)),
                ),
              )
            else
              Flexible(
                child: ListView.separated(
                  shrinkWrap: true,
                  itemCount: notes.length,
                  separatorBuilder: (_, __) =>
                      Divider(color: ink.withValues(alpha: 0.12), height: 1),
                  itemBuilder: (context, i) {
                    final n = notes[i];
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      onTap: () => widget.onSeek(n.videoTimeMs),
                      leading: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: ink,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          formatClock(Duration(milliseconds: n.videoTimeMs)),
                          style: TextStyle(
                            color: sheet,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      title: Text(
                        n.body,
                        style: TextStyle(color: ink),
                      ),
                      subtitle: Text(
                        n.authorName,
                        style: TextStyle(color: ink.withValues(alpha: 0.6)),
                      ),
                      trailing: n.canDelete
                          ? IconButton(
                              onPressed: _busy ? null : () => _delete(n),
                              tooltip: 'Delete comment',
                              icon: const Icon(Icons.delete_outline),
                              color: ink.withValues(alpha: 0.87),
                            )
                          : null,
                    );
                  },
                ),
              ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  _error!,
                  style: const TextStyle(color: Color(0xFFB3261E)),
                ),
              ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _text,
                    enabled: !_busy,
                    maxLength: 500,
                    textInputAction: TextInputAction.send,
                    onChanged: (_) => setState(() {}),
                    onSubmitted: (_) => _add(),
                    style: const TextStyle(color: Colors.black),
                    cursorColor: Colors.black,
                    decoration: InputDecoration(
                      hintText: 'Comment at ${formatClock(widget.at)}',
                      hintStyle: const TextStyle(color: Colors.black45),
                      counterText: '',
                      filled: true,
                      fillColor: Colors.white,
                      isDense: true,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                        borderSide: BorderSide.none,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(
                  onPressed: _busy || _text.text.trim().isEmpty ? null : _add,
                  tooltip: 'Post comment',
                  style: IconButton.styleFrom(
                    backgroundColor: ink,
                    foregroundColor: sheet,
                    disabledBackgroundColor: ink.withValues(alpha: 0.26),
                  ),
                  icon: _busy
                      ? SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: sheet,
                          ),
                        )
                      : const Icon(Icons.send),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
