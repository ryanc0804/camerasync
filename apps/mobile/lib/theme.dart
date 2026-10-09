import 'package:flutter/material.dart';

/// Shared palette for the 8kount dark theme.
const kBackground = Color(0xFF000000);
const kGold = Color(0xFFF2CB05);
const kGoldActive = Color(0xFFFFE066);
const kSurface = Color(0xFF161616);
const kSurfaceLight = Color(0xFF2A2A2A);
const kMuted = Color(0xFF8A8A8A);
const kFaint = Color(0xFF4A4A4A);
const kLiveRed = Color(0xFFFF5A5A);

/// The colors a group can pick, as (name, hex), matching
/// apps/server/src/groups/teamColors.js. Each one keeps black or white text
/// readable (at least 4.5:1 contrast with one of them).
const kTeamColors = <(String, String)>[
  ('Gold', '#ffc72c'),
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
