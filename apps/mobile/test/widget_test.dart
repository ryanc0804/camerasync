import 'package:flutter_test/flutter_test.dart';

import 'package:camerasync_mobile/main.dart';

void main() {
  testWidgets('join screen renders', (tester) async {
    await tester.pumpWidget(const CameraSyncApp());
    expect(find.text('Join session'), findsOneWidget);
    expect(find.text('Session ID'), findsOneWidget);
  });
}
