import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../api/groups_api.dart';
import '../api/recordings_api.dart';
import '../auth/auth_service.dart';
import '../config.dart';
import '../theme.dart';
import 'session_screen.dart';

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

  List<RecordingSession> _sessions = [];
  int? _groupCount;
  String? _joiningId;
  int _page = 0;

  @override
  void initState() {
    super.initState();
    _load();
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
          _groupCount = (await _groups.getMyGroups()).length;
        } catch (_) {}
      }(),
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
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 110),
        children: [
          Text(
            '$_greeting, $_firstName',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 30,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            "Let's capture something great today",
            style: TextStyle(color: kMuted, fontSize: 16),
          ),
          const SizedBox(height: 24),

          if (banners.isNotEmpty) ...[
            SizedBox(
              height: 132,
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
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  for (var i = 0; i < banners.length; i++)
                    Container(
                      width: 8,
                      height: 8,
                      margin: const EdgeInsets.symmetric(horizontal: 4),
                      decoration: BoxDecoration(
                        color: i == _page ? kGold : const Color(0xFF3A3A3A),
                        shape: BoxShape.circle,
                      ),
                    ),
                ],
              ),
            ],
            const SizedBox(height: 20),
          ],

          Row(
            children: [
              Expanded(
                child: _ActionButton(
                  label: 'Watch a Recording',
                  onTap: () => ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                        content: Text('Recordings are coming soon.')),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _ActionButton(
                  label: 'Record a practice',
                  // Sessions tab, where recording starts.
                  onTap: () => widget.onSwitchTab(0),
                ),
              ),
            ],
          ),
          const SizedBox(height: 28),

          const _SectionHeader('Recent Recordings'),
          const SizedBox(height: 12),
          const _SurfaceCard(
            child: Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Text(
                'Recordings will show up here after your first synced '
                'session.',
                textAlign: TextAlign.center,
                style: TextStyle(color: kMuted, height: 1.5),
              ),
            ),
          ),
          const SizedBox(height: 20),

          _SurfaceCard(
            child: Row(
              children: [
                _Stat(
                  value: _groupCount?.toString() ?? '—',
                  label: 'Groups',
                ),
                _Stat(value: '${_sessions.length}', label: 'sessions'),
                const _Stat(value: '—', label: 'videos'),
              ],
            ),
          ),
          const SizedBox(height: 28),

          const _SectionHeader('Notifications'),
          const SizedBox(height: 12),
          const _SurfaceCard(
            child: Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Text(
                'No notifications yet.',
                textAlign: TextAlign.center,
                style: TextStyle(color: kMuted),
              ),
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

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 2),
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
      decoration: BoxDecoration(
        color: kGold,
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
                      style: const TextStyle(
                        color: Colors.black87,
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
                  style: const TextStyle(
                    color: Colors.black,
                    fontSize: 23,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  session.isActive
                      ? '$devices ${devices == 1 ? 'Device' : 'Devices'} '
                          'connected'
                      : _scheduledLabel,
                  style: const TextStyle(
                    color: Colors.black54,
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
              backgroundColor: Colors.black,
              foregroundColor: Colors.white,
              shape: const StadiumBorder(),
              padding: const EdgeInsets.symmetric(horizontal: 26, vertical: 14),
            ),
            child: joining
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
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
    return FilledButton(
      onPressed: onTap,
      style: FilledButton.styleFrom(
        backgroundColor: kGold,
        foregroundColor: Colors.black,
        shape: const StadiumBorder(),
        padding: const EdgeInsets.symmetric(vertical: 16),
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
      style: const TextStyle(
        color: kGold,
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
      padding: const EdgeInsets.all(16),
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
              fontSize: 26,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(color: kMuted, fontSize: 14)),
        ],
      ),
    );
  }
}
