// Spetterveld: the looks of the big fields with height (Bouwplaats,
// Westernstad, Kasteelruïne): every kind of solid from
// shared/maps/paintball-levels.js drawn in its own style, and the world
// around each field. Game (x, y, z) → 3D (x, z, y).

// Colours per kind: [side, top].
const KIND = {
  concrete: ['#b9b6ae', '#a8a59d'], deck: ['#a6a39b', '#b3b0a8'], cstep: ['#c2bfb7', '#cfccc4'], pillar: ['#a09d95', '#b0ada5'],
  bags: ['#ddd6c2', '#e8e2d0'], sand: ['#d9bf88', '#e2cb98'], rebar: ['#8a4a2a', '#9a5a36'], dixi: ['#2f7fd0', '#f2f2ee'],
  plank: ['#a8784a', '#8a6038'], plank2: ['#8f6a48', '#7a5a3c'], boards: ['#8a5e3a', '#9a6c44'], roof: ['#6a4a3a', '#5a3e30'],
  brick: ['#b0603e', '#9a5236'], step: ['#8a6a44', '#9a7a52'], counter: ['#5e3c24', '#7a5234'], trough: ['#7a5a3a', '#4a8ab0'],
  rail: ['#8a6a44', '#9a7a52'], wellroof: ['#6a4a2e', '#5a3e26'], cart: ['#8a6038', '#9a6c44'],
  stone: ['#8f8a80', '#7e7a72'], flags: ['#7a766e', '#858178'], sstep: ['#9a958a', '#a8a397'], rampart: ['#8f8a80', '#8a857c'],
  merlon: ['#9a958a', '#a39e93'], ruin: ['#8a857a', '#958f84'], keep: ['#8f8a80', '#99948a'], rubble: ['#8a857a', '#979185'],
  dais: ['#b0a898', '#bdb5a5'], statue: ['#c8c4b8', '#d4d0c4'],
};

