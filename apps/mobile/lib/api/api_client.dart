import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Thrown for non-2xx responses so callers can show the server's message.
class ApiException implements Exception {
  ApiException(this.statusCode, this.message);

  final int statusCode;
  final String message;

  @override
  String toString() => message;
}

/// Minimal HTTP client that carries the server's session cookie.
///
/// The browser does this automatically, but Dart's http package does not — so
/// we capture `Set-Cookie` from responses and replay it as a `Cookie` header on
/// later requests. The value is persisted so a session survives app restarts.
class ApiClient {
  ApiClient(this.baseUrl);

  final String baseUrl;

  static const _cookiePrefsKey = 'session_cookie';

  String? _cookie;

  /// Load any persisted cookie. Call once during app start-up.
  Future<void> loadPersistedCookie() async {
    final prefs = await SharedPreferences.getInstance();
    _cookie = prefs.getString(_cookiePrefsKey);
  }

  Future<void> _persistCookie(String? value) async {
    _cookie = value;
    final prefs = await SharedPreferences.getInstance();
    if (value == null) {
      await prefs.remove(_cookiePrefsKey);
    } else {
      await prefs.setString(_cookiePrefsKey, value);
    }
  }

  Map<String, String> _headers({bool json = false}) => {
        if (json) 'Content-Type': 'application/json',
        if (_cookie != null) 'Cookie': _cookie!,
      };

  /// Pull the session cookie out of `Set-Cookie` and store it. We only keep the
  /// `name=value` pair — attributes like Path/HttpOnly aren't sent back.
  Future<void> _captureCookie(http.Response res) async {
    final raw = res.headers['set-cookie'];
    if (raw == null || raw.isEmpty) return;
    final pair = raw.split(';').first.trim();
    if (pair.isEmpty) return;
    if (pair.startsWith('session=')) {
      // An empty value means the server cleared it (logout).
      final value = pair.substring('session='.length);
      await _persistCookie(value.isEmpty ? null : pair);
    }
  }

  Future<dynamic> get(String path) => _send('GET', path);

  Future<dynamic> post(String path, [Map<String, dynamic>? body]) =>
      _send('POST', path, body);

  Future<dynamic> _send(
    String method,
    String path, [
    Map<String, dynamic>? body,
  ]) async {
    final uri = Uri.parse('$baseUrl$path');
    late http.Response res;

    try {
      res = switch (method) {
        'POST' => await http.post(
            uri,
            headers: _headers(json: body != null),
            body: body == null ? null : jsonEncode(body),
          ),
        _ => await http.get(uri, headers: _headers()),
      };
    } catch (_) {
      throw ApiException(0, "Can't reach the server at $baseUrl.");
    }

    await _captureCookie(res);

    if (res.statusCode == 204 || res.body.isEmpty) {
      if (res.statusCode >= 400) {
        throw ApiException(res.statusCode, 'Request failed (${res.statusCode})');
      }
      return null;
    }

    dynamic data;
    try {
      data = jsonDecode(res.body);
    } catch (_) {
      data = null;
    }

    if (res.statusCode >= 400) {
      final message = data is Map && data['error'] is String
          ? data['error'] as String
          : 'Request failed (${res.statusCode})';
      throw ApiException(res.statusCode, message);
    }

    return data;
  }

  /// Forget the session locally (used on logout).
  Future<void> clearCookie() => _persistCookie(null);
}
