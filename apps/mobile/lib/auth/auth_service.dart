import 'package:flutter/foundation.dart';

import '../api/api_client.dart';

/// The signed-in user, as returned by the server's `publicUser` shape.
class AppUser {
  const AppUser({
    required this.id,
    required this.email,
    this.name,
    this.emailVerified = true,
  });

  final int id;
  final String email;
  final String? name;

  /// False until the sign-up confirmation code is entered (SCRUM-43); the
  /// app shows only the confirm screen until then.
  final bool emailVerified;

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
        id: json['id'] as int,
        email: json['email'] as String,
        name: json['name'] as String?,
        // Only an explicit false locks the app, so a server that predates
        // confirmation never strands anyone on the confirm screen.
        emailVerified: json['emailVerified'] != false,
      );

  String get displayName => (name != null && name!.isNotEmpty) ? name! : email;
}

/// Holds auth state for the app. Exposed as a ValueNotifier so widgets can
/// rebuild via ValueListenableBuilder without pulling in a state-management
/// package.
class AuthService extends ChangeNotifier {
  AuthService(this._api);

  final ApiClient _api;

  /// The shared API client, so other services reuse the same session cookie.
  ApiClient get api => _api;

  AppUser? _user;
  bool _loading = true;

  AppUser? get user => _user;
  bool get isAuthenticated => _user != null;

  /// True until the initial session restore finishes.
  bool get loading => _loading;

  /// Restore a persisted session on start-up. A 401 just means signed out.
  Future<void> restoreSession() async {
    _loading = true;
    notifyListeners();

    try {
      await _api.loadPersistedCookie();
      final data = await _api.get('/api/auth/me');
      _user = AppUser.fromJson((data as Map)['user'] as Map<String, dynamic>);
    } on ApiException {
      _user = null;
    } catch (_) {
      _user = null;
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<void> login({required String email, required String password}) async {
    final data = await _api.post('/api/auth/login', {
      'email': email,
      'password': password,
    });
    _user = AppUser.fromJson((data as Map)['user'] as Map<String, dynamic>);
    notifyListeners();
  }

  Future<void> register({
    required String name,
    required String email,
    required String password,
  }) async {
    final data = await _api.post('/api/auth/register', {
      'name': name,
      'email': email,
      'password': password,
    });
    _user = AppUser.fromJson((data as Map)['user'] as Map<String, dynamic>);
    notifyListeners();
  }

  /// Confirm the signed-in account with the 6-digit code from the sign-up
  /// email. On success the user becomes verified and the app unlocks.
  Future<void> verifyEmail({required String code}) async {
    final data = await _api.post('/api/auth/verify-email', {'code': code});
    _user = AppUser.fromJson((data as Map)['user'] as Map<String, dynamic>);
    notifyListeners();
  }

  /// Email a fresh confirmation code to the signed-in, unconfirmed user.
  Future<void> resendVerification() async {
    await _api.post('/api/auth/resend-verification');
  }

  /// Start a password reset. The server answers 204 whether or not the email
  /// has an account, so this can't reveal which emails are registered.
  Future<void> forgotPassword({required String email}) async {
    await _api.post('/api/auth/forgot-password', {'email': email});
  }

  /// Exchange the emailed 6-digit code for a single-use reset token.
  Future<String> verifyResetCode({
    required String email,
    required String code,
  }) async {
    final data = await _api.post('/api/auth/verify-reset-code', {
      'email': email,
      'code': code,
    });
    return (data as Map)['token'] as String;
  }

  /// Complete the reset. The server deletes every session for the account, so
  /// the user signs in again with the new password afterwards.
  Future<void> resetPassword({
    required String token,
    required String password,
  }) async {
    await _api.post('/api/auth/reset-password', {
      'token': token,
      'password': password,
    });
  }

  Future<void> logout() async {
    try {
      await _api.post('/api/auth/logout');
    } catch (_) {
      // Sign out locally even if the request fails.
    } finally {
      await _api.clearCookie();
      _user = null;
      notifyListeners();
    }
  }
}