// Draw a solid of a big field. Returns false for kinds it does not know.
export function levelSolid(b, o, i, th, rnd) {
  const h = o.z1 - o.z0;
  const vary = (hex) => shade(hex, (((i * 37) % 11) - 5) * 0.012); // every block a slightly different tone
  switch (o.kind) {
    case 'crate': {
      // Stacked crates of 8, each with its dark bands.
      const n = Math.max(1, Math.round(h / 8));
      const ch = h / n;
      for (let k = 0; k < n; k++) {
        const y = o.z0 + k * ch;
        b.color(k % 2 ? th.wood[0] : th.wood[1]).box(o.x, y, o.y, o.w - (k % 2) * 0.4, ch - 0.05, o.h - (k % 2) * 0.4, { top: th.wood[0] });
        b.color('#5a4128').box(o.x, y, o.y, o.w + 0.2, 1, o.h + 0.2).box(o.x, y + ch - 1, o.y, o.w + 0.2, 1, o.h + 0.2);
      }
      return true;
    }
    case 'container': {
      const n = Math.max(1, Math.round(h / 13.5));
      const ch = h / n;
      const alongX = o.w >= o.h;
      for (let k = 0; k < n; k++) {
        const c = th.containers[(i + k * 2) % th.containers.length];
        const y0 = o.z0 + k * ch;
        b.color(c).box(o.x, y0, o.y, o.w, ch - 0.3, o.h, { top: shade(c, 0.1) });
        b.color(shade(c, -0.18));
        const len = alongX ? o.w : o.h;
        for (let t = -len / 2 + 2; t < len / 2 - 1; t += 2.6) {
          if (alongX) b.box(o.x + t, y0 + 0.4, o.y, 0.5, ch - 1.1, o.h + 0.35);
          else b.box(o.x, y0 + 0.4, o.y + t, o.w + 0.35, ch - 1.1, 0.5);
        }
      }
      return true;
    }
    case 'pipe': {
      b.color('#b0aea8').cylinder(o.x, o.z0, o.y, o.r, h, 14, { top: '#c0beb8' });
      b.color('#4a4844').cylinder(o.x, o.z1, o.y, o.r * 0.7, 0.05, 12);
      return true;
    }
    case 'digger': {
      b.color('#e8b92e').box(o.x, o.z0 + 3, o.y, o.w - 4, h - 3, o.h - 2, { top: '#f0c63e' });
      b.color('#2a2a2e').box(o.x, o.z0, o.y - o.h / 2 + 2, o.w, 4, 4).box(o.x, o.z0, o.y + o.h / 2 - 2, o.w, 4, 4); // tracks
      // The arm with its bucket, resting on the ground in front.
      b.color('#e0ae24').box(o.x + o.w / 2 + 6, o.z0 + 8, o.y, 14, 2.4, 2.4);
      b.color('#3a3a3e').box(o.x + o.w / 2 + 13, o.z0, o.y, 5, 5, 7);
      return true;
    }
    case 'cab': {
      b.color('#e8b92e').box(o.x, o.z0, o.y, o.w, h - 1, o.h, { top: '#d8a91e' });
      b.color('#35506a', { emissive: 0.1 }).box(o.x + o.w / 2 + 0.05, o.z0 + 3, o.y, 0.2, h - 6, o.h - 3);
      b.color('#2a2a2e').box(o.x, o.z1 - 1, o.y, o.w + 1, 1, o.h + 1);
      return true;
    }
    case 'dixi': {
      b.color(i % 2 ? '#2f7fd0' : '#3a9a4a').box(o.x, o.z0, o.y, o.w, h - 1.5, o.h);
      b.color('#f2f2ee').box(o.x, o.z1 - 1.5, o.y, o.w + 0.6, 1.5, o.h + 0.6);
      b.color('#f2f2ee').box(o.x - o.w / 2 - 0.05, o.z0 + 2, o.y, 0.2, 14, o.h - 3); // door
      return true;
    }
    case 'bricks': {
      b.color(th.wood[0]).box(o.x, o.z0, o.y, o.w, 1.2, o.h);
      b.color('#a8553a').box(o.x, o.z0 + 1.2, o.y, o.w - 0.6, h - 1.2, o.h - 0.6, { top: '#b8654a' });
      b.color('#c9b8a0');
      for (let y = o.z0 + 3; y < o.z1 - 0.5; y += 2) b.box(o.x, y, o.y, o.w - 0.4, 0.15, o.h - 0.4);
      return true;
    }
    case 'bags': {
      const n = Math.max(1, Math.round(o.w / 5));
      for (let k = 0; k < n; k++) {
        const x = o.x - o.w / 2 + (k + 0.5) * (o.w / n);
        b.color(k % 2 ? '#ddd6c2' : '#d2cab4').box(x, o.z0, o.y, o.w / n - 0.3, h, o.h, { top: '#e8e2d0' });
      }
      return true;
    }
    case 'fence': {
      // A building-site fence panel: galvanised frame, mesh, concrete feet.
      b.color('#9aa0a6').box(o.x, o.z0, o.y, o.w, h, o.h);
      b.color('#c8ccd0').box(o.x, o.z0 + 1.5, o.y, o.w + 0.2, h - 3, o.h + 0.2);
      b.color('#8a8680');
      const alongX = o.w >= o.h;
      const len = alongX ? o.w : o.h;
      for (let t = -len / 2 + 3; t < len / 2; t += 10) b.box(alongX ? o.x + t : o.x, o.z0, alongX ? o.y : o.y + t, 3, 1.2, 3);
      return true;
    }
    case 'barrel': {
      b.color('#9a4a2a').cylinder(o.x, o.z0, o.y, o.r, h, 10, { top: '#7a3a22' });
      b.color('#3a3a36');
      for (const y of [1.5, h / 2, h - 2]) b.cylinder(o.x, o.z0 + y, o.y, o.r + 0.2, 0.8, 10);
      return true;
    }
    case 'wagon': {
      b.color('#8a6038').box(o.x, o.z0 + 4, o.y, o.w, h - 4, o.h, { top: '#d8b860' });
      b.color('#5a3e26').box(o.x, o.z0 + 4, o.y, o.w + 0.4, 1.2, o.h + 0.4);
      b.color('#3a2a1e');
      const alongX = o.w >= o.h;
      for (const d of [-0.33, 0.33]) {
        if (alongX) {
          b.wheel(o.x + d * o.w, 4.5, o.y - o.h / 2 - 0.8, 4.5, 1.2, 12, '#8a6a44');
          b.wheel(o.x + d * o.w, 4.5, o.y + o.h / 2 + 0.8, 4.5, 1.2, 12, '#8a6a44');
        } else b.box(o.x, 0, o.y + d * o.h, o.w + 2, 5, 2);
      }
      return true;
    }
    case 'hay': {
      b.color(th.hay[i % 2]).box(o.x, o.z0, o.y, o.w, h, o.h, { top: shade(th.hay[0], 0.08) });
      b.color('#8a6a2a');
      for (const t of [-0.25, 0.25]) b.box(o.x + t * o.w, o.z0, o.y, 0.5, h + 0.1, o.h + 0.2);
      return true;
    }
    case 'well': {
      b.color('#8a8a82').cylinder(o.x, o.z0, o.y, o.r, h, 14, { top: '#9a9a92' });
      b.color('#2a3a44').cylinder(o.x, o.z1, o.y, o.r - 1.2, 0.05, 12);
      return true;
    }
    case 'post':
      b.color('#6a4a2e').cylinder(o.x, o.z0, o.y, o.r, h, 6);
      return true;
    case 'column': {
      b.color('#c8c0ae').cylinder(o.x, o.z0, o.y, o.r, h, 10, { top: '#b8b09e' });
      b.color('#b8b09e').cylinder(o.x, o.z0, o.y, o.r + 0.8, 1.5, 10);
      return true;
    }
    case 'statue': {
      // A knight on the dais: legs, body, head, a sword along the side.
      b.color('#c8c4b8').box(o.x, o.z0, o.y, o.w, h * 0.45, o.h);
      b.color('#d4d0c4').box(o.x, o.z0 + h * 0.45, o.y, o.w + 1, h * 0.4, o.h + 1);
      b.color('#c8c4b8').sphere(o.x, o.z1 - 0.2, o.y, 1.8, 7, 5);
      b.color('#a8a49a').box(o.x + o.w / 2 + 1, o.z0 + 1, o.y, 0.6, h * 0.8, 0.6);
      return true;
    }
    case 'trough': {
      b.color('#7a5a3a').box(o.x, o.z0, o.y, o.w, h, o.h);
      b.color('#4a8ab0', { emissive: 0.1 }).box(o.x, o.z1 - 0.8, o.y, o.w - 1.2, 0.85, o.h - 1.2);
      return true;
    }
    case 'plank':
    case 'plank2': {
      const [side, dark] = KIND[o.kind];
      b.color(vary(side)).box(o.x, o.z0, o.y, o.w, h, o.h, { top: dark });
      // Plank seams along the long side.
      b.color(dark);
      const alongX = o.w >= o.h;
      for (let y = o.z0 + 3; y < o.z1 - 0.5; y += 3) {
        if (alongX) b.box(o.x, y, o.y, o.w + 0.12, 0.25, o.h + 0.12);
        else b.box(o.x, y, o.y, o.w + 0.12, 0.25, o.h + 0.12);
      }
      return true;
    }
    default: {
      const k = KIND[o.kind];
      if (!k) return false;
      if (o.t === 'can') b.color(vary(k[0])).cylinder(o.x, o.z0, o.y, o.r, h, 10, { top: k[1] });
      else b.color(vary(k[0])).box(o.x, o.z0, o.y, o.w, h, o.h, { top: k[1] });
      return true;
    }
  }
}

