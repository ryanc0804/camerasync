import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../api/groups_api.dart';
import '../api/recordings_api.dart';
import '../auth/auth_service.dart';
import '../team_accent.dart';
import '../theme.dart';
import '../widgets/empty_state.dart';
import 'watch_screen.dart';

/// Completed sessions, newest first, as a stack of cards (the "Recordring
/// mobile" frame in the Figma). Pass [groupId] to show one group's sessions,
/// which is how the Groups tab opens it.
class RecordingsScreen extends StatefulWidget {
  const RecordingsScreen({
    super.key,
    required this.auth,
    this.groupId,
    this.title,
  });

  final AuthService auth;
  final String? groupId;
  final String? title;

  @override
  State<RecordingsScreen> createState() => _RecordingsScreenState();
}

class _RecordingsScreenState extends State<RecordingsScreen> {
  late final RecordingsApi _recordings = RecordingsApi(widget.auth.api);
  late final GroupsApi _groups = GroupsApi(widget.auth.api);

  List<RecordingSession> _sessions = [];
  Map<String, String> _groupNames = {};

  /// Groups where this user is an admin (or the owner): they can delete
  /// those groups' sessions.
  Set<String> _adminGroups = {};
  bool _loading = true;
  String? _error;

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
      final results = await Future.wait([
        _recordings.getSessions(),
        _groups.getMyGroups().catchError((_) => <Group>[]),
      ]);
      final sessions = (results[0] as List<RecordingSession>)
          .where((s) => s.isComplete)
          .where((s) => widget.groupId == null || s.groupId == widget.groupId)
          .toList()
        ..sort((a, b) {
          final at = a.scheduledAt?.millisecondsSinceEpoch ?? 0;
          final bt = b.scheduledAt?.millisecondsSinceEpoch ?? 0;
          return bt.compareTo(at);
        });
      if (!mounted) return;
      setState(() {
        _sessions = sessions;
        _groupNames = {
          for (final g in results[1] as List<Group>) g.id: g.name,
        };
        _adminGroups = {
          for (final g in results[1] as List<Group>)
            if (g.role == 'admin') g.id,
        };
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

  Future<void> _delete(RecordingSession session) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: Text(
            "Delete ${session.name} and all its videos? This can't be undone."),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: FilledButton.styleFrom(backgroundColor: kLiveRed),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await _recordings.deleteSession(session.id);
      if (mounted) {
        setState(() => _sessions = [
              for (final s in _sessions)
                if (s.id != session.id) s,
            ]);
      }
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  void _open(RecordingSession session) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => WatchScreen(auth: widget.auth, session: session),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: kBackground,
      appBar: AppBar(
        backgroundColor: kBackground,
        foregroundColor: Colors.white,
        title: Text(
          widget.title ?? 'Recordings',
          style: TextStyle(
            color: TeamAccent.of(context).accent,
            fontWeight: FontWeight.w800,
            letterSpacing: -0.3,
          ),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
                children: [
                  if (_error != null)
                    EmptyState(
                      title: "Couldn't load recordings",
                      message: _error!,
                      actionLabel: 'Retry',
                      onAction: _load,
                    )
                  else if (_sessions.isEmpty)
                    EmptyState(
                      title: 'No recordings yet',
                      message: widget.groupId == null
                          ? 'Completed sessions from your groups show up '
                              'here. Join a session and record to make the '
                              'first one.'
                          : 'This group has no completed sessions yet.',
                    )
                  else
                    for (final s in _sessions)
                      RecordingCard(
                        session: s,
                        groupName: _groupNames[s.groupId],
                        onTap: () => _open(s),
                        onDelete: _adminGroups.contains(s.groupId)
                            ? () => _delete(s)
                            : null,
                      ),
                ],
              ),
      ),
    );
  }
}

/// One session in the list. The design shows a plain grey block for each
/// recording; the block becomes the poster frame once thumbnails exist.
class RecordingCard extends StatelessWidget {
  const RecordingCard({
    super.key,
    required this.session,
    required this.onTap,
    this.groupName,
    this.onDelete,
  });

  final RecordingSession session;
  final String? groupName;
  final VoidCallback onTap;

  /// Shown as a delete button for group admins and the owner.
  final VoidCallback? onDelete;

  static const _panel = Color(0xFF49454F);

  @override
  Widget build(BuildContext context) {
    final at = session.scheduledAt;
    final date = at == null ? '' : '${at.month}/${at.day}/${at.year}';
    final count = session.totalRecordings;
    final parts = [
      if (groupName != null) groupName!,
      if (date.isNotEmpty) date,
      if (count != null) '$count ${count == 1 ? 'recording' : 'recordings'}',
    ];

    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Material(
        color: _panel,
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(6),
          child: SizedBox(
            height: 120,
            child: Stack(
              children: [
                if (onDelete != null)
                  Positioned(
                    top: 4,
                    right: 4,
                    child: IconButton(
                      onPressed: onDelete,
                      tooltip: 'Delete ${session.name}',
                      icon: const Icon(Icons.delete_outline, color: kLiveRed),
                    ),
                  ),
                Positioned.fill(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        Text(
                          session.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        if (parts.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(
                            parts.join('  ·  '),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Color(0xFFCFCBD6),
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
