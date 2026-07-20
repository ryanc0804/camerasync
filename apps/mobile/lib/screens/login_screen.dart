import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../auth/auth_service.dart';

/// Sign-in / create-account screen, mirroring the web app's two modes and
/// client-side validation so both clients behave the same way.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.auth});

  final AuthService auth;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  bool _isSignup = false;
  bool _submitting = false;
  String? _error;

  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  void _switchMode() {
    setState(() {
      _isSignup = !_isSignup;
      _error = null;
      _password.clear();
      _confirm.clear();
    });
  }

  String? _validate() {
    if (_email.text.trim().isEmpty) return 'Please enter your email.';
    if (_isSignup && _name.text.trim().isEmpty) return 'Please enter your name.';
    if (_password.text.isEmpty) return 'Please enter your password.';
    if (_isSignup && _password.text.length < 8) {
      return 'Password must be at least 8 characters.';
    }
    if (_isSignup && _password.text != _confirm.text) {
      return 'Passwords do not match.';
    }
    return null;
  }

  Future<void> _submit() async {
    final validationError = _validate();
    if (validationError != null) {
      setState(() => _error = validationError);
      return;
    }

    setState(() {
      _error = null;
      _submitting = true;
    });

    try {
      if (_isSignup) {
        await widget.auth.register(
          name: _name.text.trim(),
          email: _email.text.trim(),
          password: _password.text,
        );
      } else {
        await widget.auth.login(
          email: _email.text.trim(),
          password: _password.text,
        );
      }
      // On success AuthService notifies and the app swaps to the join screen.
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Something went wrong. Please try again.');
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0D0D),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 380),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'KnightHyve',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 30,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFFFFC72C),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _isSignup ? 'Create your account' : 'Sign in to your account',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Color(0xFF999999)),
                  ),
                  const SizedBox(height: 20),

                  if (_error != null) ...[
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFF2A1A1A),
                        border: Border.all(color: const Color(0xFF5A2A2A)),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        _error!,
                        style: const TextStyle(color: Color(0xFFFF8A80)),
                      ),
                    ),
                    const SizedBox(height: 14),
                  ],

                  if (_isSignup) ...[
                    _field(controller: _name, label: 'Name'),
                    const SizedBox(height: 12),
                  ],

                  _field(
                    controller: _email,
                    label: 'Email',
                    keyboardType: TextInputType.emailAddress,
                  ),
                  const SizedBox(height: 12),

                  _field(
                    controller: _password,
                    label: 'Password',
                    obscure: true,
                  ),

                  if (_isSignup) ...[
                    const SizedBox(height: 12),
                    _field(
                      controller: _confirm,
                      label: 'Confirm password',
                      obscure: true,
                    ),
                  ],

                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: _submitting ? null : _submit,
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFFFFC72C),
                      foregroundColor: const Color(0xFF0D0D0D),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                    child: Text(
                      _submitting
                          ? 'Please wait…'
                          : _isSignup
                              ? 'Create account'
                              : 'Sign in',
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                  ),

                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: _submitting ? null : _switchMode,
                    child: Text(
                      _isSignup
                          ? 'Already have an account? Sign in'
                          : 'New to KnightHyve? Create one',
                      style: const TextStyle(color: Color(0xFFFFC72C)),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _field({
    required TextEditingController controller,
    required String label,
    bool obscure = false,
    TextInputType? keyboardType,
  }) {
    return TextField(
      controller: controller,
      obscureText: obscure,
      keyboardType: keyboardType,
      style: const TextStyle(color: Color(0xFFF0F0F0)),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: Color(0xFF999999)),
        filled: true,
        fillColor: const Color(0xFF262626),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: Color(0xFF3A3A3A)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: Color(0xFFFFC72C), width: 2),
        ),
      ),
    );
  }
}
