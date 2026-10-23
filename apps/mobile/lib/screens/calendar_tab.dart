import 'package:flutter/material.dart';

import '../api/groups_api.dart';
import '../api/recordings_api.dart';
import '../auth/auth_service.dart';
import '../team_accent.dart';
import '../theme.dart';
import '../widgets/auto_refresh.dart';
import '../widgets/empty_state.dart';
import 'join_screen.dart';

const _weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

bool _sameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

/// Month calendar for the Calendar tab. Scheduled sessions render as chips on
/// their day cells.
class CalendarTab extends StatefulWidget {
  const CalendarTab({super.key, required this.auth});

  final AuthService auth;

  @override
  State<CalendarTab> createState() => _CalendarTabState();
}

class _CalendarTabState extends State<CalendarTab> {
  late final RecordingsApi _recordings = RecordingsApi(widget.auth.api);

  final _today = DateTime.now();
  late DateTime _cursor = DateTime(_today.year, _today.month);

  late final GroupsApi _groupsApi = GroupsApi(widget.auth.api);

  List<RecordingSession> _sessions = [];
  Map<String, Color> _groupColors = {};
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _load();
    _refresher = AutoRefresher(const Duration(seconds: 30), _load);
  }

  late final AutoRefresher _refresher;

  @override
  void dispose() {
    _refresher.dispose();
    super.dispose();
  }

  /// The grid renders regardless; a failed fetch just means no chips.
  Future<void> _load() async {
    try {
      final results = await Future.wait(
          [_recordings.getSessions(), _groupsApi.getMyGroups()]);
      final sessions = results[0] as List<RecordingSession>;
      final groups = results[1] as List<Group>;
      if (mounted) {
        setState(() {
          _sessions = sessions;
          _groupColors = {
            for (final g in groups)
              if (parseHexColor(g.primaryColor) case final color?) g.id: color,
          };
          _loaded = true;
        });
      }
    } catch (_) {}
  }

  List<RecordingSession> _sessionsOn(DateTime day) => _sessions
      .where((s) => s.scheduledAt != null && _sameDay(s.scheduledAt!, day))
      .toList();

  bool _isPast(RecordingSession s) => isPastSession(s);

  /// The session's group color; the team color for a session without one.
  Color _colorOf(RecordingSession s) =>
      _groupColors[s.groupId] ?? TeamAccent.of(context).fill;

  void _step(int delta) {
    setState(() => _cursor = DateTime(_cursor.year, _cursor.month + delta));
  }

  /// 6x7 grid padded with the neighbouring months so every month is the same
  /// height and the columns stay aligned.
  List<DateTime> _gridDays() {
    // weekday is 1=Mon..7=Sun; %7 turns it into 0=Sun..6=Sat.
    final leading = DateTime(_cursor.year, _cursor.month, 1).weekday % 7;
    return List.generate(
      42,
      (i) => DateTime(_cursor.year, _cursor.month, i - leading + 1),
    );
  }

  static const _monthNames = [
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

  /// Tapping a day opens it on its own page, like Google Calendar: that
  /// day's sessions, each one tappable to go into it.
  Future<void> _openDay(DateTime day) async {
    await Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => _DayScreen(auth: widget.auth, day: day),
    ));
    if (mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    final days = _gridDays();

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 120),
        children: [
          const Text(
            'Calendar',
            style: TextStyle(
              color: Colors.white,
              fontSize: 30,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),

          // Month + navigation, laid out like the design: title left,
          // circular prev/next buttons right.
          Row(
            children: [
              Expanded(
                child: Text(
                  '${_monthNames[_cursor.month - 1]} ${_cursor.year}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 21,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              _NavCircle(
                icon: Icons.chevron_left,
                tooltip: 'Previous month',
                onTap: () => _step(-1),
              ),
              const SizedBox(width: 10),
              _NavCircle(
                icon: Icons.chevron_right,
                tooltip: 'Next month',
                onTap: () => _step(1),
              ),
            ],
          ),
          const SizedBox(height: 16),

          // Weekday headings
          Row(
            children: [
              for (final d in _weekdays)
                Expanded(
                  child: Text(
                    d,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: kMuted,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),

          // Day grid
          Container(
            color: const Color(0xFF222222),
            padding: const EdgeInsets.symmetric(vertical: 1),
            child: GridView.count(
              crossAxisCount: 7,
              shrinkWrap: true,
              // Not the screen's safe-area padding, which showed as a gray
              // strip under the grid.
              padding: EdgeInsets.zero,
              physics: const NeverScrollableScrollPhysics(),
              // The 1 px gaps show the grid's color: thin lines between days.
              mainAxisSpacing: 1,
              crossAxisSpacing: 1,
              // Cells are taller than wide so event chips fit, per the design.
              childAspectRatio: 0.62,
              children: [
                for (final day in days) _dayCell(day),
              ],
            ),
          ),

          if (_loaded && _sessions.isEmpty) ...[
            const SizedBox(height: 16),
            const EmptyState(
              title: 'Nothing scheduled',
              message: 'Sessions your coach schedules show up on the '
                  'calendar. Pull down to refresh.',
            ),
          ],
        ],
      ),
    );
  }

  Widget _dayCell(DateTime day) {
    final inMonth = day.month == _cursor.month && day.year == _cursor.year;
    final isToday = _sameDay(day, _today);
    final events = _sessionsOn(day);

    return GestureDetector(
      onTap: () => _openDay(day),
      behavior: HitTestBehavior.opaque,
      // Open like the web's: black days with thin lines, no boxes.
      child: Container(
        padding: const EdgeInsets.all(4),
        color: Colors.black,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Today is just its number in the team color, no box.
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
              child: Text(
                '${day.day}',
                style: TextStyle(
                  color: isToday
                      ? TeamAccent.of(context).accent
                      : inMonth
                          ? Colors.white
                          : kFaint,
                  fontSize: 14,
                  fontWeight: isToday ? FontWeight.w800 : FontWeight.w500,
                ),
              ),
            ),
            const SizedBox(height: 2),
            for (final s in events.take(2))
              Builder(builder: (context) {
                // Each session in its group's color, as on the web.
                final color = _colorOf(s);
                // Past ones outlined in the group's color, not filled, so
                // they stay readable while the solid ones are what's ahead.
                final past = _isPast(s);
                return Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(bottom: 2),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                  decoration: BoxDecoration(
                    color: past ? null : color,
                    border: past
                        ? Border.all(
                            color: legibleOnDark(color).withValues(alpha: 0.55))
                        : null,
                    borderRadius: BorderRadius.circular(5),
                  ),
                  child: Text(
                    s.isActive ? '● ${s.name}' : s.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: past ? legibleOnDark(color) : inkOn(color),
                      fontSize: 9,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                );
              }),
            if (events.length > 2)
              Text(
                '+${events.length - 2}',
                style: const TextStyle(color: kMuted, fontSize: 9),
              ),
          ],
        ),
      ),
    );
  }
}

