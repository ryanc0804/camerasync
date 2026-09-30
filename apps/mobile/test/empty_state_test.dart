import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:camerasync_mobile/widgets/empty_state.dart';

void main() {
  testWidgets('shows title, message and a working action', (tester) async {
    var tapped = false;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: EmptyState(
          title: 'No groups yet',
          message: 'Search above to join one.',
          actionLabel: 'Find your group',
          onAction: () => tapped = true,
        ),
      ),
    ));

    expect(find.text('No groups yet'), findsOneWidget);
    expect(find.text('Search above to join one.'), findsOneWidget);
    await tester.tap(find.text('Find your group'));
    expect(tapped, isTrue);
  });

  testWidgets('omits the button when there is no action', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: EmptyState(title: 'Nothing here', message: 'Yet.'),
      ),
    ));

    expect(find.byType(FilledButton), findsNothing);
  });
}
