import 'package:flutter/material.dart';

/// Shared palette for the 8kount dark theme.
const kBackground = Color(0xFF000000);
const kGold = Color(0xFFEAD217);
const kGoldActive = Color(0xFFFFEB4C);
const kSurface = Color(0xFF161616);
const kSurfaceLight = Color(0xFF2A2A2A);
const kMuted = Color(0xFF8A8A8A);
const kFaint = Color(0xFF4A4A4A);
const kLiveRed = Color(0xFFFF5A5A);

/// The colors a group can pick, as (name, hex), matching
/// apps/server/src/groups/teamColors.js. Each one keeps black or white text
/// readable (at least 4.5:1 contrast with one of them).
const kTeamColors = <(String, String)>[
  ('Gold', '#ead217'),
  ('Orange', '#f97316'),
  ('Red', '#dc2626'),
  ('Maroon', '#7f1d1d'),
  ('Pink', '#ec4899'),
  ('Purple', '#7c3aed'),
  ('Navy', '#1e3a8a'),
  ('Blue', '#2563eb'),
  ('Sky', '#38bdf8'),
  ('Teal', '#14b8a6'),
  ('Green', '#16a34a'),
  ('Gray', '#6b7280'),
];

/// A team color sent by the server as `#rrggbb`, or null when it isn't one.
Color? parseHexColor(String? hex) {
  final match = RegExp(r'^#([0-9a-fA-F]{6})$').firstMatch(hex ?? '');
  if (match == null) return null;
  return Color(0xFF000000 | int.parse(match.group(1)!, radix: 16));
}

double _contrast(Color a, Color b) {
  final la = a.computeLuminance(), lb = b.computeLuminance();
  final hi = la > lb ? la : lb, lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

/// Black or white, whichever reads better on [color] (same rule as the web's
/// inkFor in groupTheme.js).
Color inkOn(Color color) =>
    _contrast(color, Colors.black) >= _contrast(color, Colors.white)
        ? Colors.black
        : Colors.white;

/// [color] lightened just enough to read as text on the black background
/// (4.5:1), like legibleOnDark in the web app's groupTheme.js.
Color legibleOnDark(Color color) {
  var candidate = color;
  for (var step = 1; _contrast(candidate, Colors.black) < 4.5 && step <= 10; step++) {
    candidate = Color.lerp(color, Colors.white, step / 10)!;
  }
  return candidate;
}

/// The app's Material colors with [accent] used exactly. Seeding Material 3
/// with a color shifts it (8kount gold came out mustard) and tints the dark
/// surfaces with its hue, so the brand colors and neutral grays are pinned.
ColorScheme schemeFor(Color accent) {
  final ink = inkOn(accent);
  final deep = Color.lerp(accent, Colors.black, 0.6)!;
  return ColorScheme.fromSeed(seedColor: accent, brightness: Brightness.dark)
      .copyWith(
        primary: accent,
        onPrimary: ink,
        primaryContainer: deep,
        onPrimaryContainer: accent,
        secondary: accent,
        onSecondary: ink,
        secondaryContainer: deep,
        onSecondaryContainer: accent,
        tertiary: accent,
        onTertiary: ink,
        surface: kBackground,
        onSurface: const Color(0xFFF0F0F0),
        onSurfaceVariant: const Color(0xFFA0A0A0),
        surfaceContainerLowest: const Color(0xFF0A0A0A),
        surfaceContainerLow: const Color(0xFF121212),
        surfaceContainer: kSurface,
        surfaceContainerHigh: const Color(0xFF1C1C1C),
        surfaceContainerHighest: const Color(0xFF262626),
        surfaceTint: Colors.transparent,
        outline: kFaint,
        outlineVariant: kSurfaceLight,
      );
}
