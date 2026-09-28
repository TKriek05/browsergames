// Pixel-art thumbnails for the hub cards, drawn procedurally on a 48×32
// canvas (own designs, no external assets). CSS scales them up pixelated.
export const THUMB_W = 48;
export const THUMB_H = 32;

const C = {
  bg: '#10102a', dark: '#1c1c40', line: '#2a2a5c', white: '#eef0ff', grey: '#8a8fb8',
  cyan: '#3ef0ff', pink: '#ff3ea5', yellow: '#ffe14d', green: '#5dff8a', purple: '#c77dff',
  orange: '#ff9a3e', red: '#ff4d6d', blue: '#3e7bff', sky: '#5ab8ff', grass: '#2fbf5b', sand: '#e8c36a', brown: '#8a5a2b',
};

// Rows of characters → pixels; '.' is transparent.
function sprite(ctx, rows, x, y, pal) {
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const ch = rows[r][c];
      if (ch === '.') continue;
      ctx.fillStyle = pal[ch];
      ctx.fillRect(x + c, y + r, 1, 1);
    }
  }
}

function disc(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r) ctx.fillRect(cx + x, cy + y, 1, 1);
  }
}

const R = (ctx, x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };

const DRAW = {
  tag(ctx) {
    for (let x = 0; x < 48; x += 8) R(ctx, x, 0, 1, 32, C.dark);
    for (let y = 0; y < 32; y += 8) R(ctx, 0, y, 48, 1, C.dark);
    R(ctx, 20, 12, 8, 8, C.line);
    disc(ctx, 12, 20, 4, C.pink);
    R(ctx, 9, 13, 7, 2, C.yellow); R(ctx, 9, 11, 1, 2, C.yellow); R(ctx, 12, 11, 1, 2, C.yellow); R(ctx, 15, 11, 1, 2, C.yellow);
    disc(ctx, 34, 9, 4, C.cyan);
    disc(ctx, 38, 24, 4, C.green);
    for (const [x, y] of [[4, 20], [2, 18], [5, 23]]) R(ctx, x, y, 1, 1, C.pink);
    R(ctx, 11, 19, 1, 1, C.white); R(ctx, 14, 19, 1, 1, C.white); R(ctx, 33, 8, 1, 1, C.white); R(ctx, 36, 8, 1, 1, C.white);
  },
  tictactoe(ctx) {
    R(ctx, 19, 3, 2, 26, C.grey); R(ctx, 28, 3, 2, 26, C.grey); R(ctx, 10, 11, 29, 2, C.grey); R(ctx, 10, 20, 29, 2, C.grey);
    for (let i = 0; i < 6; i++) { R(ctx, 12 + i, 4 + i, 1, 1, C.pink); R(ctx, 17 - i, 4 + i, 1, 1, C.pink); }
    for (let i = 0; i < 6; i++) { R(ctx, 31 + i, 23 + i, 1, 1, C.pink); R(ctx, 36 - i, 23 + i, 1, 1, C.pink); }
    disc(ctx, 24, 16, 3, C.cyan); disc(ctx, 24, 16, 1, C.bg);
    disc(ctx, 14, 25, 3, C.cyan); disc(ctx, 14, 25, 1, C.bg);
  },
  connect4(ctx) {
    R(ctx, 8, 5, 32, 26, C.blue);
    const fill = { '0,5': C.red, '1,5': C.yellow, '1,4': C.red, '2,5': C.yellow, '2,4': C.yellow, '2,3': C.red, '3,5': C.red, '3,4': C.yellow, '4,5': C.yellow };
    for (let c = 0; c < 7; c++) for (let r = 0; r < 6; r++) disc(ctx, 11 + c * 4 + (c > 0 ? 0 : 0), 8 + r * 4, 1, fill[`${c},${r}`] ?? C.bg);
    disc(ctx, 31, 2, 1, C.red);
  },
  checkers(ctx) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) R(ctx, 8 + x * 4, y * 4, 4, 4, (x + y) % 2 ? C.brown : C.sand);
    for (const [x, y] of [[1, 0], [3, 0], [5, 0], [0, 1], [2, 1], [4, 1]]) disc(ctx, 10 + x * 4, 2 + y * 4, 1, C.white);
    for (const [x, y] of [[1, 6], [3, 6], [6, 7], [0, 7], [4, 5]]) disc(ctx, 10 + x * 4, 2 + y * 4, 1, C.dark);
  },
  reversi(ctx) {
    R(ctx, 8, 0, 32, 32, '#1f7a45');
    for (let i = 0; i <= 8; i++) { R(ctx, 8 + i * 4, 0, 1, 32, '#155c33'); R(ctx, 8, i * 4, 32, 1, '#155c33'); }
    const stones = [[3, 3, C.white], [4, 4, C.white], [3, 4, C.dark], [4, 3, C.dark], [5, 3, C.dark], [2, 4, C.white], [4, 2, C.white]];
    for (const [x, y, c] of stones) disc(ctx, 10 + x * 4, 2 + y * 4, 1, c);
  },
  chess(ctx) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 12; x++) R(ctx, x * 4, y * 4, 4, 4, (x + y) % 2 ? C.line : C.dark);
    const knight = ['..###..', '.#####.', '###.###', '.....##', '...####', '..####.', '..####.', '.######', '########'];
    sprite(ctx, knight, 12, 10, { '#': C.white });
    const king = ['...#...', '..###..', '...#...', '.#####.', '..###..', '..###..', '..###..', '.#####.', '#######'];
    sprite(ctx, king, 28, 10, { '#': C.pink });
  },
  ludo(ctx) {
    R(ctx, 8, 0, 32, 32, C.white);
    R(ctx, 8, 0, 12, 12, C.red); R(ctx, 28, 0, 12, 12, C.green); R(ctx, 8, 20, 12, 12, C.blue); R(ctx, 28, 20, 12, 12, C.yellow);
    R(ctx, 20, 14, 8, 4, C.grey); R(ctx, 22, 12, 4, 8, C.grey);
    for (const [x, y, c] of [[14, 6, C.white], [34, 6, C.white], [14, 26, C.white], [34, 26, C.white]]) disc(ctx, x, y, 2, c);
    disc(ctx, 23, 4, 1, C.red); disc(ctx, 30, 16, 1, C.green);
  },
  goose(ctx) {
    R(ctx, 0, 0, 48, 32, '#3a6b2e');
    const path = [[4, 26], [10, 26], [16, 26], [22, 26], [28, 26], [34, 26], [40, 26], [40, 20], [40, 14], [40, 8], [34, 6], [28, 6], [22, 6], [16, 6], [10, 8], [10, 14], [16, 16], [22, 16], [28, 16]];
    path.forEach(([x, y], i) => R(ctx, x, y, 5, 4, i % 2 ? C.sand : C.orange));
    const goose = ['..##..', '..#...', '..#...', '.####.', '######', '.####.', '..#.#.'];
    sprite(ctx, goose, 30, 9, { '#': C.white });
    R(ctx, 30, 9, 1, 1, C.orange);
  },
  battleship(ctx) {
    R(ctx, 0, 0, 48, 32, '#123a6b');
    for (let i = 0; i < 48; i += 6) R(ctx, i, 0, 1, 32, '#1c4d86');
    for (let i = 0; i < 32; i += 6) R(ctx, 0, i, 48, 1, '#1c4d86');
    R(ctx, 7, 14, 20, 5, C.grey); R(ctx, 12, 11, 8, 3, C.grey); R(ctx, 15, 8, 2, 3, C.grey);
    R(ctx, 30, 22, 12, 4, C.grey);
    for (const [x, y] of [[33, 8], [21, 24]]) { R(ctx, x, y + 1, 3, 1, C.white); R(ctx, x + 1, y, 1, 3, C.white); }
    disc(ctx, 22, 16, 2, C.red); R(ctx, 22, 12, 1, 2, C.orange);
  },
  duckshoot(ctx) {
    R(ctx, 0, 0, 48, 24, C.sky); R(ctx, 0, 24, 48, 8, C.grass);
    for (let x = 0; x < 48; x += 5) R(ctx, x, 22, 3, 2, '#228a42');
    const duck = ['....##..', '...#o##.', '...####>', '#..##...', '######..', '.#####..', '..###...'];
    sprite(ctx, duck, 8, 7, { '#': C.brown, o: C.white, '>': C.orange });
    R(ctx, 8, 11, 1, 1, C.green); R(ctx, 12, 8, 1, 1, C.green);
    ctx.fillStyle = C.red;
    R(ctx, 30, 11, 9, 1, C.red); R(ctx, 34, 7, 1, 9, C.red);
    R(ctx, 31, 8, 1, 1, C.red); R(ctx, 37, 8, 1, 1, C.red); R(ctx, 31, 14, 1, 1, C.red); R(ctx, 37, 14, 1, 1, C.red);
  },
  tanks(ctx) {
    R(ctx, 0, 0, 48, 32, '#2a2a22');
    R(ctx, 20, 4, 4, 12, C.brown); R(ctx, 30, 20, 12, 4, C.grey);
    R(ctx, 6, 18, 9, 9, C.green); R(ctx, 8, 20, 5, 5, '#2fa85a'); R(ctx, 13, 21, 7, 2, C.green);
    R(ctx, 34, 6, 9, 9, C.pink); R(ctx, 36, 8, 5, 5, '#c42b7e'); R(ctx, 30, 9, 5, 2, C.pink);
    R(ctx, 24, 21, 2, 2, C.yellow); R(ctx, 26, 21, 2, 1, C.orange);
  },
  kartrace(ctx) {
    R(ctx, 0, 0, 48, 11, '#241a52'); R(ctx, 0, 11, 48, 21, '#2fa84f');
    for (let y = 11; y < 32; y++) {
      const half = 2 + (y - 11) * 1.1;
      R(ctx, Math.round(24 - half), y, Math.round(half * 2), 1, '#555a70');
      if ((y >> 1) % 2) { R(ctx, Math.round(24 - half) - 1, y, 1, 1, C.red); R(ctx, Math.round(24 + half), y, 1, 1, C.white); }
    }
    R(ctx, 6, 7, 6, 4, '#3a2f7a'); R(ctx, 30, 5, 10, 6, '#3a2f7a');
    const kart = ['..####..', '.#pppp#.', '#pppppp#', '########', '##....##'];
    sprite(ctx, kart, 20, 24, { '#': C.dark, p: C.pink });
  },
  snake(ctx) {
    for (let y = 0; y < 32; y += 4) for (let x = 0; x < 48; x += 4) R(ctx, x, y, 3, 3, C.dark);
    for (const [x, y] of [[2, 5], [3, 5], [4, 5], [5, 5], [5, 4], [5, 3], [6, 3], [7, 3]]) R(ctx, x * 4, y * 4, 3, 3, C.green);
    for (const [x, y] of [[9, 1], [9, 2], [10, 2], [11, 2]]) R(ctx, x * 4, y * 4, 3, 3, C.pink);
    R(ctx, 32, 24, 3, 3, C.yellow);
  },
  paddle(ctx) {
    R(ctx, 23, 0, 2, 32, C.line);
    R(ctx, 3, 10, 3, 12, C.cyan); R(ctx, 42, 6, 3, 12, C.pink);
    R(ctx, 30, 18, 3, 3, C.white);
    R(ctx, 16, 2, 16, 3, C.yellow); R(ctx, 16, 27, 16, 3, C.green);
  },
  breakout(ctx) {
    const rows = [C.red, C.orange, C.yellow, C.green, C.cyan];
    rows.forEach((c, r) => { for (let x = 0; x < 8; x++) if (!(r === 4 && (x === 3 || x === 4))) R(ctx, 1 + x * 6, 2 + r * 3, 5, 2, c); });
    R(ctx, 17, 28, 12, 2, C.white); R(ctx, 26, 21, 2, 2, C.white);
  },
  bomber(ctx) {
    R(ctx, 0, 0, 48, 32, '#2f6a3a');
    for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) R(ctx, 4 + x * 8, 4 + y * 8, 4, 4, C.grey);
    for (const [x, y] of [[8, 0], [16, 24], [32, 8], [40, 16]]) R(ctx, x, y, 4, 4, C.brown);
    disc(ctx, 22, 18, 3, C.dark); R(ctx, 23, 13, 1, 2, C.white); R(ctx, 24, 12, 1, 1, C.orange);
    R(ctx, 36, 26, 5, 5, C.white); R(ctx, 37, 27, 3, 2, C.pink);
  },
  ghosts(ctx) {
    ctx.fillStyle = C.blue;
    R(ctx, 2, 2, 44, 1, C.blue); R(ctx, 2, 29, 44, 1, C.blue); R(ctx, 2, 2, 1, 28, C.blue); R(ctx, 45, 2, 1, 28, C.blue);
    R(ctx, 12, 10, 10, 1, C.blue); R(ctx, 28, 20, 10, 1, C.blue);
    for (let x = 6; x < 44; x += 4) R(ctx, x, 6, 1, 1, C.sand);
    for (let x = 6; x < 26; x += 4) R(ctx, x, 25, 1, 1, C.sand);
    const ghost = ['.####.', '######', '#o##o#', '######', '######', '#.##.#'];
    sprite(ctx, ghost, 30, 9, { '#': C.pink, o: C.white });
    disc(ctx, 11, 18, 3, C.yellow); R(ctx, 12, 17, 3, 3, C.bg);
  },
  blocks(ctx) {
    R(ctx, 14, 0, 20, 32, C.dark);
    const cells = [[0, 7, C.cyan], [1, 7, C.cyan], [2, 7, C.cyan], [3, 7, C.cyan], [0, 6, C.purple], [1, 6, C.purple], [1, 5, C.purple], [3, 6, C.orange], [4, 6, C.orange], [4, 7, C.orange], [4, 5, C.orange], [2, 1, C.green], [3, 1, C.green], [1, 2, C.green], [2, 2, C.green]];
    for (const [x, y, c] of cells) { R(ctx, 14 + x * 4, y * 4, 4, 4, c); R(ctx, 14 + x * 4, y * 4, 4, 1, C.white); }
  },
  minigolf(ctx) {
    R(ctx, 0, 0, 48, 32, '#1f8a44'); R(ctx, 4, 4, 40, 24, C.grass);
    R(ctx, 20, 4, 3, 12, C.brown);
    disc(ctx, 36, 12, 2, C.dark); R(ctx, 36, 3, 1, 9, C.white); R(ctx, 37, 3, 5, 3, C.red);
    disc(ctx, 10, 22, 1, C.white);
    for (let i = 1; i < 5; i++) R(ctx, 10 + i * 3, 22 - i * 2, 1, 1, C.white);
  },
  memory(ctx) {
    for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) R(ctx, 3 + x * 9, 2 + y * 10, 7, 8, C.purple);
    R(ctx, 12, 12, 7, 8, C.white); R(ctx, 30, 2, 7, 8, C.white);
    disc(ctx, 15, 16, 2, C.red); disc(ctx, 33, 6, 2, C.red);
  },
  mines(ctx) {
    for (let y = 0; y < 5; y++) for (let x = 0; x < 8; x++) R(ctx, x * 6, y * 6 + 1, 5, 5, (x + y * 3) % 5 === 0 ? C.dark : C.grey);
    R(ctx, 13, 8, 1, 3, C.cyan); R(ctx, 25, 14, 3, 1, C.green);
    R(ctx, 37, 20, 1, 4, C.white); R(ctx, 38, 20, 3, 2, C.red);
    disc(ctx, 20, 26, 1, C.dark);
  },
  invaders(ctx) {
    const alien = ['..#..#..', '.######.', '##.##.##', '########', '#.#..#.#'];
    for (let i = 0; i < 4; i++) sprite(ctx, alien, 4 + i * 11, 3, { '#': C.green });
    for (let i = 0; i < 3; i++) sprite(ctx, alien, 9 + i * 11, 10, { '#': C.purple });
    R(ctx, 21, 27, 7, 3, C.cyan); R(ctx, 24, 25, 1, 2, C.cyan); R(ctx, 24, 19, 1, 3, C.yellow);
  },
  rocks(ctx) {
    ctx.strokeStyle = C.grey;
    const rock = (cx, cy, r) => { for (let a = 0; a < 12; a++) { const ang = (a / 12) * Math.PI * 2; const rr = r * (a % 3 ? 1 : 0.75); R(ctx, Math.round(cx + Math.cos(ang) * rr), Math.round(cy + Math.sin(ang) * rr), 1, 1, C.grey); } };
    rock(10, 9, 6); rock(38, 22, 7); rock(34, 6, 3);
    const ship = ['...#...', '..#.#..', '.#...#.', '#######'];
    sprite(ctx, ship, 18, 20, { '#': C.cyan });
    R(ctx, 21, 16, 1, 2, C.yellow);
    R(ctx, 3, 28, 1, 1, C.white); R(ctx, 44, 2, 1, 1, C.white); R(ctx, 26, 3, 1, 1, C.white);
  },
};

export function drawThumb(canvas, gameId) {
  canvas.width = THUMB_W;
  canvas.height = THUMB_H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, THUMB_W, THUMB_H);
  (DRAW[gameId] ?? (() => {}))(ctx);
}