// --- Surroundings ------------------------------------------------------------------------------
export function levelSurroundings(b, arena, th, rnd) {
  const W = arena.width;
  const H = arena.height;
  if (arena.key === 'bouw') {
    // Site fences, a tower crane, site cabins, half-built blocks further out.
    b.color('#c8ccd0');
    for (let x = -30; x < W + 30; x += 12) {
      b.box(x, 0, -24, 11.6, 18, 0.4).box(x, 0, H + 24, 11.6, 18, 0.4);
    }
    towerCrane(b, W + 90, -70, 150);
    for (let k = 0; k < 3; k++) {
      const x = -70;
      const y = 60 + k * 28;
      b.color(k % 2 ? '#e8e4da' : '#dcd6c8').box(x, 0, y, 30, 12, 24, { top: '#8a8a8a' });
      b.color('#35506a', { emissive: 0.1 }).box(x + 15.1, 4, y, 0.3, 5, 14);
    }
    for (let k = 0; k < 5; k++) block(b, -220 + k * 230, -220 - (k % 2) * 60, 90, 60, 40 + (k % 3) * 26, rnd);
    for (let k = 0; k < 4; k++) block(b, -120 + k * 260, H + 200 + (k % 2) * 50, 100, 70, 30 + (k % 2) * 30, rnd);
  } else if (arena.key === 'western') {
    // Desert, mesas on the horizon, cacti, a church and a wind pump.
    b.color('#d9b27a').face([[-1500, -0.1, -1500], [-1500, -0.1, H + 1500], [W + 1500, -0.1, H + 1500], [W + 1500, -0.1, -1500]], [0, 1, 0]);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + rnd() * 0.2;
      const d = 900 + rnd() * 300;
      const x = W / 2 + Math.cos(a) * d;
      const z = H / 2 + Math.sin(a) * d;
      const r = 80 + rnd() * 90;
      const hgt = 70 + rnd() * 90;
      b.color(k % 2 ? '#b8603a' : '#a8553a').cylinder(x, 0, z, r, hgt * 0.8, 9, { top: '#c8784a' });
      b.color('#c8704a').cylinder(x, hgt * 0.8, z, r * 0.8, hgt * 0.2, 9, { top: '#d8885a' });
    }
    for (let k = 0; k < 40; k++) {
      const side = Math.floor(rnd() * 4);
      const t = rnd();
      const d = 40 + rnd() * 300;
      const x = side < 2 ? -60 + t * (W + 120) : side === 2 ? -d : W + d;
      const z = side === 0 ? -d : side === 1 ? H + d : -60 + t * (H + 120);
      cactus(b, x, z, 0.8 + rnd() * 0.7, rnd);
    }
    // Church with a bell tower behind the east end.
    b.color('#efe6d4').box(W + 110, 0, H / 2, 60, 30, 40);
    b.color('#8a4a32').face([[W + 80, 30, H / 2 - 21], [W + 140, 30, H / 2 - 21], [W + 140, 44, H / 2], [W + 80, 44, H / 2]], [0, 1, -1])
      .face([[W + 80, 30, H / 2 + 21], [W + 80, 44, H / 2], [W + 140, 44, H / 2], [W + 140, 30, H / 2 + 21]], [0, 1, 1]);
    b.color('#efe6d4').box(W + 72, 0, H / 2, 16, 62, 16);
    b.color('#8a4a32').cone(W + 72, 62, H / 2, 11, 18, 4);
    // Wind pump.
    b.color('#8a8a86');
    for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) b.box(-80 + dx, 0, 60 + dz, 1, 50, 1);
    b.color('#c8c4bc').cylinder(-80, 50, 60, 9, 0.6, 12);
  } else if (arena.key === 'kasteel') {
    // A moat around the walls, grassy hills, a forest, pennants on the towers.
    const moat = (x0, z0, x1, z1) => b.face([[x0, 0.02, z0], [x0, 0.02, z1], [x1, 0.02, z1], [x1, 0.02, z0]], [0, 1, 0]);
    b.color('#3d6f8a', { emissive: 0.05 });
    moat(-60, -60, W + 60, -3);
    moat(-60, H + 3, W + 60, H + 60);
    moat(-60, -3, -3, H + 3);
    moat(W + 3, -3, W + 60, H + 3);
    b.color(th.outside).face([[-2000, -0.1, -2000], [-2000, -0.1, H + 2000], [W + 2000, -0.1, H + 2000], [W + 2000, -0.1, -2000]], [0, 1, 0]);
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2;
      const d = 700 + rnd() * 400;
      b.color(k % 2 ? '#5f8f45' : '#6a9a4c').sphere(W / 2 + Math.cos(a) * d, -40, H / 2 + Math.sin(a) * d, 140 + rnd() * 80, 10, 6);
    }
    for (let k = 0; k < 90; k++) {
      const side = Math.floor(rnd() * 4);
      const t = rnd();
      const d = 80 + rnd() * 380;
      const x = side < 2 ? -80 + t * (W + 160) : side === 2 ? -d : W + d;
      const z = side === 0 ? -d : side === 1 ? H + d : -80 + t * (H + 160);
      const hgt = 40 + rnd() * 30;
      b.color('#5a4030').cylinder(x, 0, z, 2.2, hgt * 0.45, 6);
      b.color(['#2f6b32', '#3f7f3a', '#2a5d2c'][k % 3]).cone(x, hgt * 0.3, z, 11 + rnd() * 5, hgt * 0.75, 7);
    }
    const colors = ['#c43a3a', '#2a5fb0'];
    for (const [x, z, c] of [[2, 2, 0], [W - 2, 2, 0], [2, H - 2, 1], [W - 2, H - 2, 1]]) {
      b.color('#5a5a5a').box(x, 32, z, 0.8, 22, 0.8);
      b.color(colors[c]).face([[x, 52, z], [x, 46, z], [x + (x < W / 2 ? -12 : 12), 49, z]], [0, 0, 1]).face([[x, 52, z], [x, 46, z], [x + (x < W / 2 ? -12 : 12), 49, z]], [0, 0, -1]);
    }
  }
}

