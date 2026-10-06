import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/api_client.dart';
import '../auth/auth_service.dart';
import '../theme.dart';

const _codeLength = 6;

/// "Confirm your email" (SCRUM-43): shown instead of the app to a signed-in
/// user who hasn't confirmed their address yet. They type the 6-digit code
/// from the sign-up email, ask for a new one, or sign out. Styled like the
/// Enter Code step of the forgot-password flow.
class VerifyEmailScreen extends StatefulWidget {
  const VerifyEmailScreen({super.key, required this.auth});

  final AuthService auth;

  @override
  State<VerifyEmailScreen> createState() => _VerifyEmailScreenState();
}

class _VerifyEmailScreenState extends State<VerifyEmailScreen> {
  final _code = TextEditingController();
  final _codeFocus = FocusNode();
  bool _submitting = false;
  String? _error;
  String? _notice;

  @override
  void dispose() {
    _code.dispose();
    _codeFocus.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _error = null;
      _notice = null;
      _submitting = true;
    });
    try {
      await action();
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

  Future<void> _verify() async {
    if (_code.text.length != _codeLength) {
      setState(() => _error = 'Enter the 6-digit code from the email.');
      return;
    }
    await _run(() async {
      try {
        // Success flips the user to verified and AuthGate swaps in the app.
        await widget.auth.verifyEmail(code: _code.text);
      } on ApiException {
        _code.clear();
        rethrow;
      }
    });
  }

  Future<void> _resend() async {
    await _run(() async {
      await widget.auth.resendVerification();
      _code.clear();
      if (mounted) {
        setState(() => _notice = 'A new code is on its way.');
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final email = widget.auth.user?.email ?? 'your email';
    return Scaffold(
      backgroundColor: kBackground,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 36),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 76),
              const Text(
                'Confirm your email',
                style: TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.w800,
                  color: kGold,
                ),
              ),
              const SizedBox(height: 13),
              Text.rich(
                TextSpan(
                  text: 'We sent a 6-digit code to ',
                  style: const TextStyle(fontSize: 13, color: kMuted),
                  children: [
                    TextSpan(
                      text: email,
                      style: const TextStyle(color: Colors.white),
                    ),
                    const TextSpan(text: '. Enter it below.'),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              if (_error != null) _messageBox(_error!, isError: true),
              if (_notice != null) _messageBox(_notice!, isError: false),
              const SizedBox(height: 12),
              _codeBoxes(),
              const SizedBox(height: 28),
              FilledButton(
                onPressed: _submitting ? null : _verify,
                style: FilledButton.styleFrom(
                  backgroundColor: kGold,
                  foregroundColor: kBackground,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  minimumSize: const Size.fromHeight(48),
                ),
                child: Text(
                  _submitting ? 'Please wait…' : 'Confirm',
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(height: 14),
              Center(
                child: TextButton(
                  onPressed: _submitting ? null : _resend,
                  child: const Text(
                    'Resend Code',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                      color: kGold,
                    ),
                  ),
                ),
              ),
              Center(
                child: TextButton(
                  onPressed: _submitting ? null : widget.auth.logout,
                  child: const Text(
                    'Use a different account',
                    style: TextStyle(fontSize: 13, color: kMuted),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Six display boxes over one invisible text field, so the code is a
  /// single string and paste, backspace and autofill behave normally.
  Widget _codeBoxes() {
    return SizedBox(
      height: 52,
      child: Stack(
        children: [
          Positioned.fill(
            child: Opacity(
              opacity: 0,
              child: TextField(
                controller: _code,
                focusNode: _codeFocus,
                autofocus: true,
                keyboardType: TextInputType.number,
                autofillHints: const [AutofillHints.oneTimeCode],
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(_codeLength),
                ],
                onChanged: (value) {
                  setState(() {});
                  // Typing or pasting the last digit submits straight away.
                  if (value.length == _codeLength && !_submitting) _verify();
                },
              ),
            ),
          ),
          IgnorePointer(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: List.generate(_codeLength, (i) {
                final filled = i < _code.text.length;
                return Container(
                  width: 42,
                  height: 52,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: kSurface,
                    borderRadius: BorderRadius.circular(10),
                    border: _codeFocus.hasFocus && i == _code.text.length
                        ? Border.all(color: kGold, width: 1.5)
                        : null,
                  ),
                  child: Text(
                    filled ? _code.text[i] : '',
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w600,
                      color: Colors.white,
                    ),
                  ),
                );
              }),
            ),
          ),
        ],
      ),
    );
  }

  Widget _messageBox(String text, {required bool isError}) {
    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isError ? const Color(0xFF2A1A1A) : kSurface,
        border: Border.all(
          color: isError ? const Color(0xFF5A2A2A) : kGold,
        ),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        text,
        style: TextStyle(color: isError ? const Color(0xFFFF8A80) : kGold),
      ),
    );
  }
}
