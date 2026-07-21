import 'package:flutter/material.dart';

const _kGold = Color(0xFFF2CB05);
const _kMuted = Color(0xFF8A8A8A);

const _weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

bool _sameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

/// Month calendar for the Calendar tab. Sessions will render on the day cells
/// once the sessions API exists.
class CalendarTab extends StatefulWidget {
  const CalendarTab({super.key});

  @override
  State<CalendarTab> createState() => _CalendarTabState();
}

class _CalendarTabState extends State<CalendarTab> {
  final _today = DateTime.now();
  late DateTime _cursor = DateTime(_today.year, _today.month);
  DateTime? _selected;

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

  @override
  Widget build(BuildContext context) {
    final days = _gridDays();

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 120),
      children: [
        const Text(
          'Calendar',
          style: TextStyle(
            color: Colors.white,
            fontSize: 22,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 16),

        // Month navigation
        Row(
          children: [
            IconButton(
              onPressed: () => _step(-1),
              icon: const Icon(Icons.chevron_left),
              color: Colors.white,
              tooltip: 'Previous month',
            ),
            Expanded(
              child: Text(
                '${_monthNames[_cursor.month - 1]} ${_cursor.year}',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 17,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            IconButton(
              onPressed: () => _step(1),
              icon: const Icon(Icons.chevron_right),
              color: Colors.white,
              tooltip: 'Next month',
            ),
          ],
        ),
        const SizedBox(height: 4),

        // Weekday headings
        Row(
          children: [
            for (final d in _weekdays)
              Expanded(
                child: Text(
                  d,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: _kMuted,
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
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
          children: [
            for (final day in days) _dayCell(day),
          ],
        ),

        if (_selected != null) ...[
          const SizedBox(height: 20),
          Text(
            '${_monthNames[_selected!.month - 1]} ${_selected!.day}, '
            '${_selected!.year}',
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'No sessions scheduled.',
            style: TextStyle(color: _kMuted),
          ),
        ],
      ],
    );
  }

  Widget _dayCell(DateTime day) {
    final inMonth = day.month == _cursor.month && day.year == _cursor.year;
    final isToday = _sameDay(day, _today);
    final isSelected = _selected != null && _sameDay(day, _selected!);

    return GestureDetector(
      onTap: () => setState(() => _selected = day),
      behavior: HitTestBehavior.opaque,
      child: Center(
        child: Container(
          width: 38,
          height: 38,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: isSelected ? _kGold : Colors.transparent,
            shape: BoxShape.circle,
            border: isToday && !isSelected
                ? Border.all(color: _kGold, width: 1.5)
                : null,
          ),
          child: Text(
            '${day.day}',
            style: TextStyle(
              color: isSelected
                  ? const Color(0xFF0D0D0D)
                  : !inMonth
                      ? const Color(0xFF4A4A4A)
                      : isToday
                          ? _kGold
                          : Colors.white,
              fontWeight:
                  isSelected || isToday ? FontWeight.bold : FontWeight.normal,
            ),
          ),
        ),
      ),
    );
  }
}
