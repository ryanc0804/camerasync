import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import 'join_screen.dart';

const kBackground = Color(0xFF0D0D0D);
const kGold = Color(0xFFF2CB05);
const kGoldActive = Color(0xFFFFE066);
const kCard = Color(0xFF4A4750);

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

  @override
  Widget build(BuildContext context) {
    final tabs = [
      const _GroupsTab(),
      JoinScreen(auth: widget.auth),
      const _HomeTab(),
      _SettingsTab(auth: widget.auth),
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

/// Rounded yellow bar that floats above the bottom edge.
class _PillNavBar extends StatelessWidget {
  const _PillNavBar({required this.index, required this.onChanged});

  final int index;
  final ValueChanged<int> onChanged;

  static const _items = <IconData>[
    Icons.groups,
    Icons.photo_camera_outlined,
    Icons.home_outlined,
    Icons.settings_outlined,
  ];

  static const _labels = <String>['Groups', 'Record', 'Home', 'Settings'];

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        margin: const EdgeInsets.fromLTRB(20, 0, 20, 16),
        height: 62,
        decoration: BoxDecoration(
          color: kGold,
          borderRadius: BorderRadius.circular(31),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: List.generate(_items.length, (i) {
            final selected = i == index;
            return Expanded(
              child: Semantics(
                label: _labels[i],
                selected: selected,
                button: true,
                child: InkWell(
                  borderRadius: BorderRadius.circular(31),
                  onTap: () => onChanged(i),
                  child: Center(
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 150),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 22,
                        vertical: 9,
                      ),
                      decoration: BoxDecoration(
                        color: selected ? kGoldActive : Colors.transparent,
                        borderRadius: BorderRadius.circular(24),
                      ),
                      child: Icon(
                        _items[i],
                        size: 26,
                        color: const Color(0xFF0D0D0D),
                      ),
                    ),
                  ),
                ),
              ),
            );
          }),
        ),
      ),
    );
  }
}

/// Recording cards from the design. Real recordings replace these once the
/// videos API exists.
class _HomeTab extends StatelessWidget {
  const _HomeTab();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 110),
      children: [
        const Text(
          'Recent recordings',
          style: TextStyle(
            color: Colors.white,
            fontSize: 20,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 4),
        const Text(
          'No recordings yet — these are placeholders.',
          style: TextStyle(color: Color(0xFF8A8A8A), fontSize: 13),
        ),
        const SizedBox(height: 16),
        for (var i = 0; i < 4; i++) ...[
          Container(
            height: 130,
            decoration: BoxDecoration(
              color: kCard,
              borderRadius: BorderRadius.circular(6),
            ),
          ),
          const SizedBox(height: 18),
        ],
      ],
    );
  }
}

class _GroupsTab extends StatelessWidget {
  const _GroupsTab();

  @override
  Widget build(BuildContext context) {
    return const _EmptyTab(
      title: 'Groups',
      body: 'Teams you belong to. Needs the groups API, which is still a stub.',
    );
  }
}

class _SettingsTab extends StatelessWidget {
  const _SettingsTab({required this.auth});

  final AuthService auth;

  @override
  Widget build(BuildContext context) {
    final user = auth.user;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 110),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Settings',
            style: TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 20),
          if (user != null) ...[
            _row('Name', user.name?.isNotEmpty == true ? user.name! : '—'),
            _row('Email', user.email),
            const SizedBox(height: 24),
          ],
          OutlinedButton.icon(
            onPressed: auth.logout,
            icon: const Icon(Icons.logout),
            label: const Text('Log out'),
            style: OutlinedButton.styleFrom(foregroundColor: kGold),
          ),
        ],
      ),
    );
  }

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 70,
              child: Text(
                label,
                style: const TextStyle(
                  color: Color(0xFF8A8A8A),
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            Expanded(
              child: Text(value, style: const TextStyle(color: Colors.white)),
            ),
          ],
        ),
      );
}

class _EmptyTab extends StatelessWidget {
  const _EmptyTab({required this.title, required this.body});

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 110),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            body,
            style: const TextStyle(color: Color(0xFF8A8A8A), height: 1.5),
          ),
        ],
      ),
    );
  }
}
