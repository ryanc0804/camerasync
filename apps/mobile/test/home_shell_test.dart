import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:camerasync_mobile/api/api_client.dart';
import 'package:camerasync_mobile/auth/auth_service.dart';
import 'package:camerasync_mobile/screens/home_shell.dart';

void main() {
  setUp(() {
    TestWidgetsFlutterBinding.ensureInitialized();
    SharedPreferences.setMockInitialValues({});
  });

  Widget wrap(Widget child) => MaterialApp(home: child);

  testWidgets('shell shows all five nav destinations', (tester) async {
    final auth = AuthService(ApiClient('http://127.0.0.1:1'));
    await tester.pumpWidget(wrap(HomeShell(auth: auth)));

    expect(find.byIcon(Icons.groups), findsOneWidget);
    expect(find.byIcon(Icons.photo_camera_outlined), findsOneWidget);
    expect(find.byIcon(Icons.home_outlined), findsOneWidget);
    expect(find.byIcon(Icons.calendar_month_outlined), findsOneWidget);
    expect(find.byIcon(Icons.settings_outlined), findsOneWidget);
  });

  testWidgets('opens on Home and switches tabs when tapped', (tester) async {
    final auth = AuthService(ApiClient('http://127.0.0.1:1'));
    await tester.pumpWidget(wrap(HomeShell(auth: auth)));

    // Home is the default tab per the design.
    expect(find.byKey(const ValueKey('home-tab')), findsOneWidget);

    await tester.tap(find.byIcon(Icons.groups));
    await tester.pumpAndSettle();
    expect(find.text('Groups'), findsWidgets);

    await tester.tap(find.byIcon(Icons.settings_outlined));
    await tester.pumpAndSettle();
    expect(find.text('Log out'), findsOneWidget);
  });
}
