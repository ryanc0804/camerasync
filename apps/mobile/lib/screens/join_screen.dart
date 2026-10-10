import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../api/groups_api.dart';
import '../api/recordings_api.dart';
import '../auth/auth_service.dart';
import '../config.dart';
import '../team_accent.dart';
import '../theme.dart';
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

/// Record tab, laid out like the web app's Record page: admins can schedule
/// or start a session; everyone sees their groups' sessions and can join
/// one to record. A session's host and the group's admins can end or cancel
/// it.
class JoinScreen extends StatefulWidget {
  const JoinScreen({super.key, required this.auth});

  final AuthService auth;

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

  List<Group> get _adminGroups => [
        for (final g in _groups)
          if (g.role == 'admin') g
      ];

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
    _load();
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
        _sessions = _sorted(results[0] as List<RecordingSession>);
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

  Future<void> _schedule({required bool live}) async {
    final created = await showModalBottomSheet<RecordingSession>(
      context: context,
      isScrollControlled: true,
      backgroundColor: kSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => _NewSessionSheet(
        groups: _adminGroups,
        live: live,
        recordings: _recordings,
      ),
    );
    if (created == null || !mounted) return;
    await _load();
    if (live && mounted) {
      // Starting a session makes you its host: straight into the room.
      await _join(created);
    } else {
      _toast('Scheduled ${created.name}');
    }
  }

  /// Joins any live session by its 6-character code: how people get into a
  /// session that has no group.
  Future<void> _joinWithCode() async {
    final controller = TextEditingController();
    final code = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: kSurface,
        title: const Text('Join with a code'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 6,
          textCapitalization: TextCapitalization.none,
          decoration: const InputDecoration(hintText: 'abc123'),
          onSubmitted: (value) => Navigator.of(context).pop(value),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.of(context).pop(controller.text),
              child: const Text('Join')),
        ],
      ),
    );
    controller.dispose();
    final id = code?.trim().toLowerCase() ?? '';
    if (id.isEmpty || !mounted) return;
    try {
      final session = await _recordings.joinSession(id);
      if (!mounted) return;
      await _openSession(session);
    } on ApiException catch (e) {
      _toast(e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final team = TeamAccent.of(context);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 24, 20, 110),
        children: [
          const Text(
            'Record',
            style: TextStyle(
                color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 6),
          const Text(
            'Join a session to record in sync with the other devices. The host '
            'starts and stops everyone at once.',
            style: TextStyle(color: kMuted, height: 1.5),
          ),
          const SizedBox(height: 18),
          Row(
            children: [
              if (_adminGroups.isNotEmpty) ...[
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => _schedule(live: false),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: team.accent,
                      side: BorderSide(color: team.accent),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                    child: const Text('Schedule Session'),
                  ),
                ),
                const SizedBox(width: 10),
              ],
              Expanded(
                child: FilledButton(
                  onPressed: () => _schedule(live: true),
                  style: FilledButton.styleFrom(
                    backgroundColor: team.fill,
                    foregroundColor: team.ink,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  child: const Text('Create Session'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: _joinWithCode,
            icon: const Icon(Icons.pin_outlined, size: 18),
            label: const Text('Join with a code'),
            style: OutlinedButton.styleFrom(
              foregroundColor: Colors.white,
              side: const BorderSide(color: kSurfaceLight),
              padding: const EdgeInsets.symmetric(vertical: 12),
            ),
          ),
          const SizedBox(height: 24),
          const Text(
            'Sessions',
            style: TextStyle(
                color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 12),
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
              title: 'No sessions yet',
              message: 'When a coach schedules or starts a session for one '
                  'of your groups, it shows up here. Pull down to refresh.',
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

/// Schedule a session for later, or start one now ([live]). Pops with the
/// created session.
class _NewSessionSheet extends StatefulWidget {
  const _NewSessionSheet(
      {required this.groups, required this.live, required this.recordings});

  final List<Group> groups;
  final bool live;
  final RecordingsApi recordings;

  @override
  State<_NewSessionSheet> createState() => _NewSessionSheetState();
}

class _NewSessionSheetState extends State<_NewSessionSheet> {
  final _name = TextEditingController();
  // '' means no group, which only a live session can have.
  late String _groupId =
      widget.groups.isEmpty ? '' : widget.groups.first.id;
  late DateTime _when = DateTime.now()
      .add(const Duration(hours: 1))
      .copyWith(minute: 0, second: 0, millisecond: 0, microsecond: 0);
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final date = await showDatePicker(
      context: context,
      initialDate: _when,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (date != null) {
      setState(() => _when =
          DateTime(date.year, date.month, date.day, _when.hour, _when.minute));
    }
  }

  Future<void> _pickTime() async {
    final time = await showTimePicker(
        context: context, initialTime: TimeOfDay.fromDateTime(_when));
    if (time != null) {
      setState(() => _when =
          DateTime(_when.year, _when.month, _when.day, time.hour, time.minute));
    }
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Give the session a name.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final session = widget.live
          ? await widget.recordings.createLiveSession(
              groupId: _groupId.isEmpty ? null : _groupId, name: name)
          : await widget.recordings.scheduleSession(
              groupId: _groupId, name: name, scheduledAt: _when);
      if (mounted) Navigator.of(context).pop(session);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _saving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final team = TeamAccent.of(context);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(
            20, 18, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              widget.live ? 'Start a session now' : 'Schedule a session',
              style: const TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _groupId,
              decoration: const InputDecoration(labelText: 'Group'),
              dropdownColor: kSurfaceLight,
              items: [
                for (final g in widget.groups)
                  DropdownMenuItem(value: g.id, child: Text(g.name)),
                if (widget.live)
                  const DropdownMenuItem(
                      value: '', child: Text('No group (share the code)')),
              ],
              onChanged: _saving
                  ? null
                  : (id) => setState(() => _groupId = id ?? _groupId),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _name,
              enabled: !_saving,
              autofocus: true,
              maxLength: 100,
              decoration: const InputDecoration(
                  labelText: 'Session name', counterText: ''),
            ),
            if (!widget.live) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _saving ? null : _pickDate,
                      icon: const Icon(Icons.calendar_today, size: 18),
                      label: Text(
                          '${_monthNames[_when.month - 1].substring(0, 3)} ${_when.day}'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _saving ? null : _pickTime,
                      icon: const Icon(Icons.schedule, size: 18),
                      label:
                          Text(TimeOfDay.fromDateTime(_when).format(context)),
                    ),
                  ),
                ],
              ),
            ],
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Text(_error!, style: const TextStyle(color: kLiveRed)),
              ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _saving ? null : _save,
              style: FilledButton.styleFrom(
                backgroundColor: team.fill,
                foregroundColor: team.ink,
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              child: Text(_saving
                  ? 'Saving…'
                  : widget.live
                      ? 'Start session'
                      : 'Schedule'),
            ),
          ],
        ),
      ),
    );
  }
}
