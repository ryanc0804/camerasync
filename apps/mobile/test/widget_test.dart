import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:camerasync_mobile/api/api_client.dart';
import 'package:camerasync_mobile/auth/auth_service.dart';
import 'package:camerasync_mobile/main.dart';

void main() {
  testWidgets('signed-out users see the login screen', (tester) async {
    TestWidgetsFlutterBinding.ensureInitialized();
    SharedPreferences.setMockInitialValues({});

    // Port 1 is unreachable, so /me fails and we land in the signed-out state.
    final auth = AuthService(ApiClient('http://127.0.0.1:1'));
    await auth.restoreSession();

    await tester.pumpWidget(CameraSyncApp(auth: auth));
    await tester.pumpAndSettle();

    expect(auth.isAuthenticated, isFalse);
    expect(find.text('8kount'), findsOneWidget);
    expect(find.text('Sign in'), findsOneWidget);
    expect(find.text('New to 8kount? Create one'), findsOneWidget);
  });
}
