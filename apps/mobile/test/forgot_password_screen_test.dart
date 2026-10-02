import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:camerasync_mobile/api/api_client.dart';
import 'package:camerasync_mobile/auth/auth_service.dart';
import 'package:camerasync_mobile/screens/forgot_password_screen.dart';
import 'package:camerasync_mobile/screens/login_screen.dart';

/// Scripted server for the reset flow: "123456" is the valid emailed code and
/// "tok" the reset token it grants.
class _FakeApi extends ApiClient {
  _FakeApi() : super('http://test');

  final calls = <String>[];

  @override
  Future<dynamic> post(String path, [Map<String, dynamic>? body]) async {
    calls.add(path);
    switch (path) {
      case '/api/auth/forgot-password':
        return null;
      case '/api/auth/verify-reset-code':
        if (body?['code'] == '123456') return {'token': 'tok'};
        throw ApiException(400, 'That code is invalid or has expired.');
      case '/api/auth/reset-password':
        if (body?['token'] == 'tok') return null;
        throw ApiException(400, 'This reset link is invalid or has expired.');
    }
    throw ApiException(404, 'Unexpected call to $path');
  }
}

void main() {
  Widget wrap(Widget child) => MaterialApp(home: child);

  testWidgets('login screen offers Forgot Password? and opens the flow',
      (tester) async {
    final auth = AuthService(_FakeApi());
    await tester.pumpWidget(wrap(LoginScreen(auth: auth)));

    await tester.tap(find.text('Forgot Password?'));
    await tester.pumpAndSettle();

    expect(find.byType(ForgotPasswordScreen), findsOneWidget);
    expect(find.text('Forgot Password'), findsOneWidget);
    expect(find.text('Send Code'), findsOneWidget);
  });

  testWidgets('requires an email before sending a code', (tester) async {
    final auth = AuthService(_FakeApi());
    await tester.pumpWidget(wrap(ForgotPasswordScreen(auth: auth)));

    await tester.tap(find.text('Send Code'));
    await tester.pump();

    expect(find.text('Please enter your email.'), findsOneWidget);
  });

  testWidgets('full reset: email, code, new password, back to sign in',
      (tester) async {
    final api = _FakeApi();
    final auth = AuthService(api);
    await tester.pumpWidget(wrap(LoginScreen(auth: auth)));

    await tester.tap(find.text('Forgot Password?'));
    await tester.pumpAndSettle();

    // Step 1: email.
    await tester.enterText(find.byType(TextField), 'ryan@example.com');
    await tester.tap(find.text('Send Code'));
    await tester.pumpAndSettle();
    expect(find.text('Enter Code'), findsOneWidget);

    // Step 2: the 6-digit code (one hidden field renders the six boxes).
    await tester.enterText(find.byType(TextField), '123456');
    await tester.tap(find.text('Verify'));
    await tester.pumpAndSettle();
    expect(find.text('Reset Password'), findsWidgets);

    // Step 3: new password, confirmed.
    await tester.enterText(find.byType(TextField).at(0), 'newpassword1');
    await tester.enterText(find.byType(TextField).at(1), 'newpassword1');
    await tester.tap(find.widgetWithText(FilledButton, 'Reset Password'));
    await tester.pumpAndSettle();

    // Back on sign-in with the confirmation notice.
    expect(find.byType(ForgotPasswordScreen), findsNothing);
    expect(
      find.text('Password reset. Sign in with your new password.'),
      findsOneWidget,
    );
    expect(api.calls, [
      '/api/auth/forgot-password',
      '/api/auth/verify-reset-code',
      '/api/auth/reset-password',
    ]);
  });

  testWidgets('wrong code shows the server message and stays on the step',
      (tester) async {
    final auth = AuthService(_FakeApi());
    await tester.pumpWidget(wrap(ForgotPasswordScreen(auth: auth)));

    await tester.enterText(find.byType(TextField), 'ryan@example.com');
    await tester.tap(find.text('Send Code'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), '000000');
    await tester.tap(find.text('Verify'));
    await tester.pumpAndSettle();

    expect(find.text('That code is invalid or has expired.'), findsOneWidget);
    expect(find.text('Enter Code'), findsOneWidget);
  });

  testWidgets('rejects short and mismatched new passwords', (tester) async {
    final auth = AuthService(_FakeApi());
    await tester.pumpWidget(wrap(ForgotPasswordScreen(auth: auth)));

    await tester.enterText(find.byType(TextField), 'ryan@example.com');
    await tester.tap(find.text('Send Code'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '123456');
    await tester.tap(find.text('Verify'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).at(0), 'short');
    await tester.enterText(find.byType(TextField).at(1), 'short');
    await tester.tap(find.widgetWithText(FilledButton, 'Reset Password'));
    await tester.pump();
    expect(
      find.text('Password must be at least 8 characters.'),
      findsOneWidget,
    );

    await tester.enterText(find.byType(TextField).at(0), 'newpassword1');
    await tester.enterText(find.byType(TextField).at(1), 'different1');
    await tester.tap(find.widgetWithText(FilledButton, 'Reset Password'));
    await tester.pump();
    expect(find.text('Passwords do not match.'), findsOneWidget);
  });
}
