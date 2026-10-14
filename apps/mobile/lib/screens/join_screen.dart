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
  const JoinScreen({super.key, required this.auth, this.refresh});

  final AuthService auth;

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
        // Finished and cancelled sessions are under Past.
        _sessions = _sorted([
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

  @override
  Widget build(BuildContext context) {
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
                onWatch: () => Navigator.of(context).push(
                  MaterialPageRoute(
                      builder: (_) =>
                          WatchScreen(auth: widget.auth, session: s)),
                ),
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
  });

  final RecordingSession session;
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
      if (s.isComplete)
        TextButton(
          onPressed: onWatch,
          style: TextButton.styleFrom(foregroundColor: team.accent),
          child: const Text('Watch'),
        ),
    ];

    return Opacity(
      opacity: s.isCancelled ? 0.5 : 1,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.fromLTRB(16, 14, 12, 12),
        decoration: BoxDecoration(
          color: const Color(0xFF1C1C1C),
          borderRadius: BorderRadius.circular(14),
          border:
              s.isActive ? Border.all(color: team.accent, width: 1.5) : null,
        ),
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
                            style:
                                const TextStyle(color: kMuted, fontSize: 13)),
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
                        fontWeight:
                            s.isActive ? FontWeight.w700 : FontWeight.w500,
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
                if (open) '$count ${s.isActive ? 'in session' : 'joined'}',
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
    );
  }
}
