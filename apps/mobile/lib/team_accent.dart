import 'package:flutter/material.dart';

import 'api/groups_api.dart';
import 'auth/auth_service.dart';
import 'theme.dart';

/// The signed-in app's colors, taken from the user's primary group (saved on
/// the account from Settings, else the first group they joined), like the web
/// app's GroupThemeContext. Outside a [TeamAccentScope] it is 8kount gold.
class TeamAccent extends InheritedWidget {
  const TeamAccent({
    super.key,
    required this.fill,
    required this.refresh,
    this.primaryGroup,
    required super.child,
  });

  /// The team color as chosen: nav bar, cards and buttons are filled with it.
  final Color fill;

  /// Reloads the user's groups, e.g. after creating or joining one.
  final Future<void> Function() refresh;

  final Group? primaryGroup;

  /// Black or white, whichever reads on [fill].
  Color get ink => inkOn(fill);

  /// [fill] lightened until it reads as text on the black background.
  Color get accent => legibleOnDark(fill);

  /// A lighter tint of [fill] for highlights, like the selected nav slot.
  Color get fillLight => Color.lerp(fill, Colors.white, 0.4)!;

  static TeamAccent of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<TeamAccent>() ??
      TeamAccent(fill: kGold, refresh: () async {}, child: const SizedBox());

  @override
  bool updateShouldNotify(TeamAccent old) =>
      old.fill != fill || old.primaryGroup?.id != primaryGroup?.id;
}

/// The user's primary group: the saved one if they are still in it, else the
/// first group they joined. Mirrors getPrimaryGroupId in the web app.
Group? primaryGroupOf(AppUser? user, List<Group> groups) {
  final saved = user?.primaryGroupId;
  for (final group in groups) {
    if (group.id == saved) return group;
  }
  Group? first;
  for (final group in groups) {
    if (first == null ||
        (group.joinedAt ?? DateTime(9999))
            .isBefore(first.joinedAt ?? DateTime(9999))) {
      first = group;
    }
  }
  return first;
}

/// Loads the user's groups and provides a [TeamAccent] for everything below.
/// Rebuilds when the user's primary group changes.
class TeamAccentScope extends StatefulWidget {
  const TeamAccentScope({super.key, required this.auth, required this.child});

  final AuthService auth;
  final Widget child;

  @override
  State<TeamAccentScope> createState() => _TeamAccentScopeState();
}

class _TeamAccentScopeState extends State<TeamAccentScope> {
  List<Group> _groups = const [];
  int? _userId;

  @override
  void initState() {
    super.initState();
    widget.auth.addListener(_onAuthChanged);
    _refresh();
  }

  @override
  void dispose() {
    widget.auth.removeListener(_onAuthChanged);
    super.dispose();
  }

  void _onAuthChanged() {
    if (!mounted) return;
    // Signing in (or as someone else) needs that user's groups.
    if (widget.auth.user?.id != _userId) {
      _refresh();
    } else {
      setState(() {});
    }
  }

  Future<void> _refresh() async {
    _userId = widget.auth.user?.id;
    if (_userId == null) {
      if (_groups.isNotEmpty) setState(() => _groups = const []);
      return;
    }
    try {
      final groups = await GroupsApi(widget.auth.api).getMyGroups();
      if (mounted) setState(() => _groups = groups);
    } catch (_) {
      // A failed load just leaves 8kount gold in place.
    }
  }

  @override
  Widget build(BuildContext context) {
    final primary = primaryGroupOf(widget.auth.user, _groups);
    final fill = parseHexColor(primary?.primaryColor) ?? kGold;
    final theme = Theme.of(context);
    return TeamAccent(
      fill: fill,
      primaryGroup: primary,
      refresh: _refresh,
      // Material's own widgets (spinners, switches, cursors, default buttons)
      // follow the team color too, in its readable-on-black form.
      child: Theme(
        data: theme.copyWith(colorScheme: schemeFor(legibleOnDark(fill))),
        child: widget.child,
      ),
    );
  }
}
