import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../team_accent.dart';
import '../theme.dart';
import 'join_screen.dart';
import 'recordings_screen.dart';

/// The Sessions tab: "Live & upcoming" to join and record, "Past" to watch.
/// A session holds recordings (takes); a recording holds angles (one per
/// phone).
class SessionsTab extends StatelessWidget {
  const SessionsTab({
    super.key,
    required this.auth,
    required this.segment,
    this.refresh,
  });

  final AuthService auth;

  /// 0 shows Live & upcoming, 1 shows Past. The shell sets it when another
  /// screen sends the user here.
  final ValueNotifier<int> segment;

  /// Fires when the + menu starts or schedules a session.
  final Listenable? refresh;

  @override
  Widget build(BuildContext context) {
    final team = TeamAccent.of(context);
    return ValueListenableBuilder<int>(
      valueListenable: segment,
      builder: (context, current, _) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 24, 20, 12),
            child: Text(
              'Sessions',
              style: TextStyle(
                color: Colors.white,
                fontSize: 26,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: SegmentedButton<int>(
              segments: const [
                ButtonSegment(value: 0, label: Text('Live & upcoming')),
                ButtonSegment(value: 1, label: Text('Past')),
              ],
              selected: {current},
              showSelectedIcon: false,
              onSelectionChanged: (picked) => segment.value = picked.first,
              style: SegmentedButton.styleFrom(
                foregroundColor: Colors.white,
                selectedForegroundColor: team.ink,
                selectedBackgroundColor: team.fill,
                side: const BorderSide(color: kSurfaceLight),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: IndexedStack(
              index: current,
              children: [
                JoinScreen(auth: auth, refresh: refresh),
                RecordingsScreen(auth: auth, embedded: true),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
