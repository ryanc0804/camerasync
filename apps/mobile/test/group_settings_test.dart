import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:camerasync_mobile/api/api_client.dart';
import 'package:camerasync_mobile/api/groups_api.dart';
import 'package:camerasync_mobile/auth/auth_service.dart';
import 'package:camerasync_mobile/screens/group_settings_screen.dart';
import 'package:camerasync_mobile/screens/groups_screen.dart';

/// The group page opened from a card's gear, against a small local server.
void main() {
  late HttpServer server;
  late List<Map<String, dynamic>> colorPatches;
  late List<String> leaves;

  const cheerAsOwner = Group(
    id: 'ucfcheer',
    name: 'UCF Cheer',
    isPublic: true,
    primaryColor: '#ead217',
    owner: 1,
    role: 'admin',
  );
  const danceAsMember = Group(
    id: 'ucfdance',
    name: 'UCF Dance Team',
    isPublic: true,
    primaryColor: '#7c3aed',
    owner: 2,
    role: 'member',
  );

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    HttpOverrides.global = null;
    colorPatches = [];
    leaves = [];
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((req) async {
      final path = req.uri.path;
      Object body;
      if (path == '/api/auth/me') {
        body = {
          'user': {
            'id': 1,
            'email': 'demo.ryan@knights.ucf.edu',
            'name': 'Ryan',
            'emailVerified': true
          },
        };
      } else if (path.endsWith('/leave') && req.method == 'POST') {
        leaves.add(path);
        body = {'ok': true};
      } else if (path.endsWith('/members')) {
        body = {
          'members': [
            {'id': 1, 'name': 'Ryan Cannon', 'role': 'admin'},
            {'id': 3, 'name': 'Maya Chen', 'role': 'member'},
          ],
        };
      } else if (path == '/api/groups/ucfcheer' && req.method == 'PATCH') {
        final sent = jsonDecode(await utf8.decoder.bind(req).join())
            as Map<String, dynamic>;
        colorPatches.add(sent);
        body = {
          'group': {
            'id': 'ucfcheer',
            'name': 'UCF Cheer',
            'isPublic': true,
            'primaryColor': sent['primaryColor'],
            'owner': 1,
            'role': 'admin',
          },
        };
      } else if (path == '/api/groups') {
        body = {
          'groups': [
            {
              'id': 'ucfcheer',
              'name': 'UCF Cheer',
              'isPublic': true,
              'primaryColor': '#ead217',
              'owner': 1,
              'role': 'admin'
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

  Future<void> settle(WidgetTester tester) async {
    await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 400)));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
  }

  Future<AuthService> open(WidgetTester tester, Group group) async {
    late AuthService auth;
    await tester.runAsync(() async {
      auth = await signedIn();
      await tester.pumpWidget(
          MaterialApp(home: GroupSettingsScreen(auth: auth, group: group)));
    });
    await settle(tester);
    return auth;
  }

  testWidgets('admins and owners can change the team color', (tester) async {
    // Tall enough that the list builds every section.
    tester.view.physicalSize = const Size(800, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await open(tester, cheerAsOwner);

    expect(find.text('Team color'), findsOneWidget);
    expect(find.textContaining("You're the owner"), findsOneWidget);
    expect(find.text('Members (2)'), findsOneWidget);
    // The owner gets a role dropdown and a red remove button for Maya.
    expect(find.byType(DropdownButton<String>), findsOneWidget);
    expect(find.byTooltip('Remove Maya Chen from group'), findsOneWidget);

    await tester.tap(find.bySemanticsLabel('Team color Navy'));
    await tester.pump();
    await tester.runAsync(() async {
      await tester.tap(find.text('Save color'));
      await Future<void>.delayed(const Duration(milliseconds: 400));
    });
    await settle(tester);

    expect(colorPatches, [
      {'primaryColor': '#1e3a8a'},
    ]);
  });

  testWidgets('members do not see the color picker or member controls',
      (tester) async {
    // Tall enough that the list builds every section.
    tester.view.physicalSize = const Size(800, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await open(tester, danceAsMember);

    expect(find.text('Team color'), findsNothing);
    expect(find.textContaining("You're a member"), findsOneWidget);
    expect(find.byIcon(Icons.remove), findsNothing);
    expect(find.byType(DropdownButton<String>), findsNothing);
    expect(find.text('Make this my primary group'), findsOneWidget);
  });

  testWidgets('the owner gets group details, hand over and delete',
      (tester) async {
    tester.view.physicalSize = const Size(800, 3600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await open(tester, cheerAsOwner);

    expect(find.text('Group details'), findsOneWidget);
    expect(find.text('Hand over'), findsOneWidget);
    expect(find.text('Delete group'), findsOneWidget);
    expect(find.text('Leave group'), findsNothing);
  });

  testWidgets('a member can leave after confirming', (tester) async {
    tester.view.physicalSize = const Size(800, 3600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await open(tester, danceAsMember);

    expect(find.text('Delete group'), findsNothing);
    // Started on the real clock, so the request after the dialog can run.
    await tester.runAsync(() async {
      await tester.tap(find.widgetWithText(OutlinedButton, 'Leave group'));
    });
    await tester.pumpAndSettle();
    await tester.runAsync(() async {
      await tester.tap(find.widgetWithText(FilledButton, 'Leave'));
      await Future<void>.delayed(const Duration(milliseconds: 400));
    });
    await settle(tester);

    expect(leaves, ['/api/groups/ucfdance/leave']);
  });

  testWidgets('group cards have Recordings and a settings gear',
      (tester) async {
    late AuthService auth;
    await tester.runAsync(() async {
      auth = await signedIn();
      await tester.pumpWidget(
          MaterialApp(home: Scaffold(body: GroupsScreen(auth: auth))));
    });
    await settle(tester);

    expect(find.widgetWithText(FilledButton, 'Recordings'), findsOneWidget);
    expect(find.byTooltip('Settings for UCF Cheer'), findsOneWidget);
  });
}
