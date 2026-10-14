import 'dart:async';

import 'package:external_display/external_display.dart';
import 'package:flutter/foundation.dart';

import 'tv_protocol.dart';

/// The phone's side of TV mode. When a TV is plugged in (HDMI, or a
/// wireless display), this opens the app's TV screen on it; playback then
/// runs there and the phone becomes the remote. Unplugging closes it.
///
/// Not used when the app itself is on the big screen (Samsung DeX): it
/// already shows the full grid there.
class TvLink extends ChangeNotifier {
  TvLink._();

  static final instance = TvLink._();

  bool _started = false;
  bool _connecting = false;
  bool _suppressed = false;

  /// The TV screen is up and taking messages.
  bool get connected => _connected;
  bool _connected = false;

  final _states = StreamController<TvState>.broadcast();

  /// What the TV reports: position, page count and so on.
  Stream<TvState> get states => _states.stream;

  void start() {
    if (_started) return;
    _started = true;
    externalDisplay.addStatusListener(_onStatus);
    externalDisplay.addReceiveParameterListener(_onMessage);
    if (externalDisplay.isPlugging) _onStatus(true);
  }

  /// True while the app is running on a big screen itself (DeX).
  set suppressed(bool value) {
    if (value == _suppressed) return;
    _suppressed = value;
    if (value) {
      _close();
    } else if (externalDisplay.isPlugging) {
      _onStatus(true);
    }
  }

  Future<void> _onStatus(dynamic plugged) async {
    if (plugged == true) {
      if (_connected || _connecting || _suppressed) return;
      _connecting = true;
      try {
        await externalDisplay.connect();
        await externalDisplay.waitingTransferParametersReady(
          onReady: () {
            _connected = true;
            notifyListeners();
          },
        );
      } catch (e) {
        debugPrint('TV screen did not open: $e');
      } finally {
        _connecting = false;
      }
    } else {
      await _close();
    }
  }

  Future<void> _close() async {
    if (!_connected) return;
    _connected = false;
    notifyListeners();
    try {
      await externalDisplay.disconnect();
    } catch (_) {}
  }

  void _onMessage({required String action, dynamic value}) {
    if (action == TvAction.state) {
      final state = TvState.fromMap(value);
      if (state != null) _states.add(state);
    }
  }

  /// Sends one message to the TV (dropped when none is connected).
  Future<void> send(String action, [Object? value]) async {
    if (!_connected) return;
    try {
      await externalDisplay.sendParameters(action: action, value: value);
    } catch (_) {}
  }
}
