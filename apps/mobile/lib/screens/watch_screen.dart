import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
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

  /// How far into each angle the shared timeline starts, so every angle
  /// shows the same moment. [_position], [_duration] and comment times are
  /// all on that shared timeline.
  Map<int, Duration> _trims = {};
  Duration _trimOf(int i) => _trims[i] ?? Duration.zero;

  /// Where angle [i]'s player is on the shared timeline.
  Duration _timelineAt(int i, VideoPlayerController player) {
    final at = player.value.position - _trimOf(i);
    return at < Duration.zero ? Duration.zero : at;
  }

  /// The angle index of the clock player, if it's open.
  int? get _clockIndex {
    for (final entry in _players.entries) {
      if (entry.value == _clockPlayer) return entry.key;
    }
    return null;
  }

  /// The shared-timeline position of the clock, or [_position] without one.
  Duration get _clockAt {
    final i = _clockIndex;
    final clock = _clockPlayer;
    return i == null || clock == null ? _position : _timelineAt(i, clock);
  }
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
      _trims = recording == null ? {} : angleTrims(recording.videos);
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

    _position = _clockAt;
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
      await player.seekTo(_position + _trimOf(missing[k]));
      if (_playing) player.play();
    }

    _setClock(_players[_selected] ??
        (_players.isEmpty ? null : _players.values.first));
    final durations = [
      for (final entry in _players.entries)
        entry.value.value.duration - _trimOf(entry.key),
    ];
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
    final at = _clockAt;
    if (at.inSeconds != _position.inSeconds) {
      setState(() => _position = at);
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
    _keepInLine?.cancel();
    _keepInLine = Timer.periodic(
        const Duration(milliseconds: 500), (_) => _realign());
  }

  void _pause() {
    _keepInLine?.cancel();
    for (final p in _players.values) {
      p.pause();
    }
    setState(() => _playing = false);
  }

  /// While several angles play (a big screen), moves any that has drifted
  /// more than 0.15 s from the clock angle back into line, the way the web
  /// player does. One angle on a phone has nothing to drift from.
  Timer? _keepInLine;

  void _realign() {
    final clockIndex = _clockIndex;
    final clock = _clockPlayer;
    if (!_playing || clockIndex == null || clock == null || _players.length < 2) {
      return;
    }
    final at = _timelineAt(clockIndex, clock);
    for (final entry in _players.entries) {
      if (entry.key == clockIndex) continue;
      final value = entry.value.value;
      if (!value.isInitialized || value.isBuffering) continue;
      final target = at + _trimOf(entry.key);
      if (target >= value.duration) continue;
      final drift = (value.position - target).inMilliseconds.abs();
      if (drift > 150) entry.value.seekTo(target);
    }
  }

  Future<void> _seek(Duration to) async {
    final target =
        to < Duration.zero ? Duration.zero : (to > _duration ? _duration : to);
    await Future.wait([
      for (final entry in _players.entries)
        entry.value.seekTo(target + _trimOf(entry.key)),
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
    _keepInLine?.cancel();
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
            if (recording != null) ...[
              _liveComment(recording),
              _timeline(),
            ],
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
          if (_recording != null)
            IconButton(
              onPressed: _downloading ? null : _download,
              tooltip: 'Download session',
              color: Colors.white,
              icon: _downloading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.download, size: 24),
            ),
          if (_recording != null)
            IconButton(
              onPressed: _showAddComment,
              tooltip: 'Add a comment',
              color: Colors.white,
              icon: const Icon(Icons.add_comment_outlined, size: 24),
            ),
        ],
      ),
    );
  }

  /// Comment dots are blue, like the web's.
  static const _commentBlue = Color(0xFF3B82F6);

  /// The comment playback is passing, shown for a few seconds from the
  /// moment it was left; the commenter (or an admin) can delete it here.
  Widget _liveComment(SessionRecording recording) {
    SessionNote? live;
    for (final n in _notes) {
      final at = Duration(milliseconds: n.videoTimeMs);
      if (_position >= at && _position < at + const Duration(seconds: 3)) {
        live = n;
      }
    }
    return SizedBox(
      height: 40,
      child: live == null
          ? null
          : Padding(
              padding: const EdgeInsets.symmetric(horizontal: 21),
              child: Row(
                children: [
                  const Icon(Icons.circle, size: 10, color: _commentBlue),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text.rich(
                      TextSpan(children: [
                        TextSpan(
                          text: '${live.authorName}: ',
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                        TextSpan(text: live.body),
                      ]),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Colors.white, fontSize: 14),
                    ),
                  ),
                  if (live.canDelete)
                    IconButton(
                      onPressed: () => _deleteNote(recording, live!),
                      tooltip: 'Delete comment',
                      color: const Color(0xFFFF6B6B),
                      icon: const Icon(Icons.close, size: 20),
                    ),
                ],
              ),
            ),
    );
  }

  /// A scrub bar with a blue dot wherever someone left a comment. Tap the
  /// bar to jump there, or a dot to jump to its comment.
  Widget _timeline() {
    final team = TeamAccent.of(context);
    final total = _duration.inMilliseconds;
    return Padding(
      padding: const EdgeInsets.fromLTRB(21, 0, 21, 4),
      child: SizedBox(
        height: 28,
        child: LayoutBuilder(builder: (context, constraints) {
          final width = constraints.maxWidth;
          double xOf(int ms) =>
              total <= 0 ? 0 : (ms / total).clamp(0.0, 1.0) * width;
          return GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTapDown: total <= 0
                ? null
                : (d) => _seek(Duration(
                    milliseconds:
                        (d.localPosition.dx / width * total).round())),
            child: Stack(
              alignment: Alignment.centerLeft,
              clipBehavior: Clip.none,
              children: [
                Container(
                  height: 4,
                  decoration: BoxDecoration(
                    color: const Color(0xFF333333),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                Container(
                  width: xOf(_position.inMilliseconds),
                  height: 4,
                  decoration: BoxDecoration(
                    color: team.accent,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                for (final n in _notes)
                  Positioned(
                    left: xOf(n.videoTimeMs) - 7,
                    child: GestureDetector(
                      onTap: () =>
                          _seek(Duration(milliseconds: n.videoTimeMs)),
                      child: Container(
                        width: 14,
                        height: 14,
                        decoration: BoxDecoration(
                          color: _commentBlue,
                          shape: BoxShape.circle,
                          border: Border.all(color: kBackground, width: 2),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          );
        }),
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

  bool _downloading = false;

  /// Downloads the whole session as one zip (a folder per recording, an
  /// angle per member) and opens the share sheet, so it can go to Files,
  /// Drive, a computer or a USB stick plugged into the phone.
  Future<void> _download() async {
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _downloading = true);
    messenger.showSnackBar(
        const SnackBar(content: Text('Preparing the download…')));
    File? file;
    try {
      final api = widget.auth.api;
      final cookie = api.cookie;
      final request = http.Request(
        'GET',
        Uri.parse('${api.baseUrl}/api/recordings/sessions/'
            '${widget.session.id}/download'),
      );
      if (cookie != null) request.headers['Cookie'] = cookie;
      final response = await http.Client().send(request);
      if (response.statusCode != 200) {
        throw ApiException(response.statusCode,
            'The download is not available right now (${response.statusCode}).');
      }
      final name = _zipName(response.headers['content-disposition']) ??
          '${widget.session.name}.zip';
      final dir = await getTemporaryDirectory();
      file = File('${dir.path}/$name');
      final sink = file.openWrite();
      await response.stream.pipe(sink);
      if (!mounted) return;
      messenger.hideCurrentSnackBar();
      await SharePlus.instance.share(ShareParams(
        files: [XFile(file.path, mimeType: 'application/zip')],
        subject: widget.session.name,
      ));
    } on ApiException catch (e) {
      messenger.hideCurrentSnackBar();
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } catch (_) {
      messenger.hideCurrentSnackBar();
      messenger.showSnackBar(const SnackBar(
          content: Text("Couldn't download the session. Try again.")));
    } finally {
      if (mounted) setState(() => _downloading = false);
    }
  }

  /// The file name the server suggests, e.g. "Stunt practice 2026-10-07.zip".
  static String? _zipName(String? disposition) {
    final match = RegExp(r'filename="([^"]+)"').firstMatch(disposition ?? '');
    final name = match?.group(1)?.replaceAll(RegExp(r'[/\\]'), '');
    return name == null || name.isEmpty ? null : name;
  }

  void _showAddComment() {
    final recording = _recording;
    if (recording == null) return;
    // Typing takes a while, so hold the picture still: the comment is
    // stamped with the moment on screen when the sheet opened, and its dot
    // lands there.
    if (_playing) _pause();
    final at = _clockAt;

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: TeamAccent.of(context).fillLight,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => _AddCommentSheet(
        at: at,
        onAdd: (body) => _addNote(recording, body, at),
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
/// Adds one comment at [at]. There's no list: comments show as dots on the
/// timeline and pop up as playback reaches them.
class _AddCommentSheet extends StatefulWidget {
  const _AddCommentSheet({required this.at, required this.onAdd});

  final Duration at;

  /// Saves the comment and returns the recording's refreshed comments.
  final Future<List<SessionNote>> Function(String body) onAdd;

  @override
  State<_AddCommentSheet> createState() => _AddCommentSheetState();
}

class _AddCommentSheetState extends State<_AddCommentSheet> {
  final _text = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _post() async {
    final body = _text.text.trim();
    if (body.isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.onAdd(body);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      // The text stays so it can be sent again.
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e is ApiException ? e.message : 'Something went wrong. Try again.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    // The sheet is a light tint of the team color; text is black or white,
    // whichever reads on it.
    final sheet = TeamAccent.of(context).fillLight;
    final ink = inkOn(sheet);
    return SafeArea(
      child: Padding(
        // Keeps the comment box above the keyboard.
        padding: EdgeInsets.fromLTRB(
            20, 16, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Comment at ${formatClock(widget.at)}',
              style: TextStyle(color: ink, fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _text,
                    autofocus: true,
                    maxLength: 500,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => _post(),
                    decoration: const InputDecoration(
                      hintText: 'What should they look at?',
                      counterText: '',
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  onPressed: _busy ? null : _post,
                  style: FilledButton.styleFrom(
                      backgroundColor: ink, foregroundColor: sheet),
                  child: Text(_busy ? 'Posting…' : 'Post'),
                ),
              ],
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: TextStyle(color: ink)),
            ],
          ],
        ),
      ),
    );
  }
}
