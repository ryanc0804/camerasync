// Where each camera angle goes on the playback screen, for any screen size
// and any mix of horizontal (16:9) and vertical (9:16) videos. Tiles always
// take the video's own shape, so there are no black bars inside them.

/// The column count that makes `count` tiles of `aspect` (width / height)
/// as large as possible inside width x height. Returns the columns, rows and
/// tile size.
export function bestGrid(width, height, count, aspect, gap = 12) {
  let best = null;
  for (let columns = 1; columns <= Math.max(1, count); columns += 1) {
    const rows = Math.ceil(count / columns);
    const tileWidth = Math.min(
      (width - gap * (columns - 1)) / columns,
      ((height - gap * (rows - 1)) / rows) * aspect
    );
    if (tileWidth <= 0) continue;
    if (!best || tileWidth > best.tileWidth + 0.5) {
      best = { columns, rows, tileWidth, tileHeight: tileWidth / aspect };
    }
  }
  return best ?? { columns: 1, rows: 1, tileWidth: 0, tileHeight: 0 };
}

/// How many angles fit on one page of a width x height grid while each stays
/// at least `minTileWidth` wide (and at least 1, at most `max`).
export function anglesPerPage(width, height, aspect, { minTileWidth = 240, max = 16, gap = 12 } = {}) {
  let fits = 1;
  for (let count = 2; count <= max; count += 1) {
    if (bestGrid(width, height, count, aspect, gap).tileWidth >= minTileWidth) fits = count;
  }
  return fits;
}

/// The angles' usual shape: the most common one among those known (16:9 if
/// none have loaded yet), so a page of horizontal videos lays out for 16:9
/// and a page of vertical ones for 9:16.
export function commonAspect(aspects) {
  const known = aspects.filter((aspect) => Number.isFinite(aspect) && aspect > 0);
  if (known.length === 0) return 16 / 9;
  const wide = known.filter((aspect) => aspect >= 1).length;
  const tall = known.length - wide;
  const pool = wide >= tall ? known.filter((a) => a >= 1) : known.filter((a) => a < 1);
  const sorted = [...pool].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/// Rectangles ({ left, top, width, height }) for `count` tiles, in order.
///
///   grid       every angle the same size, rows centered
///   spotlight  `featured` large, the others small beside it (to the right
///              on a wide screen, underneath on a tall one)
export function layoutAngles({ width, height, count, aspect, mode = "grid", featured = 0, gap = 12 }) {
  if (!width || !height || count === 0) return [];
  if (mode === "spotlight" && count > 1) {
    return spotlight(width, height, count, aspect, Math.min(featured, count - 1), gap);
  }
  return grid(width, height, count, aspect, gap);
}

function grid(width, height, count, aspect, gap) {
  const { columns, rows, tileWidth, tileHeight } = bestGrid(width, height, count, aspect, gap);
  const top0 = (height - (rows * tileHeight + (rows - 1) * gap)) / 2;
  const rects = [];
  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / columns);
    const inRow = Math.min(columns, count - row * columns);
    const left0 = (width - (inRow * tileWidth + (inRow - 1) * gap)) / 2;
    rects.push({
      left: left0 + (i % columns) * (tileWidth + gap),
      top: top0 + row * (tileHeight + gap),
      width: tileWidth,
      height: tileHeight,
    });
  }
  return rects;
}

function spotlight(width, height, count, aspect, featured, gap) {
  const others = count - 1;
  const side = width >= height;
  // The strip takes a share of the screen sized to the videos' shape.
  const share = aspect >= 1 ? (side ? 0.24 : 0.22) : (side ? 0.16 : 0.3);
  const stripW = side ? width * share : width;
  const stripH = side ? height : height * share;
  const mainW = side ? width - stripW - gap : width;
  const mainH = side ? height : height - stripH - gap;

  const main = bestGrid(mainW, mainH, 1, aspect, gap);
  const mainRect = {
    left: (mainW - main.tileWidth) / 2,
    top: (mainH - main.tileHeight) / 2,
    width: main.tileWidth,
    height: main.tileHeight,
  };

  const small = side
    ? bestGrid(stripW, stripH, others, aspect, gap)
    : { columns: others, rows: 1, ...rowOf(stripW, stripH, others, aspect, gap) };
  const blockW = small.columns * small.tileWidth + (small.columns - 1) * gap;
  const blockH = small.rows * small.tileHeight + (small.rows - 1) * gap;
  const left0 = side ? mainW + gap + (stripW - blockW) / 2 : (stripW - blockW) / 2;
  const top0 = side ? (stripH - blockH) / 2 : mainH + gap + (stripH - blockH) / 2;

  const rects = [];
  let n = 0;
  for (let i = 0; i < count; i += 1) {
    if (i === featured) {
      rects.push(mainRect);
      continue;
    }
    rects.push({
      left: left0 + (n % small.columns) * (small.tileWidth + gap),
      top: top0 + Math.floor(n / small.columns) * (small.tileHeight + gap),
      width: small.tileWidth,
      height: small.tileHeight,
    });
    n += 1;
  }
  return rects;
}

// One row of `count` tiles filling a strip's height, shrunk to fit its width.
function rowOf(width, height, count, aspect, gap) {
  const byHeight = height * aspect;
  const byWidth = (width - gap * (count - 1)) / count;
  const tileWidth = Math.max(0, Math.min(byHeight, byWidth));
  return { tileWidth, tileHeight: tileWidth / aspect };
}
