import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../api/groups_api.dart';
import '../api/recordings_api.dart';
import '../auth/auth_service.dart';
import '../config.dart';
import '../team_accent.dart';
import '../theme.dart';
import '../widgets/auto_refresh.dart';
import '../widgets/empty_state.dart';
import 'session_screen.dart';
import 'watch_screen.dart';

const _monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/// Over: finished, or its hour has passed. The calendar fades these so the
/// color lands on what's ahead.
bool isPastSession(RecordingSession s) {
  if (s.isActive) return false;
  if (s.isComplete) return true;
  final at = s.scheduledAt;
  return at != null &&
      at.add(const Duration(hours: 1)).isBefore(DateTime.now());
}

bool _sameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

String _formatWhen(DateTime? at) {
  if (at == null) return '';
  final time = TimeOfDay.fromDateTime(at);
  final hour = time.hourOfPeriod == 0 ? 12 : time.hourOfPeriod;
  return '${_monthNames[at.month - 1]} ${at.day}, ${at.year} at '
      '$hour:${time.minute.toString().padLeft(2, '0')} '
      '${time.period == DayPeriod.am ? 'AM' : 'PM'}';
}

/// Live first, then upcoming soonest first, then past most recent first, the
/// same order as the web app's session list.
List<RecordingSession> _sorted(List<RecordingSession> sessions) {
  final now = DateTime.now();
  int key(RecordingSession s) =>
      s.isActive ? 0 : ((s.scheduledAt ?? now).isBefore(now) ? 2 : 1);
  return [...sessions]..sort((a, b) {
      final byGroup = key(a).compareTo(key(b));
      if (byGroup != 0) return byGroup;
      final at = a.scheduledAt ?? now, bt = b.scheduledAt ?? now;
      return key(a) == 2 ? bt.compareTo(at) : at.compareTo(bt);
    });
}

/// The "Live & upcoming" half of the Sessions tab: sessions that can still
/// be recorded, live first. Everyone can join one to record; a session's
/// host and the group's admins can end or cancel it. Starting, scheduling
/// and joining by code are on the + button.
class JoinScreen extends StatefulWidget {
  const JoinScreen({super.key, required this.auth, this.refresh, this.day});

  final AuthService auth;

  /// Only the sessions on this day, past ones included (the calendar's day
  /// page). Null: everything live and upcoming.
  final DateTime? day;

  /// Fires when a session was started or scheduled elsewhere (the + menu).
  final Listenable? refresh;

  @override
  State<JoinScreen> createState() => _JoinScreenState();
}

class _JoinScreenState extends State<JoinScreen> {
  late final RecordingsApi _recordings = RecordingsApi(widget.auth.api);
  late final GroupsApi _groupsApi = GroupsApi(widget.auth.api);

  List<RecordingSession> _sessions = [];
  List<Group> _groups = [];
  bool _loading = true;
  String? _error;
  String? _busyId;

  Group? _groupOf(RecordingSession s) {
    for (final g in _groups) {
      if (g.id == s.groupId) return g;
    }
    return null;
  }

  bool _canManage(RecordingSession s) =>
      s.createdBy == widget.auth.user?.id || _groupOf(s)?.role == 'admin';

  /// Viewers watch but don't record.
  bool _canJoin(RecordingSession s) => _groupOf(s)?.role != 'viewer';

  @override
  void initState() {
    super.initState();
    widget.refresh?.addListener(_load);
    _load();
    // Live sessions appear (and ended ones go) without pulling down.
    _refresher = AutoRefresher(const Duration(seconds: 10), _load);
  }

  late final AutoRefresher _refresher;

