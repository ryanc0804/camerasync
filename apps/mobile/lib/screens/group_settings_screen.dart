import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

import '../api/api_client.dart';
import '../api/groups_api.dart';
import '../auth/auth_service.dart';
import '../team_accent.dart';
import '../theme.dart';
import 'recordings_screen.dart';

const _roleLabel = {
  'admin': 'an admin',
  'member': 'a member',
  'viewer': 'a viewer'
};

/// One group's page, opened from the gear on its card (the web app's group
/// settings page): make it your primary group, change its team color (admins
/// and the owner only), and see or manage the roster.
class GroupSettingsScreen extends StatefulWidget {
  const GroupSettingsScreen(
      {super.key, required this.auth, required this.group});

  final AuthService auth;
  final Group group;

  @override
  State<GroupSettingsScreen> createState() => _GroupSettingsScreenState();
}

class _GroupSettingsScreenState extends State<GroupSettingsScreen> {
  late final GroupsApi _api = GroupsApi(widget.auth.api);
  late Group _group = widget.group;
  bool _savingPrimary = false;

  int? get _userId => widget.auth.user?.id;
  bool get _isOwner => _group.owner != null && _group.owner == _userId;

  void _toast(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _makePrimary() async {
    setState(() => _savingPrimary = true);
    try {
      await widget.auth.updateProfile(primaryGroupId: _group.id);
    } on ApiException catch (e) {
      _toast(e.message);
    } finally {
      if (mounted) setState(() => _savingPrimary = false);
    }
  }

  /// After leaving or deleting the group: recolor the app if it was the
  /// primary group, and go back to the list.
  void _goneFromGroup() {
    TeamAccent.of(context).refresh();
    Navigator.of(context).pop();
  }

  void _openRecordings() {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => RecordingsScreen(
          auth: widget.auth, groupId: _group.id, title: _group.name),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final team = TeamAccent.of(context);
    final fill = parseHexColor(_group.primaryColor) ?? kSurfaceLight;
    final ink = inkOn(fill);
    final isPrimary = team.primaryGroup?.id == _group.id;
    final yourRole =
        _isOwner ? 'the owner' : _roleLabel[_group.role] ?? 'a member';

    return Scaffold(
      backgroundColor: kBackground,
      appBar: AppBar(
        backgroundColor: kBackground,
        foregroundColor: Colors.white,
        title: const Text('Group'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 32),
        children: [
          // Banner in the team color.
          Container(
            padding: const EdgeInsets.fromLTRB(20, 18, 16, 18),
            decoration: BoxDecoration(
                color: fill, borderRadius: BorderRadius.circular(16)),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_group.name,
                          style: TextStyle(
                              color: ink,
                              fontSize: 24,
                              fontWeight: FontWeight.w800)),
                      const SizedBox(height: 4),
                      Text(
                        'ID ${_group.id} · ${_group.isPublic ? 'Public' : 'Private'} · You\'re $yourRole',
                        style: TextStyle(
                            color: ink.withValues(alpha: 0.75), fontSize: 13),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  onPressed: _openRecordings,
                  style: FilledButton.styleFrom(
                      backgroundColor: ink, foregroundColor: fill),
                  child: const Text('Recordings'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          _Section(
            title: 'Primary group',
            children: [
              if (isPrimary)
                const Text(
                    'This is your primary group, so the app uses its color.',
                    style: TextStyle(color: kMuted, height: 1.4))
              else ...[
                const Text("Your primary group sets the app's color.",
                    style: TextStyle(color: kMuted, height: 1.4)),
                const SizedBox(height: 10),
                Align(
                  alignment: Alignment.centerLeft,
                  child: FilledButton(
                    onPressed: _savingPrimary ? null : _makePrimary,
                    style: FilledButton.styleFrom(
                      backgroundColor: team.fill,
                      foregroundColor: team.ink,
                    ),
                    child: Text(_savingPrimary
                        ? 'Saving…'
                        : 'Make this my primary group'),
                  ),
                ),
              ],
            ],
          ),
          if (_group.canManage(_userId))
            _ColorSection(
              group: _group,
              api: _api,
              onSaved: (updated) {
                setState(() => _group = updated);
                // The primary group's color may have changed.
                TeamAccent.of(context).refresh();
              },
            ),
          if (_group.inviteUrl != null) _InviteSection(group: _group),
          _MembersSection(
              group: _group, api: _api, userId: _userId, isOwner: _isOwner),
          if (_isOwner)
            _OwnerSection(
              group: _group,
              api: _api,
              userId: _userId,
              onSaved: (updated) {
                setState(() => _group = updated);
                TeamAccent.of(context).refresh();
              },
              onGone: _goneFromGroup,
            )
          else
            _LeaveSection(group: _group, api: _api, onLeft: _goneFromGroup),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    // Material rather than a colored box, so tap ripples inside show.
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Material(
        color: kSurface,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(title,
                  style: const TextStyle(
                      color: Colors.white,
                      fontSize: 17,
                      fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              ...children,
            ],
          ),
        ),
      ),
    );
  }
}

/// Team color swatches for admins and the owner. Everyone else never sees
/// this, and the server refuses their changes anyway.
class _ColorSection extends StatefulWidget {
  const _ColorSection(
      {required this.group, required this.api, required this.onSaved});

  final Group group;
  final GroupsApi api;
  final ValueChanged<Group> onSaved;

  @override
  State<_ColorSection> createState() => _ColorSectionState();
}

class _ColorSectionState extends State<_ColorSection> {
  late String? _color = _paletteColor(widget.group.primaryColor);
  bool _saving = false;
  String? _error;

  static String? _paletteColor(String? hex) {
    final lower = hex?.toLowerCase();
    return kTeamColors.any((c) => c.$2 == lower) ? lower : null;
  }

  bool get _changed =>
      _color != null && _color != widget.group.primaryColor?.toLowerCase();

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      widget.onSaved(await widget.api.updateColor(widget.group.id, _color!));
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final team = TeamAccent.of(context);
    return _Section(
      title: 'Team color',
      children: [
        const Text(
          "Shown on the group's card, and across the app for anyone whose primary group this is.",
          style: TextStyle(color: kMuted, height: 1.4),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            for (final (name, hex) in kTeamColors)
              Semantics(
                label: 'Team color $name',
                selected: hex == _color,
                button: true,
                child: GestureDetector(
                  onTap: _saving ? null : () => setState(() => _color = hex),
                  child: Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: parseHexColor(hex),
                      shape: BoxShape.circle,
                      border: Border.all(
                        color:
                            hex == _color ? Colors.white : Colors.transparent,
                        width: 2.5,
                      ),
                    ),
                    child: hex == _color
                        ? Icon(Icons.check,
                            size: 20, color: inkOn(parseHexColor(hex)!))
                        : null,
                  ),
                ),
              ),
          ],
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Text(_error!, style: const TextStyle(color: kLiveRed)),
          ),
        const SizedBox(height: 12),
        Align(
          alignment: Alignment.centerRight,
          child: FilledButton(
            onPressed: _saving || !_changed ? null : _save,
            style: FilledButton.styleFrom(
                backgroundColor: team.fill, foregroundColor: team.ink),
            child: Text(_saving ? 'Saving…' : 'Save color'),
          ),
        ),
      ],
    );
  }
}

