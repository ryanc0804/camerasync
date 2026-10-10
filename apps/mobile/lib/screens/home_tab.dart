import 'dart:async';

import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../api/groups_api.dart';
import '../api/notifications_api.dart';
import '../api/recordings_api.dart';
import '../auth/auth_service.dart';
import '../config.dart';
import '../team_accent.dart';
import '../theme.dart';
import '../widgets/empty_state.dart';
import 'notifications_screen.dart';
import 'recordings_screen.dart';
import 'session_screen.dart';
import 'watch_screen.dart';

/// Home dashboard: greeting, live-session carousel, quick actions, recent
/// recordings, stats and notifications.
///
/// Recordings and notifications have no API yet, so those cards render empty
/// states until the endpoints exist.
class HomeTab extends StatefulWidget {
  const HomeTab({super.key, required this.auth, required this.onSwitchTab});

  final AuthService auth;

  /// Lets the quick-action buttons jump to another tab in the shell.
  final ValueChanged<int> onSwitchTab;

  @override
  State<HomeTab> createState() => _HomeTabState();
}

class _HomeTabState extends State<HomeTab> {
  late final RecordingsApi _recordings = RecordingsApi(widget.auth.api);
  late final GroupsApi _groups = GroupsApi(widget.auth.api);
  late final NotificationsApi _notificationsApi =
      NotificationsApi(widget.auth.api);

  List<RecordingSession> _sessions = [];
  List<Group>? _myGroups;
  int? get _groupCount => _myGroups?.length;
  int? _videoCount;
  String? _joiningId;
  int _page = 0;
  List<AppNotification>? _notifications;
  Timer? _notificationTimer;

  /// Home shows the newest few; View all has the rest.
  static const _notificationsOnHome = 3;

  @override
  void initState() {
    super.initState();
    _load();
    _notificationTimer =
        Timer.periodic(const Duration(seconds: 30), (_) => _loadNotifications());
  }

  @override
  void dispose() {
    _notificationTimer?.cancel();
    super.dispose();
  }

  /// Showing them here counts as seeing them; they stay highlighted until the
  /// next load, like the web dashboard.
  Future<void> _loadNotifications() async {
    try {
      final items =
          await _notificationsApi.getNotifications(limit: _notificationsOnHome);
      if (!mounted) return;
      setState(() => _notifications = items);
      if (items.any((n) => n.unread)) {
        _notificationsApi.markSeen().catchError((_) {});
      }
    } catch (_) {
      if (mounted) setState(() => _notifications ??= const []);
    }
  }

