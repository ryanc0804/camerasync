import 'package:flutter/material.dart';

import 'screens/session_screen.dart';

// Point at your running server. For Android emulator use 10.0.2.2 to reach the
// host machine; on a physical device use your computer's LAN IP.
const String kServerUrl = String.fromEnvironment(
  'SERVER_URL',
  defaultValue: 'http://10.0.2.2:4000',
);

void main() {
  runApp(const CameraSyncApp());
}

class CameraSyncApp extends StatelessWidget {
  const CameraSyncApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Camera Sync',
      theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
      home: const JoinScreen(),
    );
  }
}

/// Simple join form: enter a session ID + device name, then go to the
/// recording screen. Replace with real auth + group/session selection later.
class JoinScreen extends StatefulWidget {
  const JoinScreen({super.key});

  @override
  State<JoinScreen> createState() => _JoinScreenState();
}

class _JoinScreenState extends State<JoinScreen> {
  final _sessionController = TextEditingController(text: 'demo-session');
  final _deviceController = TextEditingController(text: 'My phone');

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
    return Scaffold(
      appBar: AppBar(title: const Text('Camera Sync')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
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
        ),
      ),
    );
  }
}
