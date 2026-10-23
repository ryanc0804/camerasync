import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../team_accent.dart';
import '../theme.dart';
import '../notifications/phone_alerts.dart';
import '../sessions/new_session.dart';
import '../tv/tv_link.dart';
import '../api/recordings_api.dart';
import '../outbox/upload_queue.dart';
import 'calendar_tab.dart';
import 'groups_screen.dart';
import 'home_tab.dart';
import 'sessions_tab.dart';
import 'settings_tab.dart';
import 'watch_screen.dart' show isBigScreen;

// Older imports pull the palette from this file; keep that working.
export '../theme.dart';

/// App shell after sign-in: a dark content area with the floating yellow pill
/// navigation from the design. Tabs keep their state via IndexedStack.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.auth});

  final AuthService auth;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

/// Bar slots. The middle one is the + button, not a tab.
const _home = 0, _groups = 1, _plus = 2, _sessions = 3, _calendar = 4;

class _HomeShellState extends State<HomeShell> {
  int _index = _home;

  /// Which half of the Sessions tab shows: 0 live & upcoming, 1 past.
  final _sessionsSegment = ValueNotifier<int>(1);

  /// Ticks when the + menu starts or schedules a session.
  final _sessionsChanged = ValueNotifier<int>(0);

  /// Phone notifications for activity in the user's groups, while signed in.
  late final PhoneAlerts _alerts = PhoneAlerts(widget.auth);

  @override
  void initState() {
    super.initState();
    _alerts.start().catchError((_) {});
    // Takes still waiting from last time carry on uploading.
    final queue =
        UploadQueue.instance ??= UploadQueue(RecordingsApi(widget.auth.api));
    unawaited(queue.start());
    // TV mode: a TV plugged in gets the app's TV screen (see TvLink).
    TvLink.instance.start();
  }

  @override
  void dispose() {
    _alerts.stop();
    _sessionsSegment.dispose();
    _sessionsChanged.dispose();
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Running on the big screen itself (DeX) already shows the full grid.
    TvLink.instance.suppressed = isBigScreen(MediaQuery.sizeOf(context));
  }

  void _openSessions({required bool upcoming}) {
    _sessionsSegment.value = upcoming ? 0 : 1;
    setState(() => _index = _sessions);
  }

  Future<void> _newSession() async {
    final changed = await showNewSessionMenu(context, widget.auth);
    if (changed) _sessionsChanged.value++;
  }

  void _openSettings() {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (context) => Scaffold(
        backgroundColor: kBackground,
        appBar: AppBar(
          backgroundColor: kBackground,
          foregroundColor: Colors.white,
          title: const Text('Settings'),
        ),
        body: SettingsTab(auth: widget.auth, alerts: _alerts),
      ),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final tabs = [
      HomeTab(
        key: const ValueKey('home-tab'),
        auth: widget.auth,
        onOpenSessions: _openSessions,
        onOpenSettings: _openSettings,
        onOpenGroups: () => setState(() => _index = _groups),
        onOpenCalendar: () => setState(() => _index = _calendar),
      ),
      GroupsScreen(auth: widget.auth),
      const SizedBox.shrink(), // the + button's slot
      SessionsTab(
        auth: widget.auth,
        segment: _sessionsSegment,
        refresh: _sessionsChanged,
      ),
      CalendarTab(auth: widget.auth),
    ];

    return Scaffold(
      backgroundColor: kBackground,
      // extendBody lets the content run beneath the floating nav bar.
      extendBody: true,
      body: SafeArea(
        bottom: false,
        child: IndexedStack(index: _index, children: tabs),
      ),
      bottomNavigationBar: _PillNavBar(
        index: _index,
        onChanged: (i) {
          if (i == _plus) {
            _newSession();
          } else {
            setState(() => _index = i);
          }
        },
      ),
    );
  }
}

