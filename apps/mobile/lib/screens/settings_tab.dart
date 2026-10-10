import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../api/groups_api.dart';
import '../auth/auth_service.dart';
import '../notifications/phone_alerts.dart';
import '../team_accent.dart';
import '../theme.dart';

const _minPasswordLength = 8;

/// The Settings tab, with the same sections as the web app's Settings page:
/// the account (name, email, password, log out), the primary group whose
/// color the app takes, and About.
class SettingsTab extends StatefulWidget {
  const SettingsTab({super.key, required this.auth, this.alerts});

  final AuthService auth;

  /// Shows phone notifications; asked for permission when they're turned on.
  final PhoneAlerts? alerts;

  @override
  State<SettingsTab> createState() => _SettingsTabState();
}

class _SettingsTabState extends State<SettingsTab> {
  List<Group>? _groups;
  String? _groupsError;
  bool _savingPrimary = false;

  @override
  void initState() {
    super.initState();
    _loadGroups();
  }

  Future<void> _loadGroups() async {
    try {
      final groups = await GroupsApi(widget.auth.api).getMyGroups();
      if (mounted) {
        setState(() {
          _groups = groups;
          _groupsError = null;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _groupsError = e.message);
    }
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _setPrimary(Group group) async {
    setState(() => _savingPrimary = true);
    try {
      await widget.auth.updateProfile(primaryGroupId: group.id);
    } on ApiException catch (e) {
      _toast(e.message);
    } finally {
      if (mounted) setState(() => _savingPrimary = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = widget.auth.user;
    final team = TeamAccent.of(context);

    return RefreshIndicator(
      color: team.accent,
      onRefresh: _loadGroups,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 24, 20, 110),
        children: [
          const Text(
            'Settings',
            style: TextStyle(
                color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          _Card(
            title: 'Account',
            children: [
              _Row(
                label: 'Name',
                value: user?.name?.isNotEmpty == true ? user!.name! : '—',
                action: 'Edit',
                onAction: () => showDialog<void>(
                  context: context,
                  builder: (_) => _NameDialog(auth: widget.auth),
                ),
              ),
              _Row(
                label: 'Email',
                value: user?.email ?? '',
                badge: user?.emailVerified == true ? 'Verified' : null,
              ),
              _Row(
                label: 'Password',
                value: '••••••••',
                action: 'Change',
                onAction: () async {
                  final changed = await showDialog<bool>(
                    context: context,
                    builder: (_) => _PasswordDialog(auth: widget.auth),
                  );
                  if (changed == true) {
                    _toast(
                        'Password changed. Your other devices were signed out.');
                  }
                },
              ),
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerRight,
                child: OutlinedButton.icon(
                  onPressed: widget.auth.logout,
                  icon: const Icon(Icons.logout),
                  label: const Text('Log out'),
                  style: OutlinedButton.styleFrom(foregroundColor: team.accent),
                ),
              ),
            ],
          ),
          _Card(
            title: 'Primary group',
            children: [
              const Text(
                "The app uses this group's team color, on every device you sign in on.",
                style: TextStyle(color: kMuted, height: 1.4),
              ),
              const SizedBox(height: 8),
              if (_groupsError != null)
                Text(_groupsError!, style: const TextStyle(color: kLiveRed))
              else if (_groups == null)
                const Padding(
                  padding: EdgeInsets.all(12),
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (_groups!.isEmpty)
                const Text(
                    "You're not in a group yet. Find one on the Groups tab.",
                    style: TextStyle(color: kMuted))
              else
                for (final group in _groups!)
                  _GroupOption(
                    group: group,
                    selected: group.id == team.primaryGroup?.id,
                    enabled: !_savingPrimary,
                    onTap: () => _setPrimary(group),
                  ),
            ],
          ),
          _NotificationsCard(auth: widget.auth, alerts: widget.alerts),
          const _Card(
            title: 'About',
            children: [
              Text('8kount',
                  style: TextStyle(
                      color: Colors.white, fontWeight: FontWeight.w700)),
              SizedBox(height: 6),
              Text(
                'Record practices from several phones at once, then review every angle '
                'together with timestamped comments. Built by a UCF senior design team.',
                style: TextStyle(color: kMuted, height: 1.4),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Phone notification switches, saved on the account: one for all of
/// them, and one per kind of activity.
class _NotificationsCard extends StatefulWidget {
  const _NotificationsCard({required this.auth, this.alerts});

  final AuthService auth;
  final PhoneAlerts? alerts;

  @override
  State<_NotificationsCard> createState() => _NotificationsCardState();
}

class _NotificationsCardState extends State<_NotificationsCard> {
  bool _saving = false;

  static const _kinds = [
    ('comments', 'Comments on recordings'),
    ('joins', 'People joining your groups'),
    ('sessions', 'Practices starting'),
  ];

  Future<void> _set(String key, bool on) async {
    // Turning them on asks Android for permission first.
    if (key == 'push' && on && widget.alerts != null) {
      final allowed = await widget.alerts!.requestPermission();
      if (!allowed) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content: Text(
                  'Notifications are off for 8kount in your phone settings.')));
        }
        return;
      }
    }
    setState(() => _saving = true);
    try {
      await widget.auth.updateProfile(notificationPrefs: {key: on});
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final team = TeamAccent.of(context);
    final prefs = widget.auth.user?.notificationPrefs ?? const {};
    Widget toggle(String key, String label, {String? subtitle}) =>
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(label, style: const TextStyle(color: Colors.white)),
          subtitle: subtitle == null
              ? null
              : Text(subtitle, style: const TextStyle(color: kMuted, height: 1.3)),
          value: prefs[key] != false,
          activeThumbColor: team.ink,
          activeTrackColor: team.fill,
          onChanged: _saving ? null : (on) => _set(key, on),
        );

    // Push decides whether the phone gets an alert; the categories decide
    // what shows in the app's notifications at all (and so what can be
    // pushed). With push off, categories still show in the app.
    return _Card(
      title: 'Notifications',
      children: [
        toggle('push', 'Push notifications',
            subtitle: 'Send alerts to this phone. When off, your '
                'notifications still show in the app.'),
        const Padding(
          padding: EdgeInsets.only(top: 10, bottom: 2),
          child: Text(
            'CATEGORIES',
            style: TextStyle(
                color: kMuted,
                fontSize: 12,
                fontWeight: FontWeight.w700,
                letterSpacing: 1),
          ),
        ),
        const Text(
          'What shows in your notifications, and gets pushed when push is on.',
          style: TextStyle(color: kMuted, height: 1.3),
        ),
        for (final (key, label) in _kinds) toggle(key, label),
      ],
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    // Material rather than a colored box, so the rows' tap ripples show.
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

class _Row extends StatelessWidget {
  const _Row(
      {required this.label,
      required this.value,
      this.badge,
      this.action,
      this.onAction});

  final String label;
  final String value;
  final String? badge;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          SizedBox(
            width: 78,
            child: Text(label,
                style: const TextStyle(
                    color: kMuted, fontWeight: FontWeight.w600)),
          ),
          Expanded(
            child: Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 8,
              runSpacing: 4,
              children: [
                Text(value, style: const TextStyle(color: Colors.white)),
                if (badge != null)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: const Color(0xFF1F3A24),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(badge!,
                        style: const TextStyle(
                            color: Color(0xFF8BD48B),
                            fontSize: 11,
                            fontWeight: FontWeight.w700)),
                  ),
              ],
            ),
          ),
          if (action != null)
            TextButton(
              onPressed: onAction,
              style: TextButton.styleFrom(
                  foregroundColor: TeamAccent.of(context).accent),
              child: Text(action!),
            ),
        ],
      ),
    );
  }
}

class _GroupOption extends StatelessWidget {
  const _GroupOption({
    required this.group,
    required this.selected,
    required this.enabled,
    required this.onTap,
  });

  final Group group;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = parseHexColor(group.primaryColor) ?? kGold;
    return Semantics(
      selected: selected,
      button: true,
      label: 'Make ${group.name} your primary group',
      child: ListTile(
        contentPadding: EdgeInsets.zero,
        enabled: enabled,
        onTap: selected ? null : onTap,
        leading: CircleAvatar(radius: 12, backgroundColor: color),
        title: Text(group.name, style: const TextStyle(color: Colors.white)),
        trailing: selected
            ? Icon(Icons.check_circle, color: TeamAccent.of(context).accent)
            : const Icon(Icons.circle_outlined, color: kFaint),
      ),
    );
  }
}

class _NameDialog extends StatefulWidget {
  const _NameDialog({required this.auth});

  final AuthService auth;

  @override
  State<_NameDialog> createState() => _NameDialogState();
}

class _NameDialogState extends State<_NameDialog> {
  late final _name = TextEditingController(text: widget.auth.user?.name ?? '');
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Enter your name.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.auth.updateProfile(name: name);
      if (mounted) Navigator.of(context).pop();
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _saving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Your name'),
      content: TextField(
        controller: _name,
        autofocus: true,
        maxLength: 63,
        enabled: !_saving,
        decoration: InputDecoration(errorText: _error),
        onSubmitted: (_) => _save(),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
            onPressed: _saving ? null : _save, child: const Text('Save')),
      ],
    );
  }
}

class _PasswordDialog extends StatefulWidget {
  const _PasswordDialog({required this.auth});

  final AuthService auth;

  @override
  State<_PasswordDialog> createState() => _PasswordDialogState();
}

class _PasswordDialogState extends State<_PasswordDialog> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_next.text.length < _minPasswordLength) {
      setState(() => _error =
          'New password must be at least $_minPasswordLength characters.');
      return;
    }
    if (_next.text != _confirm.text) {
      setState(() => _error = "The new passwords don't match.");
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.auth.changePassword(
        currentPassword: _current.text,
        newPassword: _next.text,
      );
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _saving = false;
        });
      }
    }
  }

  Widget _field(TextEditingController controller, String label) => TextField(
        controller: controller,
        obscureText: true,
        enabled: !_saving,
        decoration: InputDecoration(labelText: label),
      );

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Change password'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _field(_current, 'Current password'),
            _field(_next, 'New password'),
            _field(_confirm, 'Confirm new password'),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(_error!, style: const TextStyle(color: kLiveRed)),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: Text(_saving ? 'Saving…' : 'Change password'),
        ),
      ],
    );
  }
}
