// Spetterveld: the obstacles and surroundings of the Containerhaven (a grey
// harbour yard in the late afternoon sun) and the Avondveld (speedball under
// floodlights). The grey and dark worlds let the players' paint stand out.
const W = 420; // the classic field size
const H = 280;

// Returns true when it drew the obstacle.
export function extraObstacle(b, o, i, th, rnd) {
  const h = o.hgt;
  switch (o.kind) {
    case 'container': {
      // Two containers stacked, each in its own colour, with ribs and doors.
      const alongX = o.w >= o.h;
      const half = h / 2;
      for (let k = 0; k < 2; k++) {
        const c = th.containers[(i + k * 3) % th.containers.length];
        const y0 = k * half;
        b.color(c).box(o.x, y0, o.y, o.w, half - 0.3, o.h, { top: shade(c, 0.1) });
        b.color(shade(c, -0.18));
        const len = alongX ? o.w : o.h;
        for (let t = -len / 2 + 2; t < len / 2 - 1; t += 2.6) {
          if (alongX) b.box(o.x + t, y0 + 0.4, o.y, 0.5, half - 1.1, o.h + 0.35);
          else b.box(o.x, y0 + 0.4, o.y + t, o.w + 0.35, half - 1.1, 0.5);
        }
        // Door bars on one end.
        b.color('#d8d4c8');
        for (const d of [-0.25, 0.25]) {
          if (alongX) b.box(o.x - o.w / 2 - 0.2, y0 + 0.8, o.y + d * o.h, 0.3, half - 1.8, 0.4);
          else b.box(o.x + d * o.w, y0 + 0.8, o.y - o.h / 2 - 0.2, 0.4, half - 1.8, 0.3);
        }
      }
      break;
    }
    case 'tires': {
      const n = Math.ceil(h / 3.4);
      for (let k = 0; k < n; k++) {
        const dx = (k % 2 ? 0.4 : -0.4) * (rnd() - 0.5);
        b.color(th.tires).cylinder(o.x + dx, k * 3.4, o.y, o.r, 3.1, 12, { top: '#3a3a3e' });
        b.color('#111114').cylinder(o.x + dx, k * 3.4 + 3.1, o.y, o.r * 0.55, 0.05, 10);
      }
      break;
    }
    case 'reel': {
      // Cable drum standing on its side-disc.
      b.color(th.reel[0]).cylinder(o.x, 0, o.y, o.r, 1.4, 14, { top: th.reel[1] });
      b.color('#2d2f33').cylinder(o.x, 1.4, o.y, o.r * 0.72, h - 2.8, 14);
      b.color('#3a3d42');
      for (let y = 2.4; y < h - 2; y += 2.2) b.cylinder(o.x, y, o.y, o.r * 0.74, 0.5, 14);
      b.color(th.reel[0]).cylinder(o.x, h - 1.4, o.y, o.r, 1.4, 14, { top: th.reel[1] });
      break;
    }
    case 'pallets': {
      const layers = Math.ceil(h / 3);
      for (let k = 0; k < layers; k++) {
        const y = k * 3;
        b.color(th.pallet[k % 2]).box(o.x, y + 2, o.y, o.w, 1, o.h);
        b.color('#6a5236').box(o.x, y, o.y, o.w - 1.5, 2, o.h - 1.5);
      }
      break;
    }
    case 'dome': {
      const c = th.dome ?? '#f2f2ee';
      b.color(c).cylinder(o.x, 0, o.y, o.r, h * 0.45, 16);
      b.color(c).sphere(o.x, h * 0.45, o.y, o.r, 16, 8);
      b.color(th.bunkers?.[1] ?? '#1d6fd8').cylinder(o.x, h * 0.2, o.y, o.r + 0.2, 1.6, 16);
      b.color(th.bunkers?.[0] ?? '#e63946').cylinder(o.x, h * 0.36, o.y, o.r + 0.2, 1.2, 16);
      break;
    }
    default:
      return false;
  }
  return true;
}

