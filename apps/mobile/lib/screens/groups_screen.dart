import 'dart:async';

import 'package:camerasync_mobile/api/api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/groups_api.dart';
import '../auth/auth_service.dart';
import '../team_accent.dart';
import '../theme.dart';
import '../widgets/create_group_dialog.dart';
import '../widgets/empty_state.dart';
import 'group_settings_screen.dart';

/// Lists the user's groups and lets them open a group's sessions.
class GroupsScreen extends StatefulWidget {
  const GroupsScreen({super.key, required this.auth});

  final AuthService auth;

  @override
  State<GroupsScreen> createState() => _GroupsScreenState();
}

class _GroupsScreenState extends State<GroupsScreen> {
  late final GroupsApi _groupsApi = GroupsApi(widget.auth.api);

  List<Group> _groups = [];
  bool _loading = true;
  String? _error;
  final TextEditingController _searchController = TextEditingController();
  List<Group> _searchResults = [];
  bool _searching = false;
  String? _searchError;
  Timer? _searchDebounce;

  /// Search waits this long after the last keystroke, so typing a whole ID
  /// sends one request instead of one per letter.
  static const _searchDelay = Duration(milliseconds: 300);

  @override
  void initState() {
    super.initState();
    _loadGroups();
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadGroups() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final groups = await _groupsApi.getMyGroups();
      if (!mounted) return;
      setState(() {
        _groups = groups;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e is ApiException ? e.message : 'Unable to load groups.';
        _loading = false;
      });
    }
  }

  void _onSearchChanged(String text) {
    setState(() {}); // shows or hides the clear button
    _searchDebounce?.cancel();
    _searchDebounce = Timer(_searchDelay, () => _searchGroups(text));
  }

  Future<void> _searchGroups(String query) async {
    final q = query.trim();
    if (q.isEmpty) {
      setState(() {
        _searchResults = [];
        _searchError = null;
        _searching = false;
      });
      return;
    }

    setState(() {
      _searching = true;
      _searchError = null;
    });

    try {
      final results = await _groupsApi.searchGroups(q);
      // A slower reply for an older query must not replace newer results.
      if (!mounted || q != _searchController.text.trim()) return;
      setState(() {
        _searchResults = results;
        _searching = false;
      });
    } on ApiException catch (e) {
      if (!mounted || q != _searchController.text.trim()) return;
      setState(() {
        _searchError = e.message;
        _searching = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _searchError = 'Search failed.';
        _searching = false;
      });
    }
  }

  Future<void> _joinGroup(BuildContext context, Group group) async {
    if (group.isMember) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('You are already a member of ${group.name}')));
      return;
    }

    String password = '';
    if (!group.isPublic) {
      final entered = await showDialog<String?>(
        context: context,
        builder: (ctx) {
          final ctl = TextEditingController();
          return AlertDialog(
            title: Text('Join ${group.id}'),
            content: TextField(
              controller: ctl,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Group password'),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.of(ctx).pop(null), child: const Text('Cancel')),
              FilledButton(onPressed: () => Navigator.of(ctx).pop(ctl.text), child: const Text('Join')),
            ],
          );
        },
      );

      if (entered == null) return;
      password = entered;
    }

    try {
      final joined = await _groupsApi.joinGroup(group.id, password);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Joined ${joined.name}')));
      await _loadGroups();
      // A first group becomes the primary group, which colors the app.
      if (mounted) TeamAccent.of(this.context).refresh();
      // update search result locally
      setState(() {
        _searchResults = _searchResults.map((g) => g.id == group.id ? Group(id: g.id, name: g.name, isPublic: g.isPublic, isMember: true) : g).toList();
      });
    } on ApiException catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } catch (_) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Unable to join group.')));
    }
  }

  Future<void> _createGroup() async {
    final created = await showDialog<Group>(
      context: context,
      builder: (_) => CreateGroupDialog(groupsApi: _groupsApi),
    );
    if (created == null || !mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Created ${created.name}')),
    );
    await _loadGroups();
    if (mounted) TeamAccent.of(context).refresh();
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _loadGroups,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 24, 20, 110),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          const Text(
            'Groups',
            style: TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Your groups let you share sessions and recordings with teammates.\nTap a group to view its sessions.',
            style: TextStyle(color: kMuted, height: 1.5),
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: _createGroup,
              style: TextButton.styleFrom(padding: EdgeInsets.zero),
              child: Text.rich(
                TextSpan(
                  text: "Don't have a group? ",
                  style: const TextStyle(color: Colors.white),
                  children: [
                    TextSpan(
                      text: 'Create one',
                      style: TextStyle(
                        color: TeamAccent.of(context).accent,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Search updates as you type.
          TextField(
            controller: _searchController,
            decoration: InputDecoration(
              hintText: 'Find a group by ID',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _searchController.text.isEmpty
                  ? null
                  : IconButton(
                      tooltip: 'Clear search',
                      icon: const Icon(Icons.close),
                      onPressed: () {
                        _searchController.clear();
                        _onSearchChanged('');
                      },
                    ),
              filled: true,
              fillColor: const Color(0xFF121212),
              border: const OutlineInputBorder(borderRadius: BorderRadius.zero),
            ),
            textCapitalization: TextCapitalization.none,
            textInputAction: TextInputAction.search,
            onChanged: _onSearchChanged,
            onSubmitted: (text) {
              _searchDebounce?.cancel();
              _searchGroups(text);
            },
          ),
          const SizedBox(height: 12),

          if (_searching && _searchResults.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 12),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_searchError != null)
            _Notice(message: _searchError!, actionLabel: 'Retry', onAction: () => _searchGroups(_searchController.text))
          else if (_searchResults.isNotEmpty) ...[
            const SizedBox(height: 8),
            ..._searchResults.map((g) => _SearchResultCard(group: g, onJoin: () => _joinGroup(context, g))).toList(),
            const Divider(color: Color(0xFF2A2A2A)),
          ],

          const SizedBox(height: 8),

          const Text('My groups', style: TextStyle(color: kMuted)),
          const SizedBox(height: 12),

          if (_loading)
            const Padding(
              padding: EdgeInsets.only(top: 48),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_error != null)
            _Notice(message: _error!, actionLabel: 'Retry', onAction: _loadGroups)
          else if (_groups.isEmpty)
            EmptyState(
              title: 'No groups yet',
              message: "Search for your team's group by its ID above and "
                  'join it, or create a new one for your team.',
              actionLabel: 'Create a group',
              onAction: _createGroup,
            )
          else
            // Long-press a group and drag it to change the order; the order
            // is saved on the account, like on the web.
            ReorderableListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              buildDefaultDragHandles: false,
              itemCount: _groups.length,
              onReorderItem: _reorder,
              // A buzz when it lifts, so you know it's picked up.
              onReorderStart: (_) => HapticFeedback.mediumImpact(),
              // The picked-up card grows, tilts a little and casts a shadow
              // while it's carried.
              proxyDecorator: (child, _, animation) => AnimatedBuilder(
                animation: animation,
                builder: (context, child) {
                  final t = Curves.easeOut.transform(animation.value);
                  return Transform.rotate(
                    angle: -0.02 * t,
                    child: Transform.scale(
                      scale: 1 + 0.06 * t,
                      child: Material(
                        color: Colors.transparent,
                        elevation: 16 * t,
                        shadowColor: Colors.black,
                        borderRadius: BorderRadius.circular(12),
                        child: child,
                      ),
                    ),
                  );
                },
                child: child,
              ),
              itemBuilder: (context, i) {
                final g = _groups[i];
                return ReorderableDelayedDragStartListener(
                  key: ValueKey(g.id),
                  index: i,
                  child: _GroupCard(
                    group: g,
                    isPrimary: g.id == TeamAccent.of(context).primaryGroup?.id,
                    onOpen: () => _openGroup(g),
                  ),
                );
              },
            ),
        ],
      ),
    );
  }

  /// Moves a dragged group and saves the new order to the account.
  Future<void> _reorder(int from, int to) async {
    setState(() {
      final group = _groups.removeAt(from);
      _groups.insert(to, group);
    });
    try {
      await widget.auth
          .updateProfile(groupOrder: [for (final g in _groups) g.id]);
    } on ApiException catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text("Couldn't save the new order. Try again.")));
      }
    }
  }

  /// The group's page: its live session or starting one, its recordings,
  /// and its settings.
  Future<void> _openGroup(Group g) async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => GroupSettingsScreen(auth: widget.auth, group: g)),
    );
    // The color or roster may have changed there.
    if (mounted) _loadGroups();
  }
}

