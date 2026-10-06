import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/api_client.dart';
import '../api/groups_api.dart';
import '../theme.dart';

/// Team colors offered when creating a group. The first is the app's default
/// gold, matching the server's default primary color.
const kGroupColors = [
  '#ffc72c',
  '#e53935',
  '#1e88e5',
  '#43a047',
  '#8e24aa',
  '#fb8c00',
];

Color _hexColor(String hex) => Color(int.parse('FF${hex.substring(1)}', radix: 16));

/// The "new group" overlay from the Create A Group design: name, ID,
/// visibility (with a password when private) and a team color. Pops with the
/// created [Group], or null if cancelled.
class CreateGroupDialog extends StatefulWidget {
  const CreateGroupDialog({super.key, required this.groupsApi});

  final GroupsApi groupsApi;

  @override
  State<CreateGroupDialog> createState() => _CreateGroupDialogState();
}

class _CreateGroupDialogState extends State<CreateGroupDialog> {
  final _name = TextEditingController();
  final _id = TextEditingController();
  final _password = TextEditingController();
  bool _isPrivate = false;
  String _color = kGroupColors.first;
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _id.dispose();
    _password.dispose();
    super.dispose();
  }

  String? _validate() {
    if (_name.text.trim().isEmpty) return 'Please enter a group name.';
    if (_id.text.isEmpty) return 'Please choose a group ID.';
    if (_isPrivate && _password.text.trim().isEmpty) {
      return 'Private groups need a password.';
    }
    return null;
  }

  Future<void> _submit() async {
    final error = _validate();
    if (error != null) {
      setState(() => _error = error);
      return;
    }

    setState(() {
      _error = null;
      _submitting = true;
    });
    try {
      final group = await widget.groupsApi.createGroup(
        id: _id.text,
        name: _name.text.trim(),
        isPublic: !_isPrivate,
        password: _password.text,
        primaryColor: _color,
      );
      if (mounted) Navigator.of(context).pop(group);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Unable to create group.');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: kSurface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'Create a group',
              style: TextStyle(
                color: kGold,
                fontSize: 20,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 16),
            if (_error != null) ...[
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: const Color(0xFF2A1A1A),
                  border: Border.all(color: const Color(0xFF5A2A2A)),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  _error!,
                  style: const TextStyle(color: Color(0xFFFF8A80)),
                ),
              ),
              const SizedBox(height: 12),
            ],
            _field(
              label: 'Group Name',
              controller: _name,
              hint: 'Team Knightro',
            ),
            _field(
              label: 'Group ID',
              controller: _id,
              hint: 'Letters and numbers only',
              // Teammates search by this ID, so it's restricted to what the
              // server accepts instead of failing on submit.
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp('[A-Za-z0-9]')),
              ],
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              activeThumbColor: kGold,
              title: const Text(
                'Private group',
                style: TextStyle(color: Colors.white, fontSize: 14),
              ),
              subtitle: const Text(
                'Members need the password to join',
                style: TextStyle(color: kMuted, fontSize: 12),
              ),
              value: _isPrivate,
              onChanged: _submitting
                  ? null
                  : (value) => setState(() => _isPrivate = value),
            ),
            if (_isPrivate)
              _field(
                label: 'Group Password',
                controller: _password,
                hint: '••••••••',
                obscure: true,
              ),
            const SizedBox(height: 4),
            const Text(
              'Team color',
              style: TextStyle(
                color: Colors.white,
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 10,
              children: [
                for (final hex in kGroupColors)
                  Semantics(
                    label: 'Team color $hex',
                    selected: hex == _color,
                    button: true,
                    child: GestureDetector(
                      onTap: () => setState(() => _color = hex),
                      child: Container(
                        width: 32,
                        height: 32,
                        decoration: BoxDecoration(
                          color: _hexColor(hex),
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: hex == _color ? Colors.white : Colors.transparent,
                            width: 2.5,
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: _submitting ? null : () => Navigator.of(context).pop(),
                  child: const Text('Cancel', style: TextStyle(color: kMuted)),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  onPressed: _submitting ? null : _submit,
                  style: FilledButton.styleFrom(
                    backgroundColor: kGold,
                    foregroundColor: kBackground,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                  child: Text(
                    _submitting ? 'Creating…' : 'Create',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _field({
    required String label,
    required TextEditingController controller,
    required String hint,
    bool obscure = false,
    List<TextInputFormatter>? inputFormatters,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 12,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 6),
          TextField(
            controller: controller,
            obscureText: obscure,
            enabled: !_submitting,
            inputFormatters: inputFormatters,
            style: const TextStyle(color: Color(0xFFF0F0F0)),
            decoration: InputDecoration(
              filled: true,
              fillColor: kBackground,
              hintText: hint,
              hintStyle: const TextStyle(color: Color(0xFF5C5C5E), fontSize: 13),
              isDense: true,
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 12,
                vertical: 12,
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: BorderSide.none,
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: kGold, width: 1.5),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