  @override
  void dispose() {
    _refresher.dispose();
    widget.refresh?.removeListener(_load);
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = _sessions.isEmpty;
      _error = null;
    });
    try {
      final results = await Future.wait([
        _recordings.getSessions(),
        _groupsApi.getMyGroups(),
      ]);
      if (!mounted) return;
      setState(() {
        // Finished and cancelled sessions are under Past, except on a
        // calendar day, which shows the whole day.
        final day = widget.day;
        _sessions = day != null
            ? ([
                for (final s in results[0] as List<RecordingSession>)
                  if (s.scheduledAt != null && _sameDay(s.scheduledAt!, day)) s
              ]..sort((a, b) => a.scheduledAt!.compareTo(b.scheduledAt!)))
            : _sorted([
                for (final s in results[0] as List<RecordingSession>)
                  if (s.isActive || s.isScheduled) s
              ]);
        _groups = results[1] as List<Group>;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    }
  }

  void _toast(String message) => ScaffoldMessenger.of(context)
      .showSnackBar(SnackBar(content: Text(message)));

  Future<void> _openSession(RecordingSession session) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => SessionScreen(
          serverUrl: kServerUrl,
          auth: widget.auth,
          sessionId: session.id,
          sessionName: session.name,
        ),
      ),
    );
    if (mounted) _load();
  }

  void _watch(RecordingSession session) => Navigator.of(context).push(
        MaterialPageRoute(
            builder: (_) => WatchScreen(auth: widget.auth, session: session)),
      );

  Future<void> _join(RecordingSession session) async {
    setState(() => _busyId = session.id);
    try {
      // REST join first: it records membership (and activates a scheduled
      // session), which the socket room checks before letting us in.
      final joined = await _recordings.joinSession(session.id);
      if (mounted) await _openSession(joined);
    } on ApiException catch (e) {
      _toast(e.message);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<bool> _confirm(String message, String action) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: Text(message),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Keep it')),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: FilledButton.styleFrom(backgroundColor: kLiveRed),
            child: Text(action),
          ),
        ],
      ),
    );
    return ok == true;
  }

  Future<void> _end(RecordingSession s) async {
    if (!await _confirm('End ${s.name} for everyone?', 'End session')) return;
    await _run(s, () => _recordings.endSession(s.id));
  }

  Future<void> _cancel(RecordingSession s) async {
    if (!await _confirm('Cancel ${s.name}?', 'Cancel session')) return;
    await _run(s, () => _recordings.cancelSession(s.id));
  }

  Future<void> _run(RecordingSession s, Future<void> Function() action) async {
    setState(() => _busyId = s.id);
    try {
      await action();
      await _load();
    } on ApiException catch (e) {
      _toast(e.message);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  /// What tapping a session does: into it while it's open, its takes once
  /// it's over. Null when there's nothing to do (or something's loading).
  VoidCallback? _open(RecordingSession s) {
    if (_busyId != null || s.isCancelled) return null;
    if (s.isComplete) return () => _watch(s);
    if (!_canJoin(s)) return null;
    return () => s.isJoined && s.isActive ? _openSession(s) : _join(s);
  }

  @override
  Widget build(BuildContext context) {
    final day = widget.day;
    if (day != null && !_loading && _error == null) {
      return _DayTimeline(
        day: day,
        sessions: _sessions,
        colorOf: (s) =>
            parseHexColor(_groupOf(s)?.primaryColor) ??
            TeamAccent.of(context).fill,
        groupNameOf: (s) =>
            s.groupId == null ? 'No group' : _groupOf(s)?.name ?? '',
        busyId: _busyId,
        onOpen: _open,
        onRefresh: _load,
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 110),
        children: [
          if (_loading)
            const Padding(
              padding: EdgeInsets.only(top: 48),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_error != null)
            EmptyState(
              title: "Couldn't load sessions",
              message: _error!,
              actionLabel: 'Retry',
              onAction: _load,
            )
          else if (_sessions.isEmpty && widget.day != null)
            const EmptyState(
              title: 'Nothing this day',
              message: 'Tap + to schedule a session.',
            )
          else if (_sessions.isEmpty)
            const EmptyState(
              title: 'Nothing live or scheduled',
              message: 'Tap + to start or schedule a session. When a coach '
                  'starts one for your groups, it shows up here to join.',
            )
          else
            for (final s in _sessions)
              _SessionCard(
                session: s,
                // A session without a group shows its code, to share.
                groupName: s.groupId == null
                    ? 'No group · code ${s.id}'
                    : _groupOf(s)?.name ?? '',
                busy: _busyId == s.id,
                canManage: _canManage(s),
                canJoin: _canJoin(s),
                onJoin: _busyId == null
                    ? () =>
                        s.isJoined && s.isActive ? _openSession(s) : _join(s)
                    : null,
                onEnd: () => _end(s),
                onCancel: () => _cancel(s),
                // Tapping the card itself does what it's there for: into
                // the session when it's open, its takes once it's over.
                onTap: _open(s),
                onWatch: () => _watch(s),
              ),
        ],
      ),
    );
  }
}

class _SessionCard extends StatelessWidget {
  const _SessionCard({
    required this.session,
    required this.groupName,
    required this.busy,
    required this.canManage,
    required this.canJoin,
    required this.onJoin,
    required this.onEnd,
    required this.onCancel,
    required this.onWatch,
    this.onTap,
  });

  final RecordingSession session;
  final VoidCallback? onTap;
  final String groupName;
  final bool busy;
  final bool canManage;
  final bool canJoin;
  final VoidCallback? onJoin;
  final VoidCallback onEnd;
  final VoidCallback onCancel;
  final VoidCallback onWatch;

