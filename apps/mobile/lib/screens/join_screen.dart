import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../api/recordings_api.dart';
import '../auth/auth_service.dart';
import '../config.dart';
import 'session_screen.dart';

/// Record tab: pick one of your groups' sessions to join, then hand off to
/// the recording view.
class JoinScreen extends StatefulWidget {
  const JoinScreen({super.key, required this.auth});

  final AuthService auth;

  @override
  State<JoinScreen> createState() => _JoinScreenState();
}

class _JoinScreenState extends State<JoinScreen> {
  late final RecordingsApi _recordings = RecordingsApi(widget.auth.api);

  List<RecordingSession> _sessions = [];
  bool _loading = true;
  String? _error;
  String? _joiningId;

  @override
  void initState() {
    super.initState();
    _loadSessions();
  }

  Future<void> _loadSessions() async {
    setState(() {
      _loading = _sessions.isEmpty;
      _error = null;
    });

    try {
      final sessions = await _recordings.getSessions();
      if (!mounted) return;
      setState(() {
        // Completed/cancelled sessions belong to review, not the Record tab.
        _sessions = sessions
            .where((s) => s.isActive || s.isScheduled)
            .toList();
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Unable to load sessions.';
        _loading = false;
      });
    }
  }

  Future<void> _join(RecordingSession session) async {
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

      if (mounted) _loadSessions();
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
    return RefreshIndicator(
      onRefresh: _loadSessions,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 24, 20, 110),
        children: [
          const Text(
            'Sessions',
            style: TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Join a session to record in sync with the other devices. The '
            'admin starts and stops everyone at once.',
            style: TextStyle(color: Color(0xFF8A8A8A), height: 1.5),
          ),
          const SizedBox(height: 24),
          if (_loading)
            const Padding(
              padding: EdgeInsets.only(top: 48),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_error != null)
            _Notice(
              message: _error!,
              actionLabel: 'Retry',
              onAction: _loadSessions,
            )
          else if (_sessions.isEmpty)
            const _Notice(
              message: 'No upcoming sessions. Schedule one from the web '
                  'dashboard, or pull down to refresh.',
            )
          else
            ..._sessions.map(
              (s) => _SessionCard(
                session: s,
                joining: _joiningId == s.id,
                onJoin: _joiningId == null ? () => _join(s) : null,
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
    required this.joining,
    this.onJoin,
  });

  final RecordingSession session;
  final bool joining;
  final VoidCallback? onJoin;

  String get _subtitle {
    if (session.isActive) {
      final devices = session.activeMemberCount;
      return 'Live now · $devices ${devices == 1 ? 'device' : 'devices'}';
    }
    final at = session.scheduledAt;
    if (at == null) return 'Scheduled';
    final time = TimeOfDay.fromDateTime(at);
    return 'Scheduled · ${at.month}/${at.day} at '
        '${time.hourOfPeriod == 0 ? 12 : time.hourOfPeriod}:'
        '${time.minute.toString().padLeft(2, '0')} '
        '${time.period == DayPeriod.am ? 'AM' : 'PM'}';
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      color: const Color(0xFF1C1C1C),
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        title: Text(
          session.name,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w600,
          ),
        ),
        subtitle: Text(
          _subtitle,
          style: TextStyle(
            color: session.isActive
                ? const Color(0xFFF2CB05)
                : const Color(0xFF8A8A8A),
          ),
        ),
        trailing: joining
            ? const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : FilledButton(
                onPressed: onJoin,
                child: Text(session.isJoined ? 'Rejoin' : 'Join'),
              ),
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.message, this.actionLabel, this.onAction});

  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 32),
      child: Column(
        children: [
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Color(0xFF8A8A8A), height: 1.5),
          ),
          if (actionLabel != null) ...[
            const SizedBox(height: 16),
            OutlinedButton(onPressed: onAction, child: Text(actionLabel!)),
          ],
        ],
      ),
    );
  }
}
