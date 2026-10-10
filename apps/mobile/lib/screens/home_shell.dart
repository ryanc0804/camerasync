import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../team_accent.dart';
import '../theme.dart';
import 'calendar_tab.dart';
import 'home_tab.dart';
import 'join_screen.dart';
import 'groups_screen.dart';
import 'settings_tab.dart';
import '../notifications/phone_alerts.dart';

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

class _HomeShellState extends State<HomeShell> {
  // Order matches the design: groups, record, home, settings.
  int _index = 2;

  /// Phone notifications for activity in the user's groups, while signed in.
  late final PhoneAlerts _alerts = PhoneAlerts(widget.auth);

  @override
  void initState() {
    super.initState();
    _alerts.start().catchError((_) {});
  }

  @override
  void dispose() {
    _alerts.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tabs = [
      // Groups tab (new)
      GroupsScreen(auth: widget.auth),
      // Session list (formerly the Record tab) — moved under the camera icon
      JoinScreen(auth: widget.auth),
      HomeTab(
        key: const ValueKey('home-tab'),
        auth: widget.auth,
        onSwitchTab: (i) => setState(() => _index = i),
      ),
      CalendarTab(auth: widget.auth),
      SettingsTab(auth: widget.auth, alerts: _alerts),
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
        onChanged: (i) => setState(() => _index = i),
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
    Icons.groups,
    Icons.photo_camera_outlined,
    Icons.home_outlined,
    Icons.calendar_month_outlined,
    Icons.settings_outlined,
  ];

  static const _labels = <String>[
    'Groups',
    'Record',
    'Home',
    'Calendar',
    'Settings',
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

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
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
                                child:
                                    Icon(_items[i], size: 28, color: team.ink),
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
      ),
    );
  }
}