  String get _status => switch (session.status) {
        'active' => 'Live',
        'scheduled' => 'Scheduled',
        'cancelled' => 'Cancelled',
        _ => 'Complete',
      };

  @override
  Widget build(BuildContext context) {
    final team = TeamAccent.of(context);
    final s = session;
    final open = s.isActive || s.isScheduled;
    final count = s.activeMemberCount;

    final actions = <Widget>[
      if (canManage && s.isScheduled)
        IconButton(
          onPressed: busy ? null : onCancel,
          tooltip: 'Cancel ${s.name}',
          icon: const Icon(Icons.close, color: kLiveRed),
        ),
      if (open && canJoin)
        FilledButton(
          onPressed: busy ? null : onJoin,
          style: FilledButton.styleFrom(
              backgroundColor: team.fill, foregroundColor: team.ink),
          child: busy
              ? SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: team.ink),
                )
              : Text(s.isJoined && s.isActive ? 'Enter Session' : 'Join'),
        ),
      if (canManage && s.isActive)
        OutlinedButton(
          onPressed: busy ? null : onEnd,
          style: OutlinedButton.styleFrom(
            foregroundColor: kLiveRed,
            side: const BorderSide(color: Color(0xFF5A2A2A)),
          ),
          child: const Text('End Session'),
        ),
      // Takes already recorded can be watched while the session is live.
      if (s.isComplete || (s.isActive && (s.recordingCount ?? 0) > 0))
        TextButton(
          onPressed: onWatch,
          style: TextButton.styleFrom(foregroundColor: team.accent),
          child: const Text('Watch'),
        ),
    ];

    return Opacity(
      opacity: s.isCancelled ? 0.5 : 1,
      child: Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Material(
          color: const Color(0xFF1C1C1C),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
            side: s.isActive
                ? BorderSide(color: team.accent, width: 1.5)
                : BorderSide.none,
          ),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: busy ? null : onTap,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 12, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(s.name,
                                style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 16,
                                    fontWeight: FontWeight.w700)),
                            if (groupName.isNotEmpty)
                              Text(groupName,
                                  style: const TextStyle(
                                      color: kMuted, fontSize: 13)),
                          ],
                        ),
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            _status,
                            style: TextStyle(
                              color: s.isActive ? team.accent : kMuted,
                              fontWeight: s.isActive
                                  ? FontWeight.w700
                                  : FontWeight.w500,
                            ),
                          ),
                          Text(s.id,
                              style: TextStyle(
                                  color: team.accent,
                                  fontFamily: 'monospace',
                                  fontSize: 12)),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    [
                      _formatWhen(s.scheduledAt),
                      if (open)
                        '$count ${s.isActive ? 'in session' : 'joined'}',
                    ].where((part) => part.isNotEmpty).join(' · '),
                    style: const TextStyle(color: kMuted, fontSize: 13),
                  ),
                  if (actions.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Wrap(
                      alignment: WrapAlignment.end,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 8,
                      runSpacing: 4,
                      children: actions,
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// One day as hours down the screen, each session a block at its time in
/// its group's color, like Google Calendar's day view. Sessions have no set
/// end, so each fills an hour; ones that overlap share the width.
class _DayTimeline extends StatefulWidget {
  const _DayTimeline({
    required this.day,
    required this.sessions,
    required this.colorOf,
    required this.groupNameOf,
    required this.busyId,
    required this.onOpen,
    required this.onRefresh,
  });

  final DateTime day;
  final List<RecordingSession> sessions;
  final Color Function(RecordingSession) colorOf;
  final String Function(RecordingSession) groupNameOf;
  final String? busyId;
  final VoidCallback? Function(RecordingSession) onOpen;
  final Future<void> Function() onRefresh;

  @override
  State<_DayTimeline> createState() => _DayTimelineState();
}

class _DayTimelineState extends State<_DayTimeline> {
  static const _hourHeight = 60.0;
  static const _sessionMinutes = 60;
  static const _gutter = 56.0;

  late final ScrollController _scroll = ScrollController(
    // Opens on the first session (or now, or 8 AM), a little above it.
    initialScrollOffset: math.max(
        0,
        ((widget.sessions.isNotEmpty
                        ? _minutes(widget.sessions.first.scheduledAt!)
                        : _sameDay(widget.day, DateTime.now())
                            ? _minutes(DateTime.now())
                            : 8 * 60) /
                    60 -
                1) *
            _hourHeight),
  );

  static int _minutes(DateTime at) => at.hour * 60 + at.minute;

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  String _hourLabel(int hour) {
    final h = hour % 12 == 0 ? 12 : hour % 12;
    return '$h ${hour < 12 ? 'AM' : 'PM'}';
  }

  String _timeLabel(DateTime at) {
    final time = TimeOfDay.fromDateTime(at);
    final hour = time.hourOfPeriod == 0 ? 12 : time.hourOfPeriod;
    return '$hour:${time.minute.toString().padLeft(2, '0')} '
        '${time.period == DayPeriod.am ? 'AM' : 'PM'}';
  }

  /// (session, column, columns) for each session: overlapping ones get
  /// their own column and split the width.
  List<(RecordingSession, int, int)> _layout() {
    final items = [
      for (final s in widget.sessions)
        (
          s,
          _minutes(s.scheduledAt!),
          _minutes(s.scheduledAt!) + _sessionMinutes
        )
    ]..sort((a, b) => a.$2.compareTo(b.$2));
    final out = <(RecordingSession, int, int)>[];
    var run =
        <(RecordingSession, int, int, int)>[]; // session, start, end, column
    var runEnd = -1;
    void finish() {
      final columns = run.fold(1, (m, item) => math.max(m, item.$4 + 1));
      out.addAll([for (final item in run) (item.$1, item.$4, columns)]);
      run = [];
    }

    for (final (s, start, end) in items) {
      if (start >= runEnd) {
        finish();
        runEnd = -1;
      }
      final taken = {
        for (final o in run)
          if (o.$3 > start) o.$4
      };
      var column = 0;
      while (taken.contains(column)) {
        column++;
      }
      run.add((s, start, end, column));
      runEnd = math.max(runEnd, end);
    }
    finish();
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final today = _sameDay(widget.day, now);
    final layout = _layout();
    return RefreshIndicator(
      onRefresh: widget.onRefresh,
      child: SingleChildScrollView(
        controller: _scroll,
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(8, 12, 12, 110),
        child: SizedBox(
          height: 24 * _hourHeight,
          child: LayoutBuilder(builder: (context, constraints) {
            final width = constraints.maxWidth - _gutter;
            return Stack(
              clipBehavior: Clip.none,
              children: [
                for (var hour = 0; hour < 24; hour++)
                  Positioned(
                    top: hour * _hourHeight,
                    left: 0,
                    right: 0,
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SizedBox(
                          width: _gutter - 8,
                          child: Transform.translate(
                            offset: const Offset(0, -7),
                            child: Text(
                              hour == 0 ? '' : _hourLabel(hour),
                              textAlign: TextAlign.right,
                              style:
                                  const TextStyle(color: kMuted, fontSize: 11),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        const Expanded(
                            child:
                                Divider(height: 1, color: Color(0xFF242424))),
                      ],
                    ),
                  ),
                for (final (s, column, columns) in layout)
                  Positioned(
                    top: _minutes(s.scheduledAt!) / 60 * _hourHeight + 1,
                    height: _sessionMinutes / 60 * _hourHeight - 3,
                    left: _gutter + width * column / columns + 1,
                    width: width / columns - 3,
                    child: _block(s),
                  ),
                if (today)
                  Positioned(
                    top: _minutes(now) / 60 * _hourHeight - 1,
                    left: _gutter - 5,
                    right: 0,
                    child: IgnorePointer(
                      child: Row(children: [
                        Container(
                          width: 10,
                          height: 10,
                          decoration: const BoxDecoration(
                              color: kLiveRed, shape: BoxShape.circle),
                        ),
                        Expanded(child: Container(height: 2, color: kLiveRed)),
                      ]),
                    ),
                  ),
              ],
            );
          }),
        ),
      ),
    );
  }

  Widget _block(RecordingSession s) {
    final color = widget.colorOf(s);
    final ink = inkOn(color);
    final status = switch (s.status) {
      'active' => 'Live now',
      'complete' => 'Watch',
      'cancelled' => 'Cancelled',
      _ => null,
    };
    return Opacity(
      opacity: s.isCancelled || isPastSession(s) ? 0.5 : 1,
      child: Material(
        color: color,
        borderRadius: BorderRadius.circular(6),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: widget.onOpen(s),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(8, 5, 6, 4),
            child: widget.busyId == s.id
                ? Center(
                    child: SizedBox.square(
                      dimension: 18,
                      child:
                          CircularProgressIndicator(strokeWidth: 2, color: ink),
                    ),
                  )
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        s.isActive ? '● ${s.name}' : s.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            color: ink,
                            fontSize: 14,
                            fontWeight: FontWeight.w700),
                      ),
                      Text(
                        [
                          _timeLabel(s.scheduledAt!),
                          widget.groupNameOf(s),
                          if (status != null) status,
                        ].where((p) => p.isNotEmpty).join(' · '),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            color: ink.withValues(alpha: 0.85), fontSize: 12),
                      ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}