class _GroupCard extends StatelessWidget {
  const _GroupCard({
    required this.group,
    required this.isPrimary,
    required this.onOpen,
  });

  final Group group;
  final bool isPrimary;
  final VoidCallback onOpen;

  /// The card is filled with the team color and opens the group's page,
  /// matching the web's group tiles.
  @override
  Widget build(BuildContext context) {
    final fill = parseHexColor(group.primaryColor);
    final ink = fill == null ? Colors.white : inkOn(fill);

    return Card(
      color: fill ?? const Color(0xFF1C1C1C),
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onOpen,
        child: Padding(
        padding: const EdgeInsets.fromLTRB(8, 14, 10, 14),
        child: Row(
          children: [
            // Shows the cards can be moved: long-press and drag.
            Icon(Icons.drag_indicator, color: ink.withValues(alpha: 0.55)),
            const SizedBox(width: 6),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: 8,
                    children: [
                      Text(
                        group.name,
                        style: TextStyle(color: ink, fontSize: 16, fontWeight: FontWeight.w600),
                      ),
                      if (isPrimary)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: ink.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text('Primary',
                              style: TextStyle(color: ink, fontSize: 11, fontWeight: FontWeight.w700)),
                        ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Group ID: ${group.id}',
                    style: TextStyle(color: fill == null ? kMuted : ink.withValues(alpha: 0.75)),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right, color: ink.withValues(alpha: 0.8)),
          ],
        ),
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
          Text(message, textAlign: TextAlign.center, style: const TextStyle(color: kMuted, height: 1.5)),
          if (actionLabel != null) ...[
            const SizedBox(height: 16),
            OutlinedButton(onPressed: onAction, child: Text(actionLabel!)),
          ]
        ],
      ),
    );
  }
}

class _SearchResultCard extends StatelessWidget {
  const _SearchResultCard({required this.group, required this.onJoin});

  final Group group;
  final VoidCallback onJoin;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: const Color(0xFF111111),
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        title: Text(group.id, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
        subtitle: Text(group.name, style: const TextStyle(color: kMuted)),
        trailing: group.isMember
            ? const Text('Member', style: TextStyle(color: kMuted))
            : FilledButton(onPressed: onJoin, child: const Text('Join')),
      ),
    );
  }
}
