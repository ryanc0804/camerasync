import 'package:camerasync_mobile/api/api_client.dart';
import 'package:flutter/material.dart';

import '../api/groups_api.dart';
import '../auth/auth_service.dart';
import '../theme.dart';

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

  @override
  void initState() {
    super.initState();
    _loadGroups();
  }

  @override
  void dispose() {
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
      if (!mounted) return;
      setState(() {
        _searchResults = results;
        _searching = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
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
          const SizedBox(height: 20),

          // Search bar
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _searchController,
                  decoration: const InputDecoration(
                    hintText: 'Find a group by ID',
                    filled: true,
                    fillColor: Color(0xFF121212),
                    border: OutlineInputBorder(borderRadius: BorderRadius.zero),
                  ),
                  textCapitalization: TextCapitalization.none,
                  onSubmitted: _searchGroups,
                ),
              ),
              const SizedBox(width: 8),
              FilledButton(
                onPressed: () => _searchGroups(_searchController.text),
                child: const Text('Search'),
              ),
            ],
          ),
          const SizedBox(height: 12),

          if (_searching)
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
            const _Notice(
              message: 'You are not a member of any groups yet. Create or join a group from the web dashboard.',
            )
          else
            ..._groups.map((g) => _GroupCard(group: g, onOpen: () => _openGroup(g))).toList(),
        ],
      ),
    );
  }

  void _openGroup(Group g) {
    //placeholder for now, will implement specific group sessions recordings/members screen later
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Open group: ${g.name}')));
  }
}

class _GroupCard extends StatelessWidget {
  const _GroupCard({required this.group, required this.onOpen});

  final Group group;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: const Color(0xFF1C1C1C),
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        title: Text(
          group.name,
          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
        ),
        subtitle: Text('Group ID: ${group.id}', style: const TextStyle(color: kMuted)),
        trailing: FilledButton(onPressed: onOpen, child: const Text('Open')),
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