// --- Surroundings ------------------------------------------------------------------------------
export function havenSurroundings(b, th, rnd) {
  // Walls of stacked containers along three sides.
  const stack = (x, z, alongX) => {
    const levels = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < levels; k++) {
      const c = th.containers[Math.floor(rnd() * th.containers.length)];
      if (alongX) b.color(c).box(x, k * 13, z, 60, 12.6, 24, { top: shade(c, 0.1) });
      else b.color(c).box(x, k * 13, z, 24, 12.6, 60, { top: shade(c, 0.1) });
    }
  };
  for (let x = -30; x <= W + 30; x += 62) stack(x, -48, true);
  for (let z = 20; z <= H; z += 62) {
    stack(-50, z, false);
    stack(W + 50, z, false);
  }
  // The quay and the water behind the field.
  b.color('#6f6d68').face([[-400, 0.02, H + 20], [-400, 0.02, H + 70], [W + 400, 0.02, H + 70], [W + 400, 0.02, H + 20]], [0, 1, 0]);
  b.color('#e8c547');
  for (let x = -380; x < W + 380; x += 22) b.face([[x, 0.04, H + 64], [x, 0.04, H + 66], [x + 12, 0.04, H + 66], [x + 12, 0.04, H + 64]], [0, 1, 0]);
  b.color('#2d5f7a').face([[-900, -2, H + 70], [-900, -2, H + 900], [W + 900, -2, H + 900], [W + 900, -2, H + 70]], [0, 1, 0]);
  b.color('#5a5853').box(W / 2, -2, H + 70, W + 800, 2, 1.5);
  b.color('#2a2a2a');
  for (let x = -300; x < W + 300; x += 70) b.cylinder(x, 0, H + 62, 1.3, 2.4, 8, { top: '#3a3a3a' });
  // A ship at the quay and two cranes.
  b.color('#b33a2c').box(W / 2 + 60, -2, H + 150, 380, 12, 60);
  b.color('#e8e4da').box(W / 2 + 200, 10, H + 150, 60, 22, 44);
  for (let k = 0; k < 4; k++) b.color(th.containers[k % th.containers.length]).box(W / 2 - 60 + k * 64, 10, H + 150, 58, 12, 50);
  for (const cx of [W / 2 - 110, W / 2 + 110]) crane(b, cx, H + 90);
  // Light masts.
  for (const [x, z] of [[-20, -20], [W + 20, -20], [-20, H + 20], [W + 20, H + 20]]) {
    b.color('#8a8a86').cylinder(x, 0, z, 0.9, 58, 6);
    b.color('#5a5a58').box(x, 58, z, 7, 2, 7);
  }
}

function crane(b, x, z) {
  const yellow = '#e0a82e';
  for (const dx of [-14, 14]) for (const dz of [-10, 10]) b.color(yellow).box(x + dx, 0, z + dz, 2.4, 70, 2.4);
  b.color(yellow).box(x, 66, z, 32, 4, 24);
  b.color(yellow).box(x, 72, z + 30, 6, 4, 150);
  b.color('#3a3a3a').box(x, 76, z - 10, 10, 8, 10);
}

export function avondSurroundings(b, th, rnd) {
  // Floodlight towers in the corners; lamps glow.
  for (const [x, z] of [[-26, -26], [W + 26, -26], [-26, H + 26], [W + 26, H + 26], [W / 2, -40], [W / 2, H + 40]]) {
    b.color('#5a5f6a').cylinder(x, 0, z, 1.2, 70, 6);
    b.color('#3a3d45').box(x, 70, z, 14, 7, 3);
    b.color('#fffbe0', { emissive: 1 });
    for (const dx of [-4.5, 0, 4.5]) for (const dy of [71.2, 74.4]) b.box(x + dx, dy, z + (z < H / 2 ? 1.6 : -1.6), 3.4, 2.4, 0.3);
  }
  // Bleachers and team tents, dark trees further out.
  for (let x = 40; x < W - 20; x += 50) {
    for (let row = 0; row < 3; row++) b.color(row % 2 ? '#4a4f5a' : '#3d414b').box(x, row * 4, -28 - row * 6, 44, 4, 6);
  }
  for (const [x, c] of [[-50, th.bunkers[0]], [W + 50, th.bunkers[1]]]) {
    for (const y of [70, 140, 210]) {
      b.color('#c8ccd6').box(x, 0, y, 24, 11, 24);
      b.color(c).cone(x, 11, y, 18, 9, 4);
    }
  }
  const leaves = ['#1d3a26', '#23452c', '#183220'];
  for (let i = 0; i < 60; i++) {
    const side = Math.floor(rnd() * 4);
    const t = rnd();
    const d = 100 + rnd() * 250;
    const x = side < 2 ? -60 + t * (W + 120) : side === 2 ? -d : W + d;
    const z = side === 0 ? -d : side === 1 ? H + d : -60 + t * (H + 120);
    const hgt = 40 + rnd() * 30;
    b.color('#2a2018').cylinder(x, 0, z, 2.5, hgt * 0.5, 6);
    b.color(leaves[i % 3]).cone(x, hgt * 0.35, z, 12 + rnd() * 6, hgt * 0.7, 7);
  }
}

// Lighten (amount > 0) or darken a hex colour.
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(amount > 0 ? v + (255 - v) * amount : v * (1 + amount))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('')}`;
}