class _MembersSection extends StatefulWidget {
  const _MembersSection({
    required this.group,
    required this.api,
    required this.userId,
    required this.isOwner,
  });

  final Group group;
  final GroupsApi api;
  final int? userId;
  final bool isOwner;

  @override
  State<_MembersSection> createState() => _MembersSectionState();
}

class _MembersSectionState extends State<_MembersSection> {
  List<GroupMember>? _members;
  String? _error;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final members = await widget.api.getMembers(widget.group.id);
      if (mounted) setState(() => _members = members);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  bool get _isAdmin => widget.isOwner || widget.group.role == 'admin';

  /// Same rule as the web roster: the owner can manage anyone else; admins
  /// can manage members and viewers.
  bool _canManage(GroupMember member) =>
      member.id != widget.group.owner &&
      member.id != widget.userId &&
      (widget.isOwner ||
          (_isAdmin && (member.role == 'member' || member.role == 'viewer')));

  /// A role change saves straight away (it's easy to undo); removing
  /// someone asks first.
  Future<void> _update(GroupMember member, String? role) async {
    if (role == null) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          content: Text('Remove ${member.name} from this group?'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              style: FilledButton.styleFrom(backgroundColor: kLiveRed),
              child: const Text('Remove'),
            ),
          ],
        ),
      );
      if (confirmed != true || !mounted) return;
    }

    setState(() => _saving = true);
    try {
      if (role == null) {
        await widget.api.removeMember(widget.group.id, member.id);
        setState(
            () => _members = [..._members!.where((m) => m.id != member.id)]);
      } else {
        await widget.api.changeMemberRole(widget.group.id, member.id, role);
        setState(() => _members = [
              for (final m in _members!)
                m.id == member.id
                    ? GroupMember(id: m.id, name: m.name, role: role)
                    : m,
            ]);
      }
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String _roleName(GroupMember member) => member.id == widget.group.owner
      ? 'Owner'
      : switch (member.role) {
          'admin' => 'Admin',
          'viewer' => 'Viewer',
          _ => 'Member'
        };

  @override
  Widget build(BuildContext context) {
    final members = _members;
    return _Section(
      title: members == null ? 'Members' : 'Members (${members.length})',
      children: [
        if (_error != null)
          Text(_error!, style: const TextStyle(color: kLiveRed))
        else if (members == null)
          const Padding(
            padding: EdgeInsets.all(12),
            child: Center(child: CircularProgressIndicator()),
          )
        else
          for (final member in members)
            ListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: Text(member.name,
                  style: const TextStyle(color: Colors.white, fontSize: 15)),
              subtitle: _canManage(member)
                  ? null
                  : Text(_roleName(member),
                      style: const TextStyle(color: kMuted)),
              trailing: _canManage(member)
                  ? Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        DropdownButton<String>(
                          value: member.role,
                          dropdownColor: kSurfaceLight,
                          underline: const SizedBox(),
                          style: const TextStyle(
                              color: Colors.white, fontSize: 14),
                          onChanged: _saving
                              ? null
                              : (role) {
                                  if (role != null && role != member.role) {
                                    _update(member, role);
                                  }
                                },
                          items: const [
                            DropdownMenuItem(
                                value: 'admin', child: Text('Admin')),
                            DropdownMenuItem(
                                value: 'member', child: Text('Member')),
                            DropdownMenuItem(
                                value: 'viewer', child: Text('Viewer')),
                          ],
                        ),
                        IconButton(
                          onPressed:
                              _saving ? null : () => _update(member, null),
                          tooltip: 'Remove ${member.name} from group',
                          icon: const Icon(Icons.remove,
                              color: kLiveRed, size: 28),
                        ),
                      ],
                    )
                  : null,
            ),
      ],
    );
  }
}

