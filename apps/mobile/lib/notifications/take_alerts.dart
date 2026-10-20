import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// The phone notification for a camera that left the app mid-take. Shown
/// only if notifications are allowed (Settings asks); otherwise the message
/// on returning to the app is all they get.
class TakeAlerts {
  TakeAlerts._();

  static final _plugin = FlutterLocalNotificationsPlugin();
  static bool _ready = false;

  static const _details = NotificationDetails(
    android: AndroidNotificationDetails(
      'recording',
      'Recording',
      channelDescription: 'When this phone stops recording a take',
      importance: Importance.high,
      priority: Priority.high,
      icon: 'ic_stat_8kount',
    ),
    iOS: DarwinNotificationDetails(),
  );

  static Future<void> recordingStopped() async {
    try {
      if (!_ready) {
        await _plugin.initialize(
          settings: const InitializationSettings(
            android: AndroidInitializationSettings('ic_stat_8kount'),
            iOS: DarwinInitializationSettings(
              requestAlertPermission: false,
              requestBadgePermission: false,
              requestSoundPermission: false,
            ),
          ),
        );
        _ready = true;
      }
      await _plugin.show(
        id: 8001,
        title: 'Recording stopped',
        body: 'You left 8kount, so this phone stopped recording. '
            'Open it to rejoin for the next take.',
        notificationDetails: _details,
      );
    } catch (_) {
      // Not allowed or not available; the in-app message still shows.
    }
  }
}
