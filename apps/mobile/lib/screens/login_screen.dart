import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../auth/auth_service.dart';
import '../theme.dart';

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
      // On success AuthService notifies and the app swaps to the home shell.
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
      backgroundColor: kBackground,
      body: SafeArea(
        // Spacer-based layout pins the button to the bottom like the design,
        // while still scrolling when the keyboard shrinks the viewport.
        child: LayoutBuilder(
          builder: (context, constraints) {
            return SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: constraints.maxHeight),
                child: IntrinsicHeight(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Spacer(flex: 3),
                      const Text(
                        '8kount',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 48,
                          fontWeight: FontWeight.w800,
                          color: kGold,
                          letterSpacing: -1,
                        ),
                      ),
                      const Spacer(flex: 2),

                      if (_error != null) ...[
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: const Color(0xFF2A1A1A),
                            border: Border.all(color: const Color(0xFF5A2A2A)),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            _error!,
                            style: const TextStyle(color: Color(0xFFFF8A80)),
                          ),
                        ),
                        const SizedBox(height: 16),
                      ],

                      if (_isSignup)
                        _labeledField(controller: _name, label: 'Name'),

                      _labeledField(
                        controller: _email,
                        label: 'Username/Email',
                        keyboardType: TextInputType.emailAddress,
                      ),

                      _labeledField(
                        controller: _password,
                        label: 'Password',
                        obscure: true,
                      ),

                      if (_isSignup)
                        _labeledField(
                          controller: _confirm,
                          label: 'Confirm password',
                          obscure: true,
                        ),

                      const Spacer(flex: 6),

                      FilledButton(
                        onPressed: _submitting ? null : _submit,
                        style: FilledButton.styleFrom(
                          backgroundColor: kGold,
                          foregroundColor: kBackground,
                          shape: const StadiumBorder(),
                          padding: const EdgeInsets.symmetric(vertical: 17),
                        ),
                        child: Text(
                          _submitting
                              ? 'Please wait…'
                              : _isSignup
                                  ? 'Create account'
                                  : 'Sign in',
                          style: const TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      const SizedBox(height: 14),

                      Center(
                        child: TextButton(
                          onPressed: _submitting ? null : _switchMode,
                          child: Text.rich(
                            TextSpan(
                              text: _isSignup
                                  ? 'Already have an account? '
                                  : "Don't have an account? ",
                              style: const TextStyle(color: Colors.white),
                              children: [
                                TextSpan(
                                  text: _isSignup ? 'Sign in' : 'Create one',
                                  style: const TextStyle(
                                    color: kGold,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _labeledField({
    required TextEditingController controller,
    required String label,
    bool obscure = false,
    TextInputType? keyboardType,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 17,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: controller,
            obscureText: obscure,
            keyboardType: keyboardType,
            style: const TextStyle(color: Color(0xFFF0F0F0)),
            decoration: InputDecoration(
              filled: true,
              fillColor: kSurface,
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 18,
                vertical: 19,
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(16),
                borderSide: BorderSide.none,
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(16),
                borderSide: const BorderSide(color: kGold, width: 1.5),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
