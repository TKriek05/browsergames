// Zeeslag bot. Uses ONLY what the bot may see (its view), never the hidden
// ships. easy: random shots · normal: hunt + finish off · hard: probability map.
import rules, { SIZE, FLEET } from '../../shared/rules/battleship.js';

const around4 = (c) => [c - SIZE, c + SIZE, c % SIZE ? c - 1 : -1, c % SIZE < SIZE - 1 ? c + 1 : -1].filter((n) => n >= 0 && n < SIZE * SIZE);

function openHits(board) {
  const sunkCells = new Set(board.sunk.flatMap((s) => s.cells));
  const hits = [];
  board.shots.forEach((v, c) => { if (v === 2 && !sunkCells.has(c)) hits.push(c); });
  return hits;
}

function finishOff(shots, hits) {
  if (hits.length >= 2) {
    // Hits in a line: extend it at both ends.
    const horizontal = Math.floor(hits[0] / SIZE) === Math.floor(hits[1] / SIZE);
    const sorted = [...hits].sort((a, b) => a - b);
    const step = horizontal ? 1 : SIZE;
    const ends = [sorted[0] - step, sorted[sorted.length - 1] + step].filter((c) =>
      c >= 0 && c < SIZE * SIZE && !shots[c] && (!horizontal || Math.floor(c / SIZE) === Math.floor(sorted[0] / SIZE)));
    if (ends.length) return ends;
  }
  return hits.flatMap(around4).filter((c) => !shots[c]);
}

function probabilityMap(board, hits) {
  const shots = board.shots;
  const sunkNames = new Set(board.sunk.map((s) => s.name));
  const lengths = FLEET.filter((f) => !sunkNames.has(f.name)).map((f) => f.len);
  const heat = new Array(SIZE * SIZE).fill(0);
  const hitSet = new Set(hits);
  for (const len of lengths) {
    for (const dir of ['h', 'v']) {
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          if (dir === 'h' ? x + len > SIZE : y + len > SIZE) continue;
          const cells = [];
          let ok = true;
          let covers = 0;
          for (let i = 0; i < len && ok; i++) {
            const c = dir === 'h' ? y * SIZE + x + i : (y + i) * SIZE + x;
            if (shots[c] === 1 || shots[c] === 3 || (shots[c] === 2 && !hitSet.has(c))) ok = false;
            if (hitSet.has(c)) covers++;
            cells.push(c);
          }
          if (!ok) continue;
          const weight = hits.length ? (covers ? 1 + covers * 30 : 0.05) : 1;
          for (const c of cells) if (!shots[c]) heat[c] += weight;
        }
      }
    }
  }
  return heat;
}

export default {
  worker: false,
  pick(state, seat, level, rng) {
    if (state.phase === 'place') return { type: 'random' };
    const view = rules.view(state, seat);
    const board = view.boards[1 - seat];
    const shots = board.shots;
    const free = [];
    shots.forEach((v, c) => { if (!v) free.push(c); });
    const random = (list) => list[Math.floor(rng() * list.length)];
    if (!free.length) return null;
    if (level === 'easy') return { type: 'fire', c: random(free) };

    const hits = openHits(board);
    if (level === 'normal') {
      const targets = hits.length ? finishOff(shots, hits) : [];
      if (targets.length) return { type: 'fire', c: random(targets) };
      const parity = free.filter((c) => (c % SIZE + Math.floor(c / SIZE)) % 2 === 0);
      return { type: 'fire', c: random(parity.length ? parity : free) };
    }
    const heat = probabilityMap(board, hits);
    let best = -1;
    let bestHeat = -1;
    for (const c of free) {
      const h = heat[c] + rng() * 0.01;
      if (h > bestHeat) { bestHeat = h; best = c; }
    }
    return { type: 'fire', c: best };
  },
};
