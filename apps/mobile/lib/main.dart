import 'package:flutter/material.dart';

import 'api/api_client.dart';
import 'auth/auth_service.dart';
import 'screens/login_screen.dart';
import 'screens/session_screen.dart';

// Point at your running server. For Android emulator use 10.0.2.2 to reach the
// host machine; on a physical device use your computer's LAN IP.
const String kServerUrl = String.fromEnvironment(
  'SERVER_URL',
  defaultValue: 'http://10.0.2.2:4000',
);

void main() {
  final auth = AuthService(ApiClient(kServerUrl));
  // Fire-and-forget: the UI shows a spinner while `loading` is true.
  auth.restoreSession();
  runApp(CameraSyncApp(auth: auth));
}

class CameraSyncApp extends StatelessWidget {
  const CameraSyncApp({super.key, required this.auth});

  final AuthService auth;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'KnightHyve',
      theme: ThemeData(
        colorSchemeSeed: const Color(0xFFFFC72C),
        brightness: Brightness.dark,
        useMaterial3: true,
      ),
      home: AuthGate(auth: auth),
    );
  }
}

/// Shows the login screen until signed in, then the session join screen.
class AuthGate extends StatelessWidget {
  const AuthGate({super.key, required this.auth});

  final AuthService auth;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: auth,
      builder: (context, _) {
        if (auth.loading) {
          return const Scaffold(
            backgroundColor: Color(0xFF0D0D0D),
            body: Center(child: CircularProgressIndicator()),
          );
        }
        return auth.isAuthenticated
            ? JoinScreen(auth: auth)
            : LoginScreen(auth: auth);
      },
    );
  }
}

/// Simple join form: enter a session ID + device name, then go to the
/// recording screen.
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
    final user = widget.auth.user;

    return Scaffold(
      appBar: AppBar(
        title: const Text('KnightHyve'),
        actions: [
          IconButton(
            tooltip: 'Log out',
            icon: const Icon(Icons.logout),
            onPressed: widget.auth.logout,
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (user != null) ...[
              Text(
                'Signed in as ${user.displayName}',
                style: const TextStyle(color: Color(0xFF999999)),
              ),
              const SizedBox(height: 20),
            ],
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