  void _openNotifications() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => NotificationsScreen(
          auth: widget.auth,
          onOpenRecord: () => widget.onSwitchTab(1),
        ),
      ),
    );
  }

  /// The dashboard renders fine with whatever loads; a dead server just
  /// leaves the counts and carousel empty.
  Future<void> _load() async {
    await Future.wait([
      () async {
        try {
          _sessions = await _recordings.getSessions();
        } catch (_) {}
      }(),
      () async {
        try {
          _myGroups = await _groups.getMyGroups();
        } catch (_) {}
      }(),
      () async {
        try {
          _videoCount = await _recordings.getMyVideoCount();
        } catch (_) {}
      }(),
      _loadNotifications(),
    ]);
    if (mounted) setState(() {});
  }

  String get _greeting {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  String get _firstName {
    final name = widget.auth.user?.displayName ?? '';
    return name.split(RegExp(r'[\s@]')).first;
  }

  /// Newest completed sessions, for the Recent Recordings panel.
  List<RecordingSession> get _recentRecordings {
    final done = _sessions.where((s) => s.isComplete).toList()
      ..sort((a, b) {
        final at = a.scheduledAt?.millisecondsSinceEpoch ?? 0;
        final bt = b.scheduledAt?.millisecondsSinceEpoch ?? 0;
        return bt.compareTo(at);
      });
    return done.take(10).toList();
  }

  void _openRecordings({Group? group}) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => RecordingsScreen(
          auth: widget.auth,
          groupId: group?.id,
          title: group?.name,
        ),
      ),
    );
  }

  String? _groupName(String? id) {
    for (final g in _myGroups ?? const <Group>[]) {
      if (g.id == id) return g.name;
    }
    return null;
  }

  void _watch(RecordingSession session) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => WatchScreen(auth: widget.auth, session: session),
      ),
    );
  }

  /// Active sessions first, then upcoming ones, for the banner carousel.
  List<RecordingSession> get _bannerSessions => [
        ..._sessions.where((s) => s.isActive),
        ..._sessions.where((s) => s.isScheduled),
      ];

  Future<void> _join(RecordingSession session) async {
    if (_joiningId != null) return;
    setState(() => _joiningId = session.id);

    try {
      // REST join first: it records membership (and activates a scheduled
      // session), which the socket room checks before letting us in.
      final joined = await _recordings.joinSession(session.id);
      if (!mounted) return;

      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => SessionScreen(
            serverUrl: kServerUrl,
            auth: widget.auth,
            sessionId: joined.id,
            sessionName: joined.name,
          ),
        ),
      );

      if (mounted) _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _joiningId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final banners = _bannerSessions;

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 110),
        children: [
          Text(
            '$_greeting, $_firstName',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 26,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            "Let's capture something great today",
            style: TextStyle(color: kMuted, fontSize: 14),
          ),
          const SizedBox(height: 14),

          if (banners.isNotEmpty) ...[
            SizedBox(
              height: 108,
              child: PageView.builder(
                itemCount: banners.length,
                onPageChanged: (i) => setState(() => _page = i),
                itemBuilder: (context, i) => _SessionBanner(
                  session: banners[i],
                  joining: _joiningId == banners[i].id,
                  onJoin: () => _join(banners[i]),
                ),
              ),
            ),
            if (banners.length > 1) ...[
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  for (var i = 0; i < banners.length; i++)
                    Container(
                      width: 6,
                      height: 6,
                      margin: const EdgeInsets.symmetric(horizontal: 3),
                      decoration: BoxDecoration(
                        color: i == _page
                            ? TeamAccent.of(context).accent
                            : const Color(0xFF3A3A3A),
                        shape: BoxShape.circle,
                      ),
                    ),
                ],
              ),
            ],
            const SizedBox(height: 14),
          ],

          Row(
            children: [
              Expanded(
                child: _ActionButton(
                  label: 'Watch a Recording',
                  onTap: _openRecordings,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _ActionButton(
                  label: 'Record a practice',
                  // Sessions tab (index 1), where recording starts.
                  onTap: () => widget.onSwitchTab(1),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),

          _SurfaceCard(
            child: Row(
              children: [
                _Stat(
                  value: _groupCount?.toString() ?? '—',
                  label: 'Groups',
                ),
                _Stat(value: '${_sessions.length}', label: 'sessions'),
                _Stat(value: _videoCount?.toString() ?? '—', label: 'videos'),
              ],
            ),
          ),
          const SizedBox(height: 18),

          _HeaderRow(
            title: 'Recent Recordings',
            onViewAll:
                _recentRecordings.isEmpty ? null : () => _openRecordings(),
          ),
          const SizedBox(height: 8),
          if (_recentRecordings.isEmpty)
            EmptyState(
              title: 'No recordings yet',
              message: _groupCount == 0
                  ? 'Join a group first. Recordings from its sessions will '
                      'show up here.'
                  : 'Join a session and record. Your clips will show up here '
                      'once they upload.',
              actionLabel: _groupCount == 0 ? null : 'Find a session',
              onAction: () => widget.onSwitchTab(1),
            )
          else
            // A sideways row, like the design; View all opens the full list.
            _SurfaceCard(
              child: SizedBox(
                height: 104,
                // Tiles sized so the next one always peeks in at the edge,
                // which shows the row scrolls sideways.
                child: LayoutBuilder(builder: (context, constraints) {
                  final tileWidth = (constraints.maxWidth - 24) / 2.6;
                  return ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: _recentRecordings.length,
                    separatorBuilder: (_, __) => const SizedBox(width: 12),
                    itemBuilder: (context, i) {
                      final s = _recentRecordings[i];
                      return _RecordingTile(
                        width: tileWidth,
                        session: s,
                        groupName: _groupName(s.groupId),
                        onTap: () => _watch(s),
                      );
                    },
                  );
                }),
              ),
            ),
          const SizedBox(height: 18),

          _HeaderRow(
            title: 'Notifications',
            onViewAll: (_notifications?.isEmpty ?? true)
                ? null
                : _openNotifications,
          ),
          const SizedBox(height: 8),
          _SurfaceCard(
            child: (_notifications?.isEmpty ?? true)
                ? Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(
                      _notifications == null ? 'Loading…' : 'Nothing new yet.',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: kMuted),
                    ),
                  )
                : Column(
                    children: [
                      for (final n in _notifications!)
                        NotificationTile(
                          notification: n,
                          onTap: () => openNotification(
                            context,
                            widget.auth,
                            n,
                            onOpenRecord: () => widget.onSwitchTab(1),
                          ),
                        ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

/// Yellow hero card for a live or upcoming session.
class _SessionBanner extends StatelessWidget {
  const _SessionBanner({
    required this.session,
    required this.joining,
    required this.onJoin,
  });

  final RecordingSession session;
  final bool joining;
  final VoidCallback onJoin;

  @override
  Widget build(BuildContext context) {
    final devices = session.activeMemberCount;
    final team = TeamAccent.of(context);
    final ink = team.ink;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 2),
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      decoration: BoxDecoration(
        color: team.fill,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Row(
                  children: [
                    if (session.isActive) ...[
                      Container(
                        width: 8,
                        height: 8,
                        decoration: const BoxDecoration(
                          color: kLiveRed,
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 6),
                    ],
                    Text(
                      session.isActive ? 'Live now' : 'Upcoming',
                      style: TextStyle(
                        color: ink.withValues(alpha: 0.87),
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  session.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: ink,
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  session.isActive
                      ? '$devices ${devices == 1 ? 'Device' : 'Devices'} '
                          'connected'
                      : _scheduledLabel,
                  style: TextStyle(
                    color: ink.withValues(alpha: 0.6),
                    fontSize: 15,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          FilledButton(
            onPressed: joining ? null : onJoin,
            style: FilledButton.styleFrom(
              backgroundColor: ink,
              foregroundColor: team.fill,
              shape: const StadiumBorder(),
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 10),
            ),
            child: joining
                ? SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: team.fill,
                    ),
                  )
                : const Text(
                    'Join',
                    style: TextStyle(fontWeight: FontWeight.bold),
                  ),
          ),
        ],
      ),
    );
  }

  String get _scheduledLabel {
    final at = session.scheduledAt;
    if (at == null) return 'Scheduled';
    final time = TimeOfDay.fromDateTime(at);
    return 'Scheduled · ${at.month}/${at.day} at '
        '${time.hourOfPeriod == 0 ? 12 : time.hourOfPeriod}:'
        '${time.minute.toString().padLeft(2, '0')} '
        '${time.period == DayPeriod.am ? 'AM' : 'PM'}';
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final team = TeamAccent.of(context);
    return FilledButton(
      onPressed: onTap,
      style: FilledButton.styleFrom(
        backgroundColor: team.fill,
        foregroundColor: team.ink,
        shape: const StadiumBorder(),
        padding: const EdgeInsets.symmetric(vertical: 12),
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.title);

  final String title;

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: TextStyle(
        color: TeamAccent.of(context).accent,
        fontSize: 18,
        fontWeight: FontWeight.w700,
      ),
    );
  }
}

class _SurfaceCard extends StatelessWidget {
  const _SurfaceCard({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: kSurface,
        borderRadius: BorderRadius.circular(20),
      ),
      child: child,
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Text(
            value,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.w800,
            ),
          ),
          Text(label, style: const TextStyle(color: kMuted, fontSize: 12)),
        ],
      ),
    );
  }
}

/// A section title with an optional "View all" link on the right.
class _HeaderRow extends StatelessWidget {
  const _HeaderRow({required this.title, this.onViewAll});

  final String title;
  final VoidCallback? onViewAll;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(child: _SectionHeader(title)),
        if (onViewAll != null)
          TextButton(
            onPressed: onViewAll,
            style: TextButton.styleFrom(
              foregroundColor: TeamAccent.of(context).accent,
              padding: EdgeInsets.zero,
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text('View all'),
          ),
      ],
    );
  }
}

/// One recording in the sideways row: a square thumbnail spot (a play mark
/// until thumbnails exist) with the session's name and group under it.
class _RecordingTile extends StatelessWidget {
  const _RecordingTile({
    required this.session,
    required this.onTap,
    required this.width,
    this.groupName,
  });

  final RecordingSession session;
  final String? groupName;
  final VoidCallback onTap;
  final double width;

  @override
  Widget build(BuildContext context) {
    final team = TeamAccent.of(context);
    return SizedBox(
      width: width,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              height: 62,
              decoration: BoxDecoration(
                color: kSurfaceLight,
                borderRadius: BorderRadius.circular(12),
              ),
              alignment: Alignment.center,
              child: Icon(Icons.play_circle_fill, color: team.accent, size: 30),
            ),
            const SizedBox(height: 6),
            Text(
              session.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                  color: Colors.white,
                  fontSize: 13,
                  fontWeight: FontWeight.w600),
            ),
            if (groupName != null)
              Text(
                groupName!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: kMuted, fontSize: 11),
              ),
          ],
        ),
      ),
    );
  }
}
