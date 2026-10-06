import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:camerasync_mobile/api/api_client.dart';
import 'package:camerasync_mobile/auth/auth_service.dart';
import 'package:camerasync_mobile/main.dart';
import 'package:camerasync_mobile/screens/login_screen.dart';

/// Scripted server for sign-up and email confirmation: "123456" is the
/// emailed code. Holds just enough state to drive the AuthGate.
class _FakeApi extends ApiClient {
  _FakeApi() : super('http://test');

  final calls = <String>[];
  bool verified = false;

  Map<String, dynamic> get _user => {
        'id': 1,
        'email': 'coach@ucf.edu',
        'name': 'Coach',
        'emailVerified': verified,
      };

  @override
  Future<dynamic> get(String path) async {
    calls.add('GET $path');
    if (path == '/api/auth/me') return {'user': _user};
    // HomeShell loads data once unlocked; empty answers are enough.
    if (path == '/api/groups') return {'groups': []};
    if (path.startsWith('/api/recordings')) {
      return {'sessions': [], 'count': 0, 'recordings': []};
    }
    throw ApiException(404, 'Unexpected GET $path');
  }

  @override
  Future<dynamic> post(String path, [Map<String, dynamic>? body]) async {
    calls.add(path);
    switch (path) {
      case '/api/auth/register':
        return {'user': _user};
      case '/api/auth/verify-email':
        if (body?['code'] != '123456') {
          throw ApiException(400, "That code isn't right. Check the email and try again.");
        }
        verified = true;
        return {'user': _user};
      case '/api/auth/resend-verification':
        return null;
      case '/api/auth/logout':
        return null;
    }
    throw ApiException(404, 'Unexpected POST $path');
  }

  @override
  Future<void> clearCookie() async {}
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  // Starts the app the way main() does, signed in as a fresh, unconfirmed
  // account.
  Future<_FakeApi> signUp(WidgetTester tester) async {
    final api = _FakeApi();
    final auth = AuthService(api);
    await auth.restoreSession();
    await tester.pumpWidget(MaterialApp(home: AuthGate(auth: auth)));
    await tester.pumpAndSettle();
    return api;
  }

  testWidgets('an unconfirmed account sees only the confirm screen', (tester) async {
    await signUp(tester);

    expect(find.text('Confirm your email'), findsOneWidget);
    expect(find.textContaining('coach@ucf.edu'), findsOneWidget);
  });

  testWidgets('a wrong code shows the server message and stays put', (tester) async {
    final api = await signUp(tester);

    await tester.enterText(find.byType(TextField), '000000');
    await tester.pumpAndSettle();

    expect(find.text("That code isn't right. Check the email and try again."), findsOneWidget);
    expect(find.text('Confirm your email'), findsOneWidget);
    expect(api.verified, isFalse);
  });

  testWidgets('the right code unlocks the app', (tester) async {
    final api = await signUp(tester);

    await tester.enterText(find.byType(TextField), '123456');
    await tester.pumpAndSettle();

    expect(api.verified, isTrue);
    expect(find.text('Confirm your email'), findsNothing);
  });

  testWidgets('resend asks the server for a new code', (tester) async {
    final api = await signUp(tester);

    await tester.tap(find.text('Resend Code'));
    await tester.pumpAndSettle();

    expect(api.calls, contains('/api/auth/resend-verification'));
    expect(find.text('A new code is on its way.'), findsOneWidget);
  });

  testWidgets('sign-up refuses non-UCF emails before calling the server', (tester) async {
    final api = _FakeApi();
    await tester.pumpWidget(MaterialApp(home: LoginScreen(auth: AuthService(api))));

    await tester.tap(find.textContaining('Create one', findRichText: true));
    await tester.pumpAndSettle();

    final fields = find.byType(TextField);
    await tester.enterText(fields.at(0), 'Coach');
    await tester.enterText(fields.at(1), 'coach@gmail.com');
    await tester.enterText(fields.at(2), 'longpassword1');
    await tester.enterText(fields.at(3), 'longpassword1');
    await tester.tap(find.text('Create account'));
    await tester.pump();

    expect(
      find.text('Sign up with your UCF email (@ucf.edu or @knights.ucf.edu).'),
      findsOneWidget,
    );
    expect(api.calls, isEmpty);
  });
}
