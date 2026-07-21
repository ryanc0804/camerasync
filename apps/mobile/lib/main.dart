import 'package:flutter/material.dart';

import 'api/api_client.dart';
import 'auth/auth_service.dart';
import 'config.dart';
import 'screens/home_shell.dart';
import 'screens/login_screen.dart';

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
      title: '8kount',
      theme: ThemeData(
        colorSchemeSeed: kGold,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: kBackground,
        useMaterial3: true,
        inputDecorationTheme: const InputDecorationTheme(
          filled: true,
          fillColor: Color(0xFF262626),
        ),
      ),
      home: AuthGate(auth: auth),
    );
  }
}

/// Shows the login screen until signed in, then the tabbed app shell.
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
            backgroundColor: kBackground,
            body: Center(child: CircularProgressIndicator()),
          );
        }
        return auth.isAuthenticated
            ? HomeShell(auth: auth)
            : LoginScreen(auth: auth);
      },
    );
  }
}
