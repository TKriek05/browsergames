// Spetterveld bot navigation over several levels. The field is cut into
// cells; every cell has a node per surface you can stand on there (the
// ground, a crate top, a step, an upper floor). Nodes of neighbouring cells
// are linked when you can walk (up to a step), drop down or jump up between
// them. A breadth-first search from the goal gives every node its distance;
// a bot walks to the neighbouring node that is closer and jumps when that
// one is higher than a step. Built once per level and cached.
import { PB_PHYS, JUMP_REACH, overlaps, groundHeight } from '../../shared/physics/paintball.js';

export const NAV_CELL = 4;
const BODY_R = PB_PHYS.RADIUS; // free ground starts exactly where a top stops counting (no gap between them)
const MAX_DROP = 60;
const cache = new Map();

export function navFor(level) {
  let nav = cache.get(level.key);
  if (!nav) {
    nav = buildNav(level);
    cache.set(level.key, nav);
  }
  return nav;
}

// Surfaces at (x, y) where a body can stand, as the physics sees it: the
// ground or a solid top that is the highest one within a step under the
// feet (so a low step next to a higher one is not a surface of its own), on
// something wider than a wall (bots do not balance on wall tops), with room
// for the body above.
function surfaces(level, x, y) {
  const r = PB_PHYS.RADIUS;
  const tops = [0];
  for (const o of level.solids) if (overlaps(o, x, y, r)) tops.push(o.z1);
  tops.sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < tops.length; i++) {
    const h = tops[i];
    if (out.length && Math.abs(out[out.length - 1] - h) < 0.01) continue;
    if (Math.abs(groundHeight(level, x, y, r, h + PB_PHYS.STEP) - h) > 0.01) continue;
    if (h > 0 && !level.solids.some((o) => Math.abs(o.z1 - h) < 0.01 && wide(o) && overlaps(o, x, y, r))) continue;
    if (!roomFor(level, x, y, h)) continue;
    out.push(h);
  }
  return out;
}

const wide = (o) => (o.t === 'can' ? o.r >= 3 : Math.min(o.w, o.h) >= 4);

// Room for a body standing at h: nothing higher than a step in the way.
function roomFor(level, x, y, h) {
  if (x < BODY_R || y < BODY_R || x > level.width - BODY_R || y > level.height - BODY_R) return false;
  for (const o of level.solids) {
    if (o.z1 > h + PB_PHYS.STEP && o.z0 < h + PB_PHYS.HEIGHT && overlaps(o, x, y, BODY_R)) return false;
  }
  return true;
}

// Nothing solid between heights lo and hi over (x, y) (a body falls or jumps through there).
function clearColumn(level, x, y, lo, hi) {
  for (const o of level.solids) {
    if (o.z1 > lo && o.z0 < hi && overlaps(o, x, y, PB_PHYS.RADIUS - 1)) return false;
  }
  return true;
}

function buildNav(level) {
  const cols = Math.ceil(level.width / NAV_CELL);
  const rows = Math.ceil(level.height / NAV_CELL);
  const first = new Int32Array(cols * rows + 1);
  const hs = [];
  const cells = [];
  for (let c = 0; c < cols * rows; c++) {
    first[c] = hs.length;
    const x = ((c % cols) + 0.5) * NAV_CELL;
    const y = (Math.floor(c / cols) + 0.5) * NAV_CELL;
    for (const h of surfaces(level, x, y)) {
      hs.push(h);
      cells.push(c);
    }
  }
  first[cols * rows] = hs.length;
  const n = hs.length;
  const height = Float32Array.from(hs);
  const cell = Int32Array.from(cells);

  // Links: walk (within a step), drop (down), jump (up to JUMP_REACH).
  const near = (c, h) => {
    for (let k = first[c]; k < first[c + 1]; k++) if (Math.abs(height[k] - h) <= PB_PHYS.STEP) return true;
    return false;
  };
  const out = Array.from({ length: n }, () => []);
  for (let a = 0; a < n; a++) {
    const c = cell[a];
    const cx = c % cols;
    const cy = (c - cx) / cols;
    const h = height[a];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const c2 = ny * cols + nx;
        for (let b = first[c2]; b < first[c2 + 1]; b++) {
          const h2 = height[b];
          const up = h2 - h;
          if (up > JUMP_REACH - 0.5 || -up > MAX_DROP) continue;
          // Jumping up: room above us all the way; dropping down: room over the landing spot (no floor in between).
          if (up > PB_PHYS.STEP && !clearColumn(level, (cx + 0.5) * NAV_CELL, (cy + 0.5) * NAV_CELL, h + PB_PHYS.STEP, h2 + PB_PHYS.HEIGHT)) continue;
          if (-up > PB_PHYS.STEP && !clearColumn(level, (nx + 0.5) * NAV_CELL, (ny + 0.5) * NAV_CELL, h2 + PB_PHYS.STEP, h + PB_PHYS.HEIGHT)) continue;
          // Diagonals only when both sides are open at one of the two heights (no corner cutting).
          if (dx && dy && !((near(cy * cols + nx, h) || near(cy * cols + nx, h2)) && (near(ny * cols + cx, h) || near(ny * cols + cx, h2)))) continue;
          out[a].push(b);
        }
      }
    }
  }
  // Compressed forward and backward adjacency.
  const fwdStart = new Int32Array(n + 1);
  let edges = 0;
  for (let a = 0; a < n; a++) {
    fwdStart[a] = edges;
    edges += out[a].length;
  }
  fwdStart[n] = edges;
  const fwd = new Int32Array(edges);
  const inCount = new Int32Array(n + 1);
  for (let a = 0; a < n; a++) {
    fwd.set(out[a], fwdStart[a]);
    for (const b of out[a]) inCount[b]++;
  }
  const backStart = new Int32Array(n + 1);
  for (let b = 0; b < n; b++) backStart[b + 1] = backStart[b] + inCount[b];
  const back = new Int32Array(edges);
  const fill = backStart.slice(0, n);
  for (let a = 0; a < n; a++) for (const b of out[a]) back[fill[b]++] = a;
  return { cols, rows, first, height, cell, count: n, fwdStart, fwd, backStart, back, queue: new Int32Array(n) };
}