/// Asks before something that can't be undone. Returns true to go ahead.
Future<bool> _confirm(
    BuildContext context, String message, String action) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      content: Text(message),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          style: FilledButton.styleFrom(backgroundColor: kLiveRed),
          child: Text(action),
        ),
      ],
    ),
  );
  return ok == true;
}

/// The owner's controls: the group's name and privacy, handing it to
/// someone else (after which they can leave), and deleting it.
class _OwnerSection extends StatefulWidget {
  const _OwnerSection({
    required this.group,
    required this.api,
    required this.userId,
    required this.onSaved,
    required this.onGone,
  });

  final Group group;
  final GroupsApi api;
  final int? userId;
  final ValueChanged<Group> onSaved;
  final VoidCallback onGone;

  @override
  State<_OwnerSection> createState() => _OwnerSectionState();
}

class _OwnerSectionState extends State<_OwnerSection> {
  late final _name = TextEditingController(text: widget.group.name);
  final _password = TextEditingController();
  late bool _isPublic = widget.group.isPublic;
  List<GroupMember> _members = const [];
  int? _newOwner;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    widget.api.getMembers(widget.group.id).then((members) {
      if (mounted) {
        setState(() =>
            _members = members.where((m) => m.id != widget.userId).toList());
      }
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _name.dispose();
    _password.dispose();
    super.dispose();
  }

  void _toast(String message) => ScaffoldMessenger.of(context)
      .showSnackBar(SnackBar(content: Text(message)));

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _saveDetails() => _run(() async {
        final updated = await widget.api.updateDetails(
          widget.group.id,
          name: _name.text.trim(),
          isPublic: _isPublic,
          password: _password.text,
        );
        _password.clear();
        widget.onSaved(updated);
        _toast('Group details saved');
      });

  Future<void> _handOver() async {
    final member = _members.where((m) => m.id == _newOwner).firstOrNull;
    if (member == null) return;
    final ok = await _confirm(
      context,
      "Make ${member.name} the owner of ${widget.group.name}? You'll stay on as an admin.",
      'Hand over',
    );
    if (!ok || !mounted) return;
    await _run(() async {
      widget.onSaved(await widget.api.transfer(widget.group.id, member.id));
      _toast('${member.name} now owns the group');
    });
  }

  Future<void> _delete() async {
    final ok = await _confirm(
      context,
      "Delete ${widget.group.name} with all of its sessions, recordings and comments? This can't be undone.",
      'Delete',
    );
    if (!ok || !mounted) return;
    await _run(() async {
      await widget.api.deleteGroup(widget.group.id);
      widget.onGone();
    });
  }

  @override
  Widget build(BuildContext context) {
    final team = TeamAccent.of(context);
    final privateNeedsPassword = !_isPublic && widget.group.isPublic;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Section(
          title: 'Group details',
          children: [
            TextField(
              controller: _name,
              maxLength: 100,
              enabled: !_busy,
              decoration:
                  const InputDecoration(labelText: 'Name', counterText: ''),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: !_isPublic,
              activeThumbColor: team.accent,
              onChanged: _busy
                  ? null
                  : (private) => setState(() => _isPublic = !private),
              title:
                  const Text('Private', style: TextStyle(color: Colors.white)),
              subtitle: const Text('People need a password to join',
                  style: TextStyle(color: kMuted)),
            ),
            if (!_isPublic)
              TextField(
                controller: _password,
                obscureText: true,
                enabled: !_busy,
                decoration: InputDecoration(
                  labelText: privateNeedsPassword
                      ? 'Password'
                      : 'New password (blank keeps the current one)',
                ),
              ),
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton(
                onPressed: _busy ? null : _saveDetails,
                style: FilledButton.styleFrom(
                    backgroundColor: team.fill, foregroundColor: team.ink),
                child: const Text('Save'),
              ),
            ),
          ],
        ),
        _Section(
          title: 'Owner',
          children: [
            const Text(
              "Hand the group to someone else. You'll stay on as an admin and can leave afterwards.",
              style: TextStyle(color: kMuted, height: 1.4),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: DropdownButton<int>(
                    value: _newOwner,
                    isExpanded: true,
                    dropdownColor: kSurfaceLight,
                    hint: Text(
                        _members.isEmpty
                            ? 'No one else in the group'
                            : 'Choose a member',
                        style: const TextStyle(color: kMuted)),
                    style: const TextStyle(color: Colors.white, fontSize: 15),
                    onChanged:
                        _busy ? null : (id) => setState(() => _newOwner = id),
                    items: [
                      for (final m in _members)
                        DropdownMenuItem(value: m.id, child: Text(m.name)),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  onPressed: _busy || _newOwner == null ? null : _handOver,
                  child: const Text('Hand over'),
                ),
              ],
            ),
            const SizedBox(height: 16),
            const Text(
              'Deleting the group removes every session, recording and comment in it.',
              style: TextStyle(color: kMuted, height: 1.4),
            ),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton(
                onPressed: _busy ? null : _delete,
                style: OutlinedButton.styleFrom(
                  foregroundColor: kLiveRed,
                  side: const BorderSide(color: Color(0xFF5A2A2A)),
                ),
                child: const Text('Delete group'),
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Text(_error!, style: const TextStyle(color: kLiveRed)),
              ),
          ],
        ),
      ],
    );
  }
}

