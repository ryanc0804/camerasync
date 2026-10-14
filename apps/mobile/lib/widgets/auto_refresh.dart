import 'dart:async';

import 'package:flutter/widgets.dart';

/// Calls [refresh] every [every] while the app is on screen, and right away
/// when the user comes back to it, so lists (a practice that just started,
/// new recordings) update without pulling down. Stops while the app is in
/// the background. Create it in initState and dispose it in dispose.
class AutoRefresher {
  AutoRefresher(this.every, this.refresh) {
    _lifecycle = AppLifecycleListener(
      onShow: () {
        refresh();
        _start();
      },
      onHide: _stop,
    );
    _start();
  }

  final Duration every;
  final Future<void> Function() refresh;

  Timer? _timer;
  late final AppLifecycleListener _lifecycle;

  void _start() => _timer ??= Timer.periodic(every, (_) => refresh());

  void _stop() {
    _timer?.cancel();
    _timer = null;
  }

  void dispose() {
    _stop();
    _lifecycle.dispose();
  }
}