// The node for a body at (x, y, z): the closest cell (up to two away) with a
// surface at the feet' level; in the air the closest surface below.
// -1 = none.
export function nodeAt(nav, x, y, z) {
  const k = search(nav, x, y, (h) => (Math.abs(h - z) <= PB_PHYS.STEP ? Math.abs(h - z) : -1));
  return k >= 0 ? k : search(nav, x, y, (h) => (h <= z + PB_PHYS.STEP + 0.5 ? z - h : -1));
}

// The best node (lowest ring * 4 + score(h), score < 0 = not this one) in the
// cell of (x, y) or the rings around it.
function search(nav, x, y, score) {
  const cx = Math.min(nav.cols - 1, Math.max(0, Math.floor(x / NAV_CELL)));
  const cy = Math.min(nav.rows - 1, Math.max(0, Math.floor(y / NAV_CELL)));
  let best = -1;
  let bestScore = Infinity;
  for (let ring = 0; ring <= 2 && best < 0; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= nav.cols || ny >= nav.rows) continue;
        const c = ny * nav.cols + nx;
        for (let k = nav.first[c]; k < nav.first[c + 1]; k++) {
          const sc = score(nav.height[k]);
          if (sc < 0) continue;
          if (sc + ring * 4 < bestScore) {
            bestScore = sc + ring * 4;
            best = k;
          }
        }
      }
    }
  }
  return best;
}

export function nodeX(nav, k) {
  return ((nav.cell[k] % nav.cols) + 0.5) * NAV_CELL;
}
export function nodeY(nav, k) {
  return (Math.floor(nav.cell[k] / nav.cols) + 0.5) * NAV_CELL;
}

// Distance (in links) from every node to the goal, into dist (-1 = can not get there).
export function distancesTo(nav, goal, dist) {
  dist.fill(-1);
  if (goal < 0) return dist;
  const q = nav.queue;
  let head = 0;
  let tail = 0;
  q[tail++] = goal;
  dist[goal] = 0;
  while (head < tail) {
    const b = q[head++];
    for (let i = nav.backStart[b]; i < nav.backStart[b + 1]; i++) {
      const a = nav.back[i];
      if (dist[a] >= 0) continue;
      dist[a] = dist[b] + 1;
      q[tail++] = a;
    }
  }
  return dist;
}

// Every node you can get to from `from` (for tests).
export function reachable(nav, from) {
  const seen = new Uint8Array(nav.count);
  const q = [from];
  seen[from] = 1;
  while (q.length) {
    const a = q.pop();
    for (let i = nav.fwdStart[a]; i < nav.fwdStart[a + 1]; i++) {
      const b = nav.fwd[i];
      if (!seen[b]) {
        seen[b] = 1;
        q.push(b);
      }
    }
  }
  return seen;
}

// The next node on the way to the goal from node k (the neighbour with the
// lowest distance), or -1 when k is the goal or cut off.
export function nextNode(nav, k, dist) {
  let best = -1;
  let bestD = dist[k] >= 0 ? dist[k] : Infinity;
  for (let i = nav.fwdStart[k]; i < nav.fwdStart[k + 1]; i++) {
    const b = nav.fwd[i];
    if (dist[b] >= 0 && dist[b] < bestD) {
      bestD = dist[b];
      best = b;
    }
  }
  return best;
}
