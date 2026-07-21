import 'package:flutter/foundation.dart';

import '../api/api_client.dart';

/// The signed-in user, as returned by the server's `publicUser` shape.
class AppUser {
  const AppUser({required this.id, required this.email, this.name});

  final int id;
  final String email;
  final String? name;

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
        id: json['id'] as int,
        email: json['email'] as String,
        name: json['name'] as String?,
      );

  String get displayName => (name != null && name!.isNotEmpty) ? name! : email;
}

/// Holds auth state for the app. Exposed as a ValueNotifier so widgets can
/// rebuild via ValueListenableBuilder without pulling in a state-management
/// package.
class AuthService extends ChangeNotifier {
  AuthService(this._api);

  final ApiClient _api;

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