class _NavCircle extends StatelessWidget {
  const _NavCircle({
    required this.icon,
    required this.tooltip,
    required this.onTap,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFF1C1C1C),
      shape: const CircleBorder(),
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: Tooltip(
          message: tooltip,
          child: SizedBox(
            width: 40,
            height: 40,
            child: Icon(icon, color: Colors.white, size: 22),
          ),
        ),
      ),
    );
  }
}

/// Opens [day] on its own page (the calendar's day timeline), e.g. from
/// Home's This week.
Future<void> openCalendarDay(
        BuildContext context, AuthService auth, DateTime day) =>
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => _DayScreen(auth: auth, day: day),
    ));

const _dayNames = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/// One day's sessions, with arrows to the day before and after. The cards
/// are the Sessions tab's: tap one to join it, or watch it once it's over.
class _DayScreen extends StatefulWidget {
  const _DayScreen({required this.auth, required this.day});

  final AuthService auth;
  final DateTime day;

  @override
  State<_DayScreen> createState() => _DayScreenState();
}

class _DayScreenState extends State<_DayScreen> {
  late DateTime _day = widget.day;

  void _step(int delta) =>
      setState(() => _day = DateTime(_day.year, _day.month, _day.day + delta));

  @override
  Widget build(BuildContext context) {
    final today = _sameDay(_day, DateTime.now());
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${_dayNames[_day.weekday - 1]}${today ? ' · Today' : ''}',
              style: const TextStyle(color: kMuted, fontSize: 13),
            ),
            Text(
              '${_CalendarTabState._monthNames[_day.month - 1]} ${_day.day}, '
              '${_day.year}',
              style: const TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.w700),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Previous day',
            icon: const Icon(Icons.chevron_left),
            onPressed: () => _step(-1),
          ),
          IconButton(
            tooltip: 'Next day',
            icon: const Icon(Icons.chevron_right),
            onPressed: () => _step(1),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: JoinScreen(
        key: ValueKey(_day),
        auth: widget.auth,
        day: _day,
      ),
    );
  }
}
