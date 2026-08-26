import 'package:flutter/material.dart';

import '../api/recordings_api.dart';
import '../auth/auth_service.dart';
import '../theme.dart';

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

  List<RecordingSession> _sessions = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  /// The grid renders regardless; a failed fetch just means no chips.
  Future<void> _load() async {
    try {
      final sessions = await _recordings.getSessions();
      if (mounted) setState(() => _sessions = sessions);
    } catch (_) {}
  }

  List<RecordingSession> _sessionsOn(DateTime day) => _sessions
      .where((s) => s.scheduledAt != null && _sameDay(s.scheduledAt!, day))
      .toList();

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
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  /// Tapping a day with sessions opens them in a sheet; empty days do nothing.
  void _showDay(DateTime day, List<RecordingSession> events) {
    if (events.isEmpty) return;

    showModalBottomSheet<void>(
      context: context,
      backgroundColor: kSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 20, 24, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${_monthNames[day.month - 1]} ${day.day}, ${day.year}',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 14),
              for (final s in events)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Row(
                    children: [
                      Container(
                        width: 10,
                        height: 10,
                        decoration: BoxDecoration(
                          color: s.isActive ? kLiveRed : kGold,
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          s.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      Text(
                        s.isActive ? 'Live now' : _timeLabel(s.scheduledAt),
                        style: TextStyle(
                          color: s.isActive ? kLiveRed : kMuted,
                          fontSize: 13,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  String _timeLabel(DateTime? at) {
    if (at == null) return '';
    final time = TimeOfDay.fromDateTime(at);
    return '${time.hourOfPeriod == 0 ? 12 : time.hourOfPeriod}:'
        '${time.minute.toString().padLeft(2, '0')} '
        '${time.period == DayPeriod.am ? 'AM' : 'PM'}';
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
          GridView.count(
            crossAxisCount: 7,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 3,
            crossAxisSpacing: 3,
            // Cells are taller than wide so event chips fit, per the design.
            childAspectRatio: 0.62,
            children: [
              for (final day in days) _dayCell(day),
            ],
          ),
        ],
      ),
    );
  }

  Widget _dayCell(DateTime day) {
    final inMonth = day.month == _cursor.month && day.year == _cursor.year;
    final isToday = _sameDay(day, _today);
    final events = _sessionsOn(day);

    return GestureDetector(
      onTap: () => _showDay(day, events),
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(
          color: const Color(0xFF121212),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Today gets the yellow rounded square behind its number.
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
              decoration: isToday
                  ? BoxDecoration(
                      color: kGold,
                      borderRadius: BorderRadius.circular(6),
                    )
                  : null,
              child: Text(
                '${day.day}',
                style: TextStyle(
                  color: isToday
                      ? Colors.black
                      : inMonth
                          ? Colors.white
                          : kFaint,
                  fontSize: 14,
                  fontWeight:
                      isToday ? FontWeight.bold : FontWeight.w500,
                ),
              ),
            ),
            const SizedBox(height: 2),
            for (final s in events.take(2))
              Container(
                width: double.infinity,
                margin: const EdgeInsets.only(bottom: 2),
                padding:
                    const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                decoration: BoxDecoration(
                  color: s.isActive ? kLiveRed : kGold,
                  borderRadius: BorderRadius.circular(5),
                ),
                child: Text(
                  s.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: s.isActive ? Colors.white : Colors.black,
                    fontSize: 9,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
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
