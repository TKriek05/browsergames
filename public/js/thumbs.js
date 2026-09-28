// Pixel-art thumbnails for the hub cards, drawn procedurally on a 48×32
// canvas (own designs, no external assets). CSS scales them up pixelated.
export const THUMB_W = 48;
export const THUMB_H = 32;

const C = {
  bg: '#10102a', dark: '#1c1c40', line: '#2a2a5c', white: '#eef0ff', grey: '#8a8fb8',
  cyan: '#3ef0ff', pink: '#ff3ea5', yellow: '#ffe14d', green: '#5dff8a', purple: '#c77dff',
  orange: '#ff9a3e', red: '#ff4d6d', blue: '#3e7bff', sky: '#5ab8ff', grass: '#2fbf5b', sand: '#e8c36a', brown: '#8a5a2b',
};

// Materials for the non-neon games (wood, paper, pencil).
const W = { oak: '#a8743f', walnut: '#5e3c23', paper: '#fbf7ea', pencil: '#3a3a44' };

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
    R(ctx, 0, 0, 48, 32, W.oak); R(ctx, 6, 1, 36, 30, W.paper);
    for (let y = 5; y < 31; y += 4) R(ctx, 6, y, 36, 1, '#c8d4e8');
    R(ctx, 10, 1, 1, 30, '#e8a0a0');
    R(ctx, 19, 3, 2, 26, W.pencil); R(ctx, 28, 3, 2, 26, W.pencil); R(ctx, 12, 11, 27, 2, W.pencil); R(ctx, 12, 20, 27, 2, W.pencil);
    for (let i = 0; i < 6; i++) { R(ctx, 13 + i, 4 + i, 1, 1, C.red); R(ctx, 18 - i, 4 + i, 1, 1, C.red); }
    for (let i = 0; i < 6; i++) { R(ctx, 31 + i, 23 + i, 1, 1, C.red); R(ctx, 36 - i, 23 + i, 1, 1, C.red); }
    disc(ctx, 24, 16, 3, '#2a6ad0'); disc(ctx, 24, 16, 1, W.paper);
    disc(ctx, 15, 25, 3, '#2a6ad0'); disc(ctx, 15, 25, 1, W.paper);
  },
  connect4(ctx) {
    R(ctx, 0, 0, 48, 32, W.oak);
    R(ctx, 8, 5, 32, 25, '#1f55c4'); R(ctx, 6, 29, 6, 3, '#163f94'); R(ctx, 36, 29, 6, 3, '#163f94');
    const fill = { '0,5': C.red, '1,5': C.yellow, '1,4': C.red, '2,5': C.yellow, '2,4': C.yellow, '2,3': C.red, '3,5': C.red, '3,4': C.yellow, '4,5': C.yellow };
    for (let c = 0; c < 7; c++) for (let r = 0; r < 6; r++) disc(ctx, 11 + c * 4, 8 + r * 4, 1, fill[`${c},${r}`] ?? '#3a2a1e');
    disc(ctx, 31, 2, 1, C.red);
  },
  checkers(ctx) {
    R(ctx, 0, 0, 48, 32, W.walnut);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) R(ctx, 8 + x * 4, y * 4, 4, 4, (x + y) % 2 ? '#8a5a34' : '#e6c690');
    for (const [x, y] of [[1, 0], [3, 0], [5, 0], [0, 1], [2, 1], [4, 1]]) disc(ctx, 10 + x * 4, 2 + y * 4, 1, '#2a1c14');
    for (const [x, y] of [[1, 6], [3, 6], [6, 7], [0, 7], [4, 5]]) disc(ctx, 10 + x * 4, 2 + y * 4, 1, '#f4e8d0');
  },
  reversi(ctx) {
    R(ctx, 0, 0, 48, 32, W.walnut); R(ctx, 6, 0, 36, 32, '#9a6a40');
    R(ctx, 8, 1, 32, 30, '#1d7a4c');
    for (let i = 0; i <= 8; i++) { R(ctx, 8 + i * 4, 1, 1, 30, '#0d3a22'); if (i < 8) R(ctx, 8, 1 + i * 4, 32, 1, '#0d3a22'); }
    const stones = [[3, 3, '#f2f3f0'], [4, 4, '#f2f3f0'], [3, 4, '#16161f'], [4, 3, '#16161f'], [5, 3, '#16161f'], [2, 4, '#f2f3f0'], [4, 2, '#f2f3f0']];
    for (const [x, y, c] of stones) disc(ctx, 10 + x * 4, 3 + y * 4 - 1, 1, c);
  },
  chess(ctx) {
    R(ctx, 0, 0, 48, 32, W.walnut);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 10; x++) R(ctx, 4 + x * 4, y * 4, 4, 4, (x + y) % 2 ? '#8a5a34' : '#e6c690');
    const knight = ['..###..', '.#####.', '###.###', '.....##', '...####', '..####.', '..####.', '.######', '########'];
    sprite(ctx, knight, 12, 10, { '#': '#f6ecd6' });
    const king = ['...#...', '..###..', '...#...', '.#####.', '..###..', '..###..', '..###..', '.#####.', '#######'];
    sprite(ctx, king, 28, 10, { '#': '#2e2018' });
  },
  ludo(ctx) {
    R(ctx, 0, 0, 48, 32, W.oak); R(ctx, 8, 0, 32, 32, '#f3e3b5');
    R(ctx, 9, 1, 11, 11, '#f08a8a'); R(ctx, 28, 1, 11, 11, '#8ac8e8'); R(ctx, 9, 20, 11, 11, '#9ad89a'); R(ctx, 28, 20, 11, 11, '#f0d070');
    for (let i = 0; i < 5; i++) { disc(ctx, 24, 2 + i * 6, 1, '#fbf4e0'); disc(ctx, 11 + i * 6, 16, 1, '#fbf4e0'); }
    for (const [x, y, c] of [[14, 6, C.red], [34, 6, C.blue], [14, 26, C.green], [34, 26, C.yellow]]) disc(ctx, x, y, 2, c);
  },
  goose(ctx) {
    R(ctx, 0, 0, 48, 32, W.walnut); R(ctx, 2, 2, 44, 28, '#8a3a2a');
    const path = [[4, 24], [10, 24], [16, 24], [22, 24], [28, 24], [34, 24], [40, 24], [40, 18], [40, 12], [40, 6], [34, 4], [28, 4], [22, 4], [16, 4], [10, 6], [10, 12], [16, 14], [22, 14], [28, 14]];
    path.forEach(([x, y], i) => R(ctx, x, y, 5, 4, i % 5 === 2 ? '#b8cf9a' : i % 2 ? '#f1e3c0' : '#eadab2'));
    const goose = ['..##..', '..#...', '..#...', '.####.', '######', '.####.', '..#.#.'];
    sprite(ctx, goose, 30, 7, { '#': '#fbf8f0' });
    R(ctx, 30, 7, 1, 1, C.orange);
  },
  battleship(ctx) {
    R(ctx, 0, 0, 48, 32, '#4a545e'); R(ctx, 3, 3, 42, 26, '#2a6aa0');
    for (let i = 3; i < 45; i += 6) R(ctx, i, 3, 1, 26, '#4a86b8');
    for (let i = 3; i < 29; i += 6) R(ctx, 3, i, 42, 1, '#4a86b8');
    R(ctx, 7, 14, 20, 5, '#8a929c'); R(ctx, 12, 11, 8, 3, '#8a929c'); R(ctx, 15, 8, 2, 3, '#8a929c');
    R(ctx, 30, 22, 12, 4, '#8a929c');
    for (const [x, y] of [[33, 8], [21, 24]]) { R(ctx, x, y + 1, 3, 1, C.white); R(ctx, x + 1, y, 1, 3, C.white); }
    disc(ctx, 22, 16, 2, '#e63946'); R(ctx, 22, 12, 1, 2, C.orange);
  },
  duckshoot(ctx) {
    R(ctx, 0, 0, 48, 24, C.sky); R(ctx, 0, 24, 48, 8, C.grass);
    for (let x = 0; x < 48; x += 5) R(ctx, x, 22, 3, 2, '#228a42');
    const duck = ['....##..', '...#o##.', '...####>', '#..##...', '######..', '.#####..', '..###...'];
    sprite(ctx, duck, 8, 7, { '#': C.brown, o: C.white, '>': C.orange });
    R(ctx, 8, 11, 1, 1, C.green); R(ctx, 12, 8, 1, 1, C.green);
    R(ctx, 30, 11, 9, 1, C.red); R(ctx, 34, 7, 1, 9, C.red);
    R(ctx, 31, 8, 1, 1, C.red); R(ctx, 37, 8, 1, 1, C.red); R(ctx, 31, 14, 1, 1, C.red); R(ctx, 37, 14, 1, 1, C.red);
  },
  tanks(ctx) {
    R(ctx, 0, 0, 48, 32, '#cfb27c');
    R(ctx, 20, 4, 4, 12, '#95784a'); R(ctx, 30, 20, 12, 4, '#95784a'); R(ctx, 20, 8, 4, 1, '#7a6040'); R(ctx, 30, 22, 12, 1, '#7a6040');
    R(ctx, 26, 6, 5, 5, '#b8742a'); R(ctx, 28, 6, 1, 5, '#7a4a1a');
    R(ctx, 6, 18, 9, 9, '#5a7a3a'); R(ctx, 8, 20, 5, 5, '#6f8f4a'); R(ctx, 13, 21, 7, 2, '#3a4a2a');
    R(ctx, 34, 6, 9, 9, '#8a6a4a'); R(ctx, 36, 8, 5, 5, '#a88a60'); R(ctx, 30, 9, 5, 2, '#3a3028');
    R(ctx, 24, 21, 2, 2, C.yellow); R(ctx, 26, 21, 2, 1, C.orange);
  },
  kartrace(ctx) {
    R(ctx, 0, 0, 48, 11, '#6aa8e8'); R(ctx, 0, 11, 48, 21, '#55a044');
    R(ctx, 30, 3, 8, 2, C.white); R(ctx, 28, 4, 12, 2, C.white); R(ctx, 6, 5, 7, 2, C.white);
    for (const [x, h] of [[0, 3], [8, 4], [16, 2], [34, 4], [42, 3]]) R(ctx, x, 11 - h, 8, h, '#4f9a4f');
    for (let y = 11; y < 32; y++) {
      const half = 2 + (y - 11) * 1.1;
      R(ctx, Math.round(24 - half), y, Math.round(half * 2), 1, '#5b5c64');
      if ((y >> 1) % 2) { R(ctx, Math.round(24 - half) - 1, y, 1, 1, C.red); R(ctx, Math.round(24 + half), y, 1, 1, C.white); }
    }
    for (const x of [5, 40]) { R(ctx, x + 1, 17, 1, 3, C.brown); R(ctx, x, 12, 3, 5, '#2f7a3b'); }
    const kart = ['..####..', '.#pppp#.', '#pppppp#', '########', '##....##'];
    sprite(ctx, kart, 20, 24, { '#': '#26263a', p: C.red });
  },
  snake(ctx) {
    for (let y = 0; y < 32; y += 4) for (let x = 0; x < 48; x += 4) R(ctx, x, y, 4, 4, ((x + y) / 4) % 2 ? '#8cc152' : '#81b84a');
    for (const [x, y] of [[2, 5], [3, 5], [4, 5], [5, 5], [5, 4], [5, 3], [6, 3], [7, 3]]) R(ctx, x * 4, y * 4, 4, 4, '#2a8a4a');
    for (const [x, y] of [[9, 1], [9, 2], [10, 2], [11, 2]]) R(ctx, x * 4, y * 4, 4, 4, C.purple);
    R(ctx, 32, 24, 3, 3, '#d62828'); R(ctx, 33, 23, 1, 1, '#3c8a45');
  },
  paddle(ctx) {
    R(ctx, 0, 0, 48, 32, W.oak); R(ctx, 8, 0, 32, 32, '#1f5fa8');
    R(ctx, 8, 0, 32, 1, C.white); R(ctx, 8, 31, 32, 1, C.white); R(ctx, 23, 0, 1, 32, C.white); R(ctx, 8, 15, 32, 1, C.white);
    R(ctx, 10, 10, 2, 10, C.cyan); R(ctx, 36, 6, 2, 10, C.red);
    R(ctx, 29, 18, 2, 2, '#ff8a1a');
    R(ctx, 16, 2, 12, 2, C.yellow); R(ctx, 18, 28, 12, 2, C.green);
  },
  breakout(ctx) {
    R(ctx, 0, 0, 48, 32, '#2a2420');
    const rows = ['#b5553c', '#c9784e', '#d9b77a', '#8a9a5a', '#6f8196'];
    rows.forEach((c, r) => { for (let x = 0; x < 8; x++) if (!(r === 4 && (x === 3 || x === 4))) R(ctx, 1 + x * 6, 2 + r * 3, 5, 2, c); });
    R(ctx, 17, 28, 12, 2, C.cyan); R(ctx, 26, 21, 2, 2, C.white);
  },
  bomber(ctx) {
    R(ctx, 0, 0, 48, 32, '#70ad4f');
    for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) R(ctx, 4 + x * 8, 4 + y * 8, 4, 4, '#8a8a92');
    for (const [x, y] of [[8, 0], [16, 24], [32, 8], [40, 16]]) { R(ctx, x, y + 1, 4, 3, '#b5553c'); R(ctx, x, y, 4, 2, '#6a2a22'); }
    disc(ctx, 22, 18, 3, '#1a1a28'); R(ctx, 23, 13, 1, 2, C.white); R(ctx, 24, 12, 1, 1, C.orange);
    R(ctx, 36, 26, 5, 5, C.white); R(ctx, 37, 27, 3, 2, C.red);
  },
  ghosts(ctx) {
    R(ctx, 0, 0, 48, 32, '#2e2228');
    for (const [x, y, w, h] of [[2, 2, 44, 2], [2, 28, 44, 2], [2, 2, 2, 28], [44, 2, 2, 28], [12, 10, 10, 3], [28, 19, 10, 3]]) R(ctx, x, y, w, h, '#4a4458');
    for (let x = 6; x < 44; x += 4) R(ctx, x, 6, 1, 1, '#ffd27a');
    for (let x = 6; x < 26; x += 4) R(ctx, x, 25, 1, 1, '#ffd27a');
    R(ctx, 40, 24, 3, 3, '#e8781a'); R(ctx, 41, 23, 1, 1, '#3c8a45');
    const ghost = ['.####.', '######', '#o##o#', '######', '######', '#.##.#'];
    sprite(ctx, ghost, 30, 9, { '#': '#f4eef8', o: '#2a1a2e' });
    disc(ctx, 11, 18, 3, C.yellow); R(ctx, 12, 17, 3, 3, '#2e2228');
  },
  blocks(ctx) {
    R(ctx, 0, 0, 48, 32, W.walnut); R(ctx, 12, 0, 24, 32, '#c8945a'); R(ctx, 14, 0, 20, 32, '#2a1f18');
    const cells = [[0, 7, '#3aa8c8'], [1, 7, '#3aa8c8'], [2, 7, '#3aa8c8'], [3, 7, '#3aa8c8'], [0, 6, '#8a5ab8'], [1, 6, '#8a5ab8'], [1, 5, '#8a5ab8'], [3, 6, '#e8863a'], [4, 6, '#e8863a'], [4, 7, '#e8863a'], [4, 5, '#e8863a'], [2, 1, '#5aa84a'], [3, 1, '#5aa84a'], [1, 2, '#5aa84a'], [2, 2, '#5aa84a']];
    for (const [x, y, c] of cells) { R(ctx, 14 + x * 4, y * 4, 4, 4, c); R(ctx, 14 + x * 4, y * 4, 4, 1, 'rgba(255,255,255,0.45)'); }
  },
  minigolf(ctx) {
    R(ctx, 0, 0, 48, 32, '#4a8a3a'); R(ctx, 3, 3, 42, 26, '#9a6234'); R(ctx, 5, 5, 38, 22, '#3fae55');
    for (let x = 5; x < 43; x += 8) R(ctx, x, 5, 4, 22, '#36a24c');
    disc(ctx, 36, 14, 2, '#10100a'); R(ctx, 36, 5, 1, 9, C.white); R(ctx, 37, 5, 5, 3, '#e63946');
    disc(ctx, 11, 22, 1, C.white);
    for (let i = 1; i < 5; i++) R(ctx, 11 + i * 3, 22 - i * 2, 1, 1, C.white);
  },
  memory(ctx) {
    R(ctx, 0, 0, 48, 32, '#1f6a45');
    for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) { R(ctx, 3 + x * 9, 2 + y * 10, 7, 8, '#fbf8f0'); R(ctx, 4 + x * 9, 3 + y * 10, 5, 6, '#b8302a'); }
    R(ctx, 12, 12, 7, 8, '#fbf8f0'); R(ctx, 30, 2, 7, 8, '#fbf8f0');
    disc(ctx, 15, 16, 2, '#d62839'); disc(ctx, 33, 6, 2, '#d62839');
  },
  mines(ctx) {
    R(ctx, 0, 0, 48, 32, '#4a7a34');
    for (let y = 0; y < 5; y++) for (let x = 0; x < 8; x++) R(ctx, x * 6, y * 6 + 1, 6, 6, (x + y * 3) % 5 === 0 || (x > 2 && x < 6 && y > 1) ? '#e5c29f' : (x + y) % 2 ? '#8cc152' : '#81b84a');
    R(ctx, 25, 14, 1, 3, '#1976d2'); R(ctx, 31, 20, 2, 3, '#d32f2f');
    R(ctx, 38, 2, 1, 4, '#3a2a1c'); R(ctx, 39, 2, 3, 2, C.red);
    disc(ctx, 8, 27, 1, '#1a1a1a');
  },
  invaders(ctx) {
    R(ctx, 0, 0, 48, 32, '#06081a');
    const alien = ['..#..#..', '.######.', '##.##.##', '########', '#.#..#.#'];
    for (let i = 0; i < 4; i++) sprite(ctx, alien, 4 + i * 11, 3, { '#': '#8ad84a' });
    for (let i = 0; i < 3; i++) sprite(ctx, alien, 9 + i * 11, 10, { '#': '#c86ad8' });
    R(ctx, 0, 30, 48, 2, '#2a6ab8'); R(ctx, 8, 30, 10, 2, '#4a9a4a'); R(ctx, 30, 30, 12, 2, '#4a9a4a');
    R(ctx, 21, 26, 7, 3, C.cyan); R(ctx, 24, 24, 1, 2, C.cyan); R(ctx, 24, 18, 1, 3, C.yellow);
  },
  rocks(ctx) {
    R(ctx, 0, 0, 48, 32, '#05060e');
    disc(ctx, 10, 9, 5, '#7a6a5a'); disc(ctx, 38, 22, 6, '#6e6660'); disc(ctx, 34, 6, 2, '#86705a');
    R(ctx, 8, 7, 2, 2, '#4e4238'); R(ctx, 40, 20, 2, 2, '#4a4038');
    const ship = ['...#...', '..#.#..', '.#...#.', '#######'];
    sprite(ctx, ship, 18, 20, { '#': C.cyan });
    R(ctx, 21, 16, 1, 2, C.yellow);
    R(ctx, 3, 28, 1, 1, C.white); R(ctx, 44, 2, 1, 1, C.white); R(ctx, 26, 3, 1, 1, C.white);
  },
  paintball(ctx) {
    R(ctx, 0, 0, 48, 12, '#6fb3ea'); R(ctx, 0, 10, 48, 2, '#cfe8f7');
    R(ctx, 0, 12, 48, 20, '#5fae45'); for (let x = 0; x < 48; x += 8) R(ctx, x, 12, 4, 20, '#56a33f');
    R(ctx, 0, 11, 48, 1, '#2a342c');
    R(ctx, 4, 9, 9, 8, '#e63946'); R(ctx, 4, 12, 9, 1, C.white);
    R(ctx, 33, 7, 10, 10, '#1d6fd8'); R(ctx, 33, 11, 10, 1, C.white);
    R(ctx, 20, 8, 5, 9, '#ffc21a'); R(ctx, 20, 11, 5, 1, C.white);
    disc(ctx, 37, 10, 2, '#ff3ea5'); R(ctx, 35, 13, 1, 2, '#ff3ea5'); R(ctx, 40, 12, 1, 1, '#ff3ea5');
    disc(ctx, 26, 12, 1, '#5dff8a');
    R(ctx, 30, 24, 14, 4, '#34373f'); R(ctx, 40, 23, 8, 2, '#23252b'); R(ctx, 32, 28, 3, 4, '#23252b');
    disc(ctx, 33, 21, 2, '#ff3ea5'); R(ctx, 29, 28, 4, 4, '#e8b894');
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
