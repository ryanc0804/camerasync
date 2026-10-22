import 'dart:ui';

/// Where each camera angle goes on the playback screen, like the web app's
/// src/recording/angleLayout.js. Tiles take the video's own shape (width /
/// height), so there are no black bars inside them.

/// The column count that makes [count] tiles of [aspect] as large as
/// possible inside [size].
({int columns, int rows, double tileWidth, double tileHeight}) bestGrid(
    Size size, int count, double aspect,
    {double gap = 8}) {
  var best = (columns: 1, rows: 1, tileWidth: 0.0, tileHeight: 0.0);
  for (var columns = 1; columns <= (count < 1 ? 1 : count); columns++) {
    final rows = (count / columns).ceil();
    final byWidth = (size.width - gap * (columns - 1)) / columns;
    final byHeight = ((size.height - gap * (rows - 1)) / rows) * aspect;
    final tileWidth = byWidth < byHeight ? byWidth : byHeight;
    if (tileWidth > best.tileWidth + 0.5) {
      best = (
        columns: columns,
        rows: rows,
        tileWidth: tileWidth,
        tileHeight: tileWidth / aspect
      );
    }
  }
  return best;
}

/// How many angles fit on one page of [size] while each stays at least
/// [minTileWidth] wide (at least 1, at most [max]). Like anglesPerPage in
/// the web app's angleLayout.js.
int anglesPerPage(Size size, double aspect,
    {double minTileWidth = 300, int max = 9, double gap = 8}) {
  var fits = 1;
  for (var count = 2; count <= max; count++) {
    if (bestGrid(size, count, aspect, gap: gap).tileWidth >= minTileWidth) {
      fits = count;
    }
  }
  return fits;
}

/// The most common shape among the angles that have loaded: horizontal
/// (16:9) until any have.
double commonAspect(Iterable<double?> aspects) {
  final known = [
    for (final a in aspects)
      if (a != null && a.isFinite && a > 0) a
  ];
  if (known.isEmpty) return 16 / 9;
  final wide = known.where((a) => a >= 1).toList()..sort();
  final tall = known.where((a) => a < 1).toList()..sort();
  final pool = wide.length >= tall.length ? wide : tall;
  return pool[pool.length ~/ 2];
}

/// Rectangles for [count] equal tiles in the best-fit grid, rows centered.
List<Rect> gridLayout(Size size, int count, double aspect, {double gap = 8}) {
  if (count == 0 || size.isEmpty) return const [];
  final g = bestGrid(size, count, aspect, gap: gap);
  final top0 =
      (size.height - (g.rows * g.tileHeight + (g.rows - 1) * gap)) / 2;
  return [
    for (var i = 0; i < count; i++)
      () {
        final row = i ~/ g.columns;
        final inRow =
            (count - row * g.columns) < g.columns ? count - row * g.columns : g.columns;
        final left0 =
            (size.width - (inRow * g.tileWidth + (inRow - 1) * gap)) / 2;
        return Rect.fromLTWH(
          left0 + (i % g.columns) * (g.tileWidth + gap),
          top0 + row * (g.tileHeight + gap),
          g.tileWidth,
          g.tileHeight,
        );
      }(),
  ];
}

/// Below this many physical pixels on an angle's shorter side, its 720p
/// preview (see the server's src/recordings/previews.js) looks the same as
/// the original.
const previewUpToPixels = 900.0;

/// Whether each angle of a [count]-angle grid filling [area] is drawn small
/// enough to play its preview: much less for the phone to download and
/// decode, so many angles can play at once. One angle on its own always
/// plays the original.
bool usePreviews(Size area, int count, double devicePixelRatio,
    {double aspect = 16 / 9, double gap = 8}) {
  if (count <= 1 || area.isEmpty) return false;
  final grid = bestGrid(area, count, aspect, gap: gap);
  final shorter =
      grid.tileWidth < grid.tileHeight ? grid.tileWidth : grid.tileHeight;
  return shorter * devicePixelRatio <= previewUpToPixels;
}