/// The floating tab bar, filled with the team color like the web sidebar: a
/// pill with a thin lighter edge, and a darker capsule that slides to the
/// selected tab. The capsule is wider than a tab and nearly as tall as the
/// bar, so it reads as a capsule rather than a circle.
class _PillNavBar extends StatelessWidget {
  const _PillNavBar({required this.index, required this.onChanged});

  final int index;
  final ValueChanged<int> onChanged;

  static const _items = <IconData>[
    Icons.home_outlined,
    Icons.groups,
    Icons.add,
    Icons.video_library_outlined,
    Icons.calendar_month_outlined,
  ];

  static const _labels = <String>[
    'Home',
    'Groups',
    'New session',
    'Sessions',
    'Calendar',
  ];

  static const _height = 64.0;
  static const _radius = BorderRadius.all(Radius.circular(_height / 2));
  static const _inset = 5.0;

  @override
  Widget build(BuildContext context) {
    final team = TeamAccent.of(context);
    final fill = team.fill;
    // Same hue, stepped toward the text color: light teams get a darker
    // capsule, dark teams a lighter one. 8kount gold uses the design's own
    // selected tint, as the web sidebar does.
    final shade = team.ink == Colors.black ? Colors.black : Colors.white;
    final capsule =
        fill == kGold ? kGoldActive : Color.lerp(fill, shade, 0.22)!;
    final edge = Color.lerp(fill, Colors.white, 0.35)!;

    // On iPhones the bar sits down in the home-indicator area, 20 pt off the
    // bottom like the system's own floating tab bars, clear of the swipe-up
    // handle; elsewhere it stays above the system's gesture area.
    final systemBottom = MediaQuery.viewPaddingOf(context).bottom;
    final ios = Theme.of(context).platform == TargetPlatform.iOS;
    final bottom = ios && systemBottom > 0
        ? math.max(systemBottom - 14, 14.0)
        : systemBottom + 14;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, bottom),
      child: Container(
        height: _height,
        decoration: BoxDecoration(
          color: fill,
          borderRadius: _radius,
          border: Border.all(color: edge, width: 1.5),
        ),
        child: LayoutBuilder(
          builder: (context, constraints) {
            // Tabs are inset from the ends just enough that the capsule,
            // 20% wider than a tab, stays centered on every icon including
            // the first and last.
            final slotWidth =
                (constraints.maxWidth - 2 * _inset) / (_items.length + 0.2);
            final sidePadding = _inset + 0.1 * slotWidth;
            final capsuleWidth = slotWidth * 1.2;
            final left = sidePadding + index * slotWidth - 0.1 * slotWidth;

            return Stack(
              children: [
                AnimatedPositioned(
                  duration: const Duration(milliseconds: 300),
                  curve: Curves.easeOutCubic,
                  left: left,
                  top: _inset,
                  bottom: _inset,
                  width: capsuleWidth,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: capsule,
                      borderRadius: _radius,
                    ),
                  ),
                ),
                Padding(
                  padding: EdgeInsets.symmetric(horizontal: sidePadding),
                  child: Row(
                    children: List.generate(_items.length, (i) {
                      final selected = i == index;
                      return Expanded(
                        child: Semantics(
                          label: _labels[i],
                          selected: selected,
                          button: true,
                          excludeSemantics: true,
                          // No ripple: the sliding capsule is the feedback.
                          child: GestureDetector(
                            behavior: HitTestBehavior.opaque,
                            onTap: () => onChanged(i),
                            child: Center(
                              // + is a button, not a tab: a filled circle.
                              child: i == _plus
                                  ? Container(
                                      width: 44,
                                      height: 44,
                                      decoration: BoxDecoration(
                                        color: team.ink,
                                        shape: BoxShape.circle,
                                      ),
                                      child: Icon(Icons.add,
                                          size: 30, color: fill),
                                    )
                                  : Icon(_items[i], size: 28, color: team.ink),
                            ),
                          ),
                        ),
                      );
                    }),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
