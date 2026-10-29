import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:camerasync_mobile/api/api_client.dart';
import 'package:camerasync_mobile/api/groups_api.dart';
import 'package:camerasync_mobile/auth/auth_service.dart';
import 'package:camerasync_mobile/screens/groups_screen.dart';
import 'package:camerasync_mobile/screens/settings_tab.dart';
import 'package:camerasync_mobile/screens/watch_screen.dart';
import 'package:camerasync_mobile/team_accent.dart';

/// Settings tab and live group search, against a small local server like
/// recordings_screen_test.dart.
void main() {
  late HttpServer server;
  late List<String> searches;
  late List<Map<String, dynamic>> patches;
  late List<String> resetEmails;
  late List<String> passwordFlowCalls;
  late Map<String, dynamic> me;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    HttpOverrides.global = null;
    searches = [];
    patches = [];
    resetEmails = [];
    passwordFlowCalls = [];
    me = {
      'id': 1,
      'email': 'demo.ryan@knights.ucf.edu',
      'name': 'Ryan Cannon',
      'emailVerified': true,
      'primaryGroupId': null,
    };

    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((req) async {
      Object? body;
      final path = req.uri.path;
      if (path == '/api/auth/me' && req.method == 'GET') {
        body = {'user': me};
      } else if (path == '/api/auth/me' && req.method == 'PATCH') {
        final sent = jsonDecode(await utf8.decoder.bind(req).join())
            as Map<String, dynamic>;
        patches.add(sent);
        me = {...me, ...sent};
        body = {'user': me};
      } else if (path == '/api/auth/forgot-password') {
        passwordFlowCalls.add(path);
        final sent = jsonDecode(await utf8.decoder.bind(req).join())
            as Map<String, dynamic>;
        resetEmails.add(sent['email'] as String);
        body = null;
      } else if (path == '/api/auth/verify-reset-code') {
        passwordFlowCalls.add(path);
        await utf8.decoder.bind(req).join();
        body = {'token': 'reset-token'};
      } else if (path == '/api/auth/reset-password' ||
          path == '/api/auth/logout') {
        passwordFlowCalls.add(path);
        if (path == '/api/auth/reset-password') {
          await utf8.decoder.bind(req).join();
        }
        body = null;
      } else if (path == '/api/groups/search') {
        searches.add(req.uri.queryParameters['q'] ?? '');
        body = {
          'groups': [
            {
              'id': 'ucfcheer',
              'name': 'UCF Cheer',
              'isPublic': true,
              'isMember': false
            },
          ],
        };
      } else if (path == '/api/groups') {
        body = {
          'groups': [
            {
              'id': 'ucfcheer',
              'name': 'UCF Cheer',
              'isPublic': true,
              'primaryColor': '#ead217',
              'joinedAt': '2026-09-01T00:00:00Z'
            },
            {
              'id': 'ucfdance',
              'name': 'UCF Dance Team',
              'isPublic': true,
              'primaryColor': '#7c3aed',
              'joinedAt': '2026-09-02T00:00:00Z'
            },
          ],
        };
      } else {
        req.response.statusCode = 404;
        body = {'error': 'not found'};
      }
      req.response
        ..headers.contentType = ContentType.json
        ..write(jsonEncode(body));
      await req.response.close();
    });
  });

  tearDown(() => server.close(force: true));

  Future<AuthService> signedIn() async {
    final auth = AuthService(
        ApiClient('http://${server.address.address}:${server.port}'));
    await auth.restoreSession();
    return auth;
  }

  /// Lets real HTTP finish (it can't progress on the test's fake clock).
  Future<void> settle(WidgetTester tester) async {
    await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 400)));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
  }

  testWidgets('group search runs as you type, with no Search button',
      (tester) async {
    late AuthService auth;
    await tester.runAsync(() async {
      auth = await signedIn();
      await tester.pumpWidget(
          MaterialApp(home: Scaffold(body: GroupsScreen(auth: auth))));
    });
    await settle(tester);

    expect(find.widgetWithText(FilledButton, 'Search'), findsNothing);

    await tester.runAsync(() async {
      await tester.enterText(find.byType(TextField), 'ucf');
      // Past the 300 ms pause after the last keystroke.
      await Future<void>.delayed(const Duration(milliseconds: 700));
    });
    await settle(tester);

    expect(searches, ['ucf']);
    expect(find.text('ucfcheer'), findsOneWidget);
  });

  testWidgets('settings saves the primary group to the account',
      (tester) async {
    late AuthService auth;
    await tester.runAsync(() async {
      auth = await signedIn();
      await tester.pumpWidget(MaterialApp(
        home: TeamAccentScope(
            auth: auth, child: Scaffold(body: SettingsTab(auth: auth))),
      ));
    });
    await settle(tester);

    expect(find.text('Ryan Cannon'), findsOneWidget);
    expect(find.text('Verified'), findsOneWidget);
    // No saved choice yet, so the first joined group is primary.
    expect(
        TeamAccent.of(tester.element(find.byType(SettingsTab)))
            .primaryGroup
            ?.id,
        'ucfcheer');

    await tester.runAsync(() async {
      await tester.tap(find.text('UCF Dance Team'));
      await Future<void>.delayed(const Duration(milliseconds: 400));
    });
    await settle(tester);

    expect(patches, [
      {'primaryGroupId': 'ucfdance'},
    ]);
    expect(auth.user?.primaryGroupId, 'ucfdance');
    final team = TeamAccent.of(tester.element(find.byType(SettingsTab)));
    expect(team.primaryGroup?.id, 'ucfdance');
    expect(team.fill, const Color(0xFF7C3AED));
  });

  testWidgets('settings edits the name', (tester) async {
    late AuthService auth;
    await tester.runAsync(() async {
      auth = await signedIn();
      await tester.pumpWidget(
          MaterialApp(home: Scaffold(body: SettingsTab(auth: auth))));
    });
    await settle(tester);

    await tester.tap(find.widgetWithText(TextButton, 'Edit'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.enterText(find.byType(TextField), 'Ryan C.');
    await tester.runAsync(() async {
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await Future<void>.delayed(const Duration(milliseconds: 400));
    });
    await settle(tester);

    expect(patches, [
      {'name': 'Ryan C.'},
    ]);
    expect(find.text('Ryan C.'), findsOneWidget);
  });

  testWidgets('settings can reset password by email without current password',
      (tester) async {
    late AuthService auth;
    await tester.runAsync(() async {
      auth = await signedIn();
      await tester.pumpWidget(
          MaterialApp(home: Scaffold(body: SettingsTab(auth: auth))));
    });
    await settle(tester);

    await tester.tap(find.widgetWithText(TextButton, 'Change'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Forgot your current password?'));
    await tester.pumpAndSettle();

    expect(find.text('Forgot Password'), findsOneWidget);
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller!.text,
      'demo.ryan@knights.ucf.edu',
    );

    await tester.runAsync(() async {
      await tester.tap(find.text('Send Code'));
      await Future<void>.delayed(const Duration(milliseconds: 400));
    });
    await settle(tester);
    expect(find.text('Enter Code'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '123456');
    await tester.runAsync(() async {
      await tester.tap(find.text('Verify'));
      await Future<void>.delayed(const Duration(milliseconds: 400));
    });
    await settle(tester);

    await tester.enterText(find.byType(TextField).at(0), 'newpassword1');
    await tester.enterText(find.byType(TextField).at(1), 'newpassword1');
    await tester.runAsync(() async {
      await tester.tap(find.widgetWithText(FilledButton, 'Reset Password'));
      await Future<void>.delayed(const Duration(milliseconds: 400));
    });
    await settle(tester);

    expect(resetEmails, ['demo.ryan@knights.ucf.edu']);
    expect(find.text('Forgot Password'), findsNothing);
    expect(passwordFlowCalls, [
      '/api/auth/forgot-password',
      '/api/auth/verify-reset-code',
      '/api/auth/reset-password',
      '/api/auth/logout',
    ]);
    expect(auth.isAuthenticated, isFalse);
    expect(find.text('Password reset. Sign in with your new password.'),
        findsOneWidget);
  });

  test(
      'a TV, monitor or tablet on its side counts as a big screen; phones do not',
      () {
    expect(isBigScreen(const Size(412, 915)), isFalse); // phone
    expect(isBigScreen(const Size(915, 412)), isFalse); // phone on its side
    expect(isBigScreen(const Size(960, 540)), isTrue); // 1080p TV
    expect(isBigScreen(const Size(1280, 800)), isTrue); // tablet, landscape
  });

  test('primary group: the saved one, else the first joined', () {
    final groups = [
      Group(id: 'b', name: 'B', isPublic: true, joinedAt: DateTime(2026, 9, 2)),
      Group(id: 'a', name: 'A', isPublic: true, joinedAt: DateTime(2026, 9, 1)),
    ];
    const user = AppUser(id: 1, email: 'x@ucf.edu');
    expect(primaryGroupOf(user, groups)?.id, 'a');
    expect(
        primaryGroupOf(
                const AppUser(id: 1, email: 'x@ucf.edu', primaryGroupId: 'b'),
                groups)
            ?.id,
        'b');
    expect(
        primaryGroupOf(
                const AppUser(
                    id: 1, email: 'x@ucf.edu', primaryGroupId: 'gone'),
                groups)
            ?.id,
        'a');
    expect(primaryGroupOf(user, const []), isNull);
  });
}
