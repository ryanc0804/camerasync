import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:camerasync_mobile/api/api_client.dart';
import 'package:camerasync_mobile/auth/auth_service.dart';
import 'package:camerasync_mobile/screens/groups_screen.dart';

/// Scripted server for the groups endpoints: holds the user's groups in
/// memory and enforces the same create rules as POST /api/groups.
class _FakeApi extends ApiClient {
  _FakeApi() : super('http://test');

  final groups = <Map<String, dynamic>>[];
  final created = <Map<String, dynamic>>[];

  @override
  Future<dynamic> get(String path) async {
    if (path == '/api/groups') return {'groups': groups};
    throw ApiException(404, 'Unexpected call to $path');
  }

  @override
  Future<dynamic> post(String path, [Map<String, dynamic>? body]) async {
    if (path != '/api/groups') {
      throw ApiException(404, 'Unexpected call to $path');
    }
    if (body!['id'] == 'taken') {
      throw ApiException(409, 'That group ID already exists.');
    }
    created.add(body);
    final group = {
      'id': body['id'],
      'name': body['name'],
      'isPublic': body['isPublic'],
      'role': 'admin',
    };
    groups.insert(0, group);
    return {'group': group};
  }
}

void main() {
  Widget wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

  Future<_FakeApi> openDialog(WidgetTester tester) async {
    final api = _FakeApi();
    await tester.pumpWidget(wrap(GroupsScreen(auth: AuthService(api))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Create a group'));
    await tester.pumpAndSettle();
    return api;
  }

  Finder field(String label) => find.descendant(
        of: find.ancestor(of: find.text(label), matching: find.byType(Column)).first,
        matching: find.byType(TextField),
      );

  testWidgets('empty groups list offers Create a group', (tester) async {
    await tester.pumpWidget(
      wrap(GroupsScreen(auth: AuthService(_FakeApi()))),
    );
    await tester.pumpAndSettle();

    expect(find.text('No groups yet'), findsOneWidget);
    expect(find.text('Create a group'), findsOneWidget);
  });

  testWidgets('creates a public group and lists it', (tester) async {
    final api = await openDialog(tester);

    await tester.enterText(field('Group Name'), 'Team Knightro');
    await tester.enterText(field('Group ID'), 'knightro');
    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle();

    expect(api.created.single, {
      'id': 'knightro',
      'name': 'Team Knightro',
      'isPublic': true,
      'primaryColor': '#ead217',
    });
    expect(find.byType(Dialog), findsNothing);
    expect(find.text('Group ID: knightro'), findsOneWidget);
  });

  testWidgets('group ID only accepts letters and numbers', (tester) async {
    await openDialog(tester);

    await tester.enterText(field('Group ID'), 'ucf-cheer 2026!');

    expect(find.text('ucfcheer2026'), findsOneWidget);
  });

  testWidgets('private group requires a password, then sends it',
      (tester) async {
    final api = await openDialog(tester);

    await tester.enterText(field('Group Name'), 'UCF Cheer');
    await tester.enterText(field('Group ID'), 'ucfcheer');
    await tester.tap(find.text('Private group'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Create'));
    await tester.pump();

    expect(find.text('Private groups need a password.'), findsOneWidget);
    expect(api.created, isEmpty);

    await tester.enterText(field('Group Password'), 'gonights');
    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle();

    expect(api.created.single['isPublic'], false);
    expect(api.created.single['password'], 'gonights');
  });

  testWidgets('shows the server error for a taken ID and stays open',
      (tester) async {
    await openDialog(tester);

    await tester.enterText(field('Group Name'), 'Dupe');
    await tester.enterText(field('Group ID'), 'taken');
    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle();

    expect(find.text('That group ID already exists.'), findsOneWidget);
    expect(find.byType(Dialog), findsOneWidget);
  });
}
