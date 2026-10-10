import 'dart:async';

import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/notifications_api.dart';
import '../auth/auth_service.dart';

/// Phone notifications for what happens in the user's groups: comments on
/// recordings, people joining and practices starting, filtered by the
/// switches in Settings (saved on the account).
///
/// The app checks the notifications feed every minute while it is open or
/// in the background. Alerts while the app is fully closed need push through
/// Firebase Cloud Messaging, which needs a Firebase project for the app; the
/// same saved switches will apply to it.
class PhoneAlerts {
  PhoneAlerts(this._auth);

  final AuthService _auth;
  final _plugin = FlutterLocalNotificationsPlugin();
  Timer? _timer;
  bool _ready = false;

  static const _seenKey = 'phoneAlerts.lastAlertedAt';
  static const _checkEvery = Duration(minutes: 1);

  static const _channel = AndroidNotificationDetails(
    'group-activity',
    'Group activity',
    channelDescription: 'Comments, people joining and practices starting',
    importance: Importance.high,
    priority: Priority.high,
  );

  Future<void> start() async {
    if (!_ready) {
      await _plugin.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        ),
      );
      _ready = true;
    }
    _timer?.cancel();
    _timer = Timer.periodic(_checkEvery, (_) => check());
    unawaited(check());
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  /// Asks Android 13+ for permission to show notifications. Returns whether
  /// they're allowed.
  Future<bool> requestPermission() async {
    final android = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    return await android?.requestNotificationsPermission() ?? true;
  }

  /// Shows anything new since the last check that the user wants to hear
  /// about. The first check only notes the time, so a fresh install doesn't
  /// replay old activity.
  Future<void> check() async {
    final user = _auth.user;
    if (user == null) return;
    final store = await SharedPreferences.getInstance();
    final last = store.getInt(_seenKey);
    final now = DateTime.now().millisecondsSinceEpoch;
    if (last == null) {
      await store.setInt(_seenKey, now);
      return;
    }

    List<AppNotification> items;
    try {
      items = await NotificationsApi(_auth.api).getNotifications(limit: 20);
    } catch (_) {
      return; // Offline or signed out; try again next minute.
    }

    final prefs = user.notificationPrefs;
    final fresh = items
        .where((n) => n.at.millisecondsSinceEpoch > last)
        .toList()
      ..sort((a, b) => a.at.compareTo(b.at));
    if (fresh.isEmpty) return;
    await store.setInt(_seenKey, fresh.last.at.millisecondsSinceEpoch);
    if (prefs['push'] == false) return;

    for (final n in fresh) {
      if (!wanted(n, prefs)) continue;
      await _plugin.show(
        id: n.id.hashCode,
        title: alertTitle(n),
        body: alertBody(n),
        notificationDetails: const NotificationDetails(android: _channel),
      );
    }
  }
}

/// Whether the user's switches let [n] through.
bool wanted(AppNotification n, Map<String, bool> prefs) {
  if (prefs['push'] == false) return false;
  final kind = switch (n.type) {
    'comment' => 'comments',
    'join' => 'joins',
    _ => 'sessions',
  };
  return prefs[kind] != false;
}

String alertTitle(AppNotification n) => switch (n.type) {
      'comment' => '${n.actorName} commented on ${n.sessionName ?? 'a recording'}',
      'join' => '${n.actorName} joined ${n.groupName}',
      _ => n.isLivePractice
          ? '${n.actorName} started ${n.sessionName ?? 'a practice'}. Join now'
          : '${n.actorName} started ${n.sessionName ?? 'a practice'}',
    };

String? alertBody(AppNotification n) =>
    n.type == 'comment' ? '"${n.commentBody}"' : n.groupName;