function towerCrane(b, x, z, hgt) {
  const yellow = '#e8b92e';
  b.color('#8a8a86').box(x, 0, z, 14, 3, 14);
  for (const [dx, dz] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]) b.color(yellow).box(x + dx, 3, z + dz, 1, hgt, 1);
  for (let y = 10; y < hgt; y += 10) b.color(yellow).box(x, y, z, 6, 0.6, 6);
  b.color('#3a3a3e').box(x, hgt + 3, z, 7, 6, 7);
  b.color(yellow).box(x - 60, hgt + 9, z, 170, 3, 3); // jib
  b.color('#7a7a78').box(x + 32, hgt + 4, z, 12, 5, 6); // counterweight
  b.color('#2a2a2e').box(x - 110, hgt - 30, z, 0.3, 39, 0.3);
  b.color('#e0ae24').box(x - 110, hgt - 34, z, 6, 4, 6);
}

// A half-built block: concrete floors on pillars, the top storeys still open.
function block(b, x, z, w, d, hgt, rnd) {
  const floors = Math.max(2, Math.floor(hgt / 13));
  for (let f = 0; f < floors; f++) {
    const y = f * 13;
    b.color('#b3b0a8').box(x, y + 11.5, z, w, 1.5, d);
    const done = f < floors - 1 - Math.floor(rnd() * 2);
    if (done) b.color(f % 2 ? '#d8d2c4' : '#e0dacc').box(x, y, z, w - 1, 11.5, d - 1);
    else {
      b.color('#9e9b93');
      for (const [dx, dz] of [[-w / 2 + 2, -d / 2 + 2], [w / 2 - 2, -d / 2 + 2], [-w / 2 + 2, d / 2 - 2], [w / 2 - 2, d / 2 - 2]]) b.box(x + dx, y, z + dz, 2.5, 11.5, 2.5);
    }
  }
}

function cactus(b, x, z, s, rnd) {
  b.color('#4a7a3a').box(x, 0, z, 3 * s, 17 * s, 3 * s, { bottom: false });
  const side = rnd() < 0.5 ? -1 : 1;
  const ay = (6 + rnd() * 4) * s;
  b.box(x + side * 3 * s, ay, z, 3.4 * s, 2.2 * s, 2.4 * s, { bottom: false });
  b.box(x + side * 4.4 * s, ay, z, 2.4 * s, 7 * s, 2.4 * s, { bottom: false });
}

// Lighten (amount > 0) or darken a hex colour.
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(amount > 0 ? v + (255 - v) * amount : v * (1 + amount))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('')}`;
}
