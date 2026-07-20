import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../config.dart';
import 'session_screen.dart';

/// Record tab: pick a session to join, then hand off to the recording view.
class JoinScreen extends StatefulWidget {
  const JoinScreen({super.key, required this.auth});

  final AuthService auth;

  @override
  State<JoinScreen> createState() => _JoinScreenState();
}

class _JoinScreenState extends State<JoinScreen> {
  final _sessionController = TextEditingController(text: 'demo-session');
  late final TextEditingController _deviceController = TextEditingController(
    text: widget.auth.user?.displayName ?? 'My phone',
  );

  @override
  void dispose() {
    _sessionController.dispose();
    _deviceController.dispose();
    super.dispose();
  }

  void _join() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => SessionScreen(
          serverUrl: kServerUrl,
          sessionId: _sessionController.text.trim(),
          deviceName: _deviceController.text.trim(),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 110),
      children: [
        const Text(
          'Record',
          style: TextStyle(
            color: Colors.white,
            fontSize: 22,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 6),
        const Text(
          'Join a session, then wait for the admin to start recording.',
          style: TextStyle(color: Color(0xFF8A8A8A), height: 1.5),
        ),
        const SizedBox(height: 24),
        TextField(
          controller: _sessionController,
          decoration: const InputDecoration(labelText: 'Session ID'),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _deviceController,
          decoration: const InputDecoration(labelText: 'Device name'),
        ),
        const SizedBox(height: 24),
        FilledButton(onPressed: _join, child: const Text('Join session')),
      ],
    );
  }
}
