import 'dart:async';

import 'package:external_display/transfer_parameters.dart';
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../playback/angle_sync.dart';
import '../recordings/angle_layout.dart';
import '../theme.dart';
import 'tv_protocol.dart';

/// The app on a TV plugged into the phone: a separate Flutter engine started
/// by the external_display plugin (externalDisplayMain in main.dart). It
/// plays a recording's angles together, as many as fit, and the phone is
/// the remote (see TvLink).
class TvApp extends StatelessWidget {
  const TvApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: kBackground,
        useMaterial3: true,
      ),
      home: const TvScreen(),
    );
  }
}

class _TvAngle {
  const _TvAngle(this.name, this.url, this.trim);
  final String name;
  final String url;
  final Duration trim;
}

class TvScreen extends StatefulWidget {
  const TvScreen({super.key});

  @override
  State<TvScreen> createState() => _TvScreenState();
}

class _TvScreenState extends State<TvScreen> {
  String? _session;
  String? _recording;
  String? _cookie;
  List<_TvAngle> _angles = const [];

  final Map<int, VideoPlayerController> _players = {};
  int _generation = 0;
  bool _playing = false;
  bool _realigning = false;
  Duration _position = Duration.zero;
  Duration _duration = Duration.zero;
  int _page = 0;
  int? _focused;
  ({String author, String body})? _comment;
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    transferParameters.addListener(_onMessage);
    // Position goes back to the phone (its timeline and comments follow
    // it), and the angles are pulled back into line while playing.
    _tick = Timer.periodic(const Duration(milliseconds: 250), (_) => _onTick());
  }

  @override
  void dispose() {
    _tick?.cancel();
    transferParameters.removeListener(_onMessage);
    for (final player in _players.values) {
      player.dispose();
    }
    super.dispose();
  }

  // ---- Layout ------------------------------------------------------------

  int get _perPage {
    final size = MediaQuery.sizeOf(context);
    // Each angle is its own video decoder on the phone, so no more than 9.
    return anglesPerPage(Size(size.width - 48, size.height - 120), 16 / 9,
        minTileWidth: 360);
  }

  int get _pageCount =>
      _angles.isEmpty ? 0 : (_angles.length / _perPage).ceil();

  List<int> get _liveAngles {
    final focused = _focused;
    if (focused != null) return [focused];
    final start = _page * _perPage;
    return [
      for (var i = start; i < _angles.length && i < start + _perPage; i++) i
    ];
  }

  // ---- Messages from the phone -----------------------------------------

  void _onMessage({required String action, dynamic value}) {
    final map = value is Map ? value : const {};
    Duration at() =>
        Duration(milliseconds: (map['atMs'] as num?)?.toInt() ?? 0);
    switch (action) {
      case TvAction.load:
        _load(map);
      case TvAction.idle:
        _closeAll();
        setState(() {
          _session = null;
          _angles = const [];
          _playing = false;
        });
      case TvAction.play:
        _position = at();
        _playing = true;
        _syncPlayers();
      case TvAction.pause:
        _playing = false;
        _position = at();
        _syncPlayers();
      case TvAction.seek:
        _position = at();
        _syncPlayers();
      case TvAction.page:
        final page = (map['page'] as num?)?.toInt() ?? 0;
        setState(() {
          _page = page.clamp(0, _pageCount == 0 ? 0 : _pageCount - 1);
          _focused = null;
        });
        _syncPlayers();
      case TvAction.focus:
        final angle = (map['angle'] as num?)?.toInt() ?? -1;
        setState(() =>
            _focused = angle >= 0 && angle < _angles.length ? angle : null);
        _syncPlayers();
      case TvAction.comment:
        setState(() => _comment = value is Map
            ? (
                author: (value['author'] ?? '').toString(),
                body: (value['body'] ?? '').toString(),
              )
            : null);
    }
  }

  void _load(Map map) {
    _closeAll();
    final angles = <_TvAngle>[
      for (final a in (map['angles'] as List? ?? const []))
        if (a is Map && a['url'] != null)
          _TvAngle(
            (a['name'] ?? '').toString(),
            a['url'].toString(),
            Duration(milliseconds: (a['trimMs'] as num?)?.toInt() ?? 0),
          ),
    ];
    setState(() {
      _session = (map['session'] ?? '').toString();
      _recording = (map['recording'] ?? '').toString();
      _cookie = map['cookie'] as String?;
      _angles = angles;
      _page = 0;
      _focused = null;
      _comment = null;
      _playing = map['playing'] == true;
      _position = Duration(milliseconds: (map['atMs'] as num?)?.toInt() ?? 0);
      _duration = Duration.zero;
    });
    _syncPlayers();
  }

  // ---- Players -----------------------------------------------------------

  void _closeAll() {
    _generation++;
    for (final player in _players.values) {
      player.dispose();
    }
    _players.clear();
  }

  /// Opens the angles on screen and closes the rest, then puts them all at
  /// [_position], playing or paused.
  Future<void> _syncPlayers() async {
    final generation = ++_generation;
    final live = _liveAngles.toSet();
    for (final i in _players.keys.toList()) {
      if (!live.contains(i)) await _players.remove(i)!.dispose();
    }
    final missing = live.where((i) => !_players.containsKey(i)).toList();
    final opened = await Future.wait(missing.map(_open));
    if (!mounted || generation != _generation) {
      for (final player in opened) {
        await player?.dispose();
      }
      return;
    }
    for (var k = 0; k < missing.length; k++) {
      final player = opened[k];
      if (player != null) _players[missing[k]] = player;
    }
    // Every angle on the exact same moment (a pause, a seek, a new page).
    await Future.wait([
      for (final entry in _players.entries)
        entry.value.seekTo(_position + _angles[entry.key].trim),
      AngleSync.resetSpeeds(_players.values),
    ]);
    for (final player in _players.values) {
      _playing ? player.play() : player.pause();
    }
    final durations = [
      for (final entry in _players.entries)
        entry.value.value.duration - _angles[entry.key].trim,
    ];
    if (durations.isNotEmpty) {
      final longest = durations.reduce((a, b) => a > b ? a : b);
      if (longest > _duration) _duration = longest;
    }
    if (mounted) setState(() {});
  }

  Future<VideoPlayerController?> _open(int i) async {
    final cookie = _cookie;
    final player = VideoPlayerController.networkUrl(
      Uri.parse(_angles[i].url),
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

  void _onTick() {
    if (_angles.isEmpty) return;
    final live = _liveAngles.where(_players.containsKey).toList();
    if (live.isNotEmpty) {
      final clock = _players[live.first]!;
      final at = clock.value.position - _angles[live.first].trim;
      if (_playing) {
        _position = at < Duration.zero ? Duration.zero : at;
        // Keep every angle on the first one's moment (see AngleSync).
        if (!_realigning && live.length > 1) {
          _realigning = true;
          AngleSync.keepInLine(
            clock: clock,
            clockTrim: _angles[live.first].trim,
            others: {
              for (final i in live.skip(1)) _players[i]!: _angles[i].trim,
            },
          ).whenComplete(() => _realigning = false);
        }
        if (_duration > Duration.zero && _position >= _duration) {
          _playing = false;
          for (final player in _players.values) {
            player.pause();
          }
        }
      }
    }
    // Not awaited: the plugin never answers messages sent this way.
    transferParameters.sendParameters(
      action: TvAction.state,
      value: TvState(
        position: _position,
        duration: _duration,
        playing: _playing,
        page: _page,
        pageCount: _pageCount,
        focused: _focused,
      ).toMap(),
    );
  }

  // ---- Screen --------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    if (_session == null) return _idle();
    final angles = _liveAngles;
    return Scaffold(
      backgroundColor: kBackground,
      body: Padding(
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    _session!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        color: kGold, fontSize: 28, fontWeight: FontWeight.w800),
                  ),
                ),
                Text(
                  [
                    _recording ?? '',
                    if (_focused == null && _pageCount > 1)
                      'Page ${_page + 1} of $_pageCount',
                  ].where((s) => s.isNotEmpty).join('  ·  '),
                  style: const TextStyle(color: kMuted, fontSize: 18),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Expanded(
              child: LayoutBuilder(builder: (context, constraints) {
                final aspect = commonAspect([
                  for (final i in angles)
                    if (_players[i]?.value.isInitialized ?? false)
                      _players[i]!.value.aspectRatio
                ]);
                final rects =
                    gridLayout(constraints.biggest, angles.length, aspect, gap: 12);
                return Stack(
                  children: [
                    for (var k = 0; k < rects.length; k++)
                      Positioned.fromRect(
                        rect: rects[k],
                        child: _tile(angles[k]),
                      ),
                    if (_comment != null)
                      Positioned(
                        left: 0,
                        right: 0,
                        bottom: 12,
                        child: Center(child: _commentBubble(_comment!)),
                      ),
                  ],
                );
              }),
            ),
          ],
        ),
      ),
    );
  }

  Widget _tile(int i) {
    final player = _players[i];
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: ColoredBox(
        color: Colors.black,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (player != null && player.value.isInitialized)
              FittedBox(
                fit: BoxFit.contain,
                child: SizedBox(
                  width: player.value.size.width,
                  height: player.value.size.height,
                  child: VideoPlayer(player),
                ),
              )
            else
              const Center(child: CircularProgressIndicator()),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: Container(
                color: Colors.black54,
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                child: Text(
                  _angles[i].name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white, fontSize: 16),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _commentBubble(({String author, String body}) comment) {
    return Container(
      constraints: const BoxConstraints(maxWidth: 1000),
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.black87,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text.rich(
        TextSpan(children: [
          TextSpan(
            text: '${comment.author}: ',
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          TextSpan(text: comment.body),
        ]),
        style: const TextStyle(color: Colors.white, fontSize: 22),
      ),
    );
  }

  Widget _idle() {
    return const Scaffold(
      backgroundColor: kBackground,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('8kount',
                style: TextStyle(
                    color: kGold, fontSize: 56, fontWeight: FontWeight.w800)),
            SizedBox(height: 12),
            Text('Open a recording on your phone to watch it here.',
                style: TextStyle(color: kMuted, fontSize: 22)),
          ],
        ),
      ),
    );
  }
}