class _LeaveSection extends StatefulWidget {
  const _LeaveSection(
      {required this.group, required this.api, required this.onLeft});

  final Group group;
  final GroupsApi api;
  final VoidCallback onLeft;

  @override
  State<_LeaveSection> createState() => _LeaveSectionState();
}

class _LeaveSectionState extends State<_LeaveSection> {
  bool _leaving = false;
  String? _error;

  Future<void> _leave() async {
    final ok = await _confirm(
      context,
      "Leave ${widget.group.name}? You'll need its ID${widget.group.isPublic ? '' : ' and password'} to join again.",
      'Leave',
    );
    if (!ok || !mounted) return;
    setState(() {
      _leaving = true;
      _error = null;
    });
    try {
      await widget.api.leave(widget.group.id);
      widget.onLeft();
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _leaving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return _Section(
      title: 'Leave group',
      children: [
        const Text("You'll stop seeing its sessions and recordings.",
            style: TextStyle(color: kMuted)),
        const SizedBox(height: 10),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton(
            onPressed: _leaving ? null : _leave,
            style: OutlinedButton.styleFrom(
              foregroundColor: kLiveRed,
              side: const BorderSide(color: Color(0xFF5A2A2A)),
            ),
            child: Text(_leaving ? 'Leaving…' : 'Leave group'),
          ),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Text(_error!, style: const TextStyle(color: kLiveRed)),
          ),
      ],
    );
  }
}

/// The group's invite link: Share opens the phone's share sheet (Messages,
/// Snapchat, ...); the copy button puts the link on the clipboard.
class _InviteSection extends StatelessWidget {
  const _InviteSection({required this.group});

  final Group group;

  @override
  Widget build(BuildContext context) {
    final team = TeamAccent.of(context);
    final link = group.inviteUrl!;
    return _Section(
      title: 'Invite people',
      children: [
        Text(
          group.isPublic
              ? 'Anyone with this link can join.'
              : 'Anyone with this link can join once they enter the group password.',
          style: const TextStyle(color: kMuted, height: 1.4),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: FilledButton.icon(
                onPressed: () => SharePlus.instance.share(
                  ShareParams(text: 'Join ${group.name} on 8kount: $link'),
                ),
                style: FilledButton.styleFrom(
                    backgroundColor: team.fill, foregroundColor: team.ink),
                icon: const Icon(Icons.ios_share),
                label: const Text('Share invite link'),
              ),
            ),
            const SizedBox(width: 8),
            IconButton(
              tooltip: 'Copy invite link',
              icon: const Icon(Icons.copy, color: Colors.white70),
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: link));
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Invite link copied')));
                }
              },
            ),
          ],
        ),
      ],
    );
  }
}
