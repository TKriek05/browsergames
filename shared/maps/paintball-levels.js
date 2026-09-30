// Spetterveld: the big fields with height (see paintball-build.js for the
// building blocks). Every field is point-symmetric around its middle, so
// every spawn sees the same field. Spots (spawns, pads) carry their height z.
import { can, rect, stairs, building, merlons, mirrorPoint, mirrorX, STOREY } from './paintball-build.js';

const crate = (x0, y0, z1, size = 10) => rect(x0, y0, x0 + size, y0 + size, 0, z1, 'crate');

// --- Bouwplaats: a building site around an unfinished building --------------------------------
function bouwplaats() {
  const W = 560;
  const H = 380;
  const centre = building({
    x0: 210, y0: 145, x1: 350, y1: 235, storeys: 1, roof: 'open', parapet: 9,
    kinds: { wall: 'concrete', roof: 'deck', step: 'cstep' },
    openings: [
      { side: 'n', from: 225, to: 245, door: true }, { side: 'n', from: 270, to: 290 },
      { side: 's', from: 315, to: 335, door: true }, { side: 's', from: 270, to: 290 },
      { side: 'w', from: 205, to: 225, door: true }, { side: 'e', from: 155, to: 175, door: true },
      // Gaps in the parapet on the deck: jump down from there.
      { side: 'n', from: 300, to: 318, z0: STOREY, z1: STOREY + 12 },
      { side: 's', from: 242, to: 260, z0: STOREY, z1: STOREY + 12 },
    ],
    stairs: [
      { storey: 0, at: 150, c: 222, dir: '+y' },
      { storey: 0, at: 230, c: 338, dir: '-y' },
    ],
  });
  const half = [
    // Inside: a pillar and a pallet of bricks; up on the deck: bags of cement and pillar stubs.
    rect(242, 187, 247, 193, 0, STOREY - 1.5, 'pillar'),
    rect(262, 168, 278, 178, 0, 8, 'bricks'),
    rect(255, 186, 275, 194, STOREY, STOREY + 5, 'bags'),
    rect(246, 208, 251, 213, STOREY, STOREY + 12, 'pillar'),
    // Climbing crates up to a container (13 high).
    crate(126, 64, 8), rect(140, 63, 180, 77, 0, 13, 'container'),
    // A double-stacked container with a crate staircase (8, 16, then 27).
    rect(56, 300, 96, 314, 0, 27, 'container'), crate(96, 302, 16), crate(106, 302, 8),
    // Crate stack in the open.
    crate(90, 110, 8), crate(100, 110, 16), crate(100, 120, 8),
    // Concrete pipes to stand on, a digger, portable toilets, a sand heap, rebar.
    can(222, 92, 7, 0, 7, 'pipe'), can(238, 98, 7, 0, 7, 'pipe'),
    rect(385, 82, 415, 98, 0, 12, 'digger'), rect(389, 84, 401, 96, 12, 24, 'cab'),
    rect(60, 18, 68, 26, 0, 20, 'dixi'), rect(70, 18, 78, 26, 0, 20, 'dixi'),
    rect(40, 250, 80, 280, 0, 3, 'sand'), rect(45, 254, 75, 276, 0, 6, 'sand'), rect(50, 258, 70, 272, 0, 9, 'sand'),
    rect(262, 102, 300, 107, 0, 2.5, 'rebar'),
    rect(330, 40, 332, 70, 0, 18, 'fence'), rect(450, 150, 452, 176, 0, 18, 'fence'),
  ];
  return {
    key: 'bouw', name: 'Bouwplaats', width: W, height: H,
    spawns: mirrorPoint([{ x: 20, y: 60, z: 0 }, { x: 20, y: 190, z: 0 }, { x: 20, y: 320, z: 0 }], W, H),
    pads: mirrorPoint([{ x: 246, y: 162, z: STOREY }, { x: 100, y: 190, z: 0 }], W, H),
    solids: [...centre, ...mirrorPoint(half, W, H)],
  };
}

// --- Westernstad: a main street between two rows of buildings ----------------------------------
function westernstad() {
  const W = 600;
  const H = 380;
  const saloon = building({
    x0: 50, y0: 40, x1: 190, y1: 130, storeys: 2, kinds: { wall: 'plank', floor: 'boards', roof: 'roof' },
    openings: [
      { side: 's', storey: 0, from: 110, to: 130, door: true }, { side: 's', storey: 0, from: 150, to: 172 },
      { side: 's', storey: 1, from: 65, to: 90 }, { side: 's', storey: 1, from: 150, to: 175 },
      { side: 'n', storey: 0, from: 60, to: 80, door: true }, { side: 'w', storey: 1, from: 70, to: 100 },
      { side: 'e', storey: 0, from: 95, to: 115 },
    ],
    stairs: [{ storey: 0, at: 180, c: 50, dir: '-x' }],
  });
  const bank = building({
    x0: 250, y0: 60, x1: 350, y1: 130, storeys: 1, roof: 'open', parapet: 7, kinds: { wall: 'brick', roof: 'deck' },
    openings: [
      { side: 's', from: 290, to: 310, door: true }, { side: 's', from: 258, to: 278 }, { side: 's', from: 322, to: 342 },
    ],
    stairs: [{ storey: 0, at: 340, c: 70, dir: '-x' }],
  });
  const store = building({
    x0: 410, y0: 40, x1: 550, y1: 130, storeys: 2, kinds: { wall: 'plank2', floor: 'boards', roof: 'roof' },
    openings: [
      { side: 's', storey: 0, from: 470, to: 490, door: true }, { side: 's', storey: 0, from: 505, to: 530 },
      { side: 's', storey: 1, from: 425, to: 450 }, { side: 's', storey: 1, from: 510, to: 535 },
      { side: 'n', storey: 0, from: 520, to: 540, door: true }, { side: 'w', storey: 0, from: 95, to: 115 },
    ],
    stairs: [{ storey: 0, at: 420, c: 50, dir: '+x' }],
  });
  const half = [
    ...saloon, ...bank, ...store,
    rect(70, 95, 120, 101, 0, 9, 'counter'),
    rect(200, 140, 222, 146, 0, 5, 'trough'),
    can(235, 146, 4, 0, 9, 'barrel'), can(243, 141, 4, 0, 9, 'barrel'), can(392, 142, 4, 0, 9, 'barrel'),
    rect(120, 160, 156, 172, 0, 12, 'wagon'),
    rect(376, 150, 390, 158, 0, 8, 'hay'), rect(390, 150, 404, 158, 0, 8, 'hay'), rect(383, 150, 397, 158, 8, 16, 'hay'),
    crate(205, 90, 8), crate(215, 90, 16), crate(215, 100, 8),
    crate(368, 40, 8), crate(378, 40, 8),
    rect(20, 138, 40, 141, 0, 10, 'rail'), rect(560, 138, 580, 141, 0, 10, 'rail'),
  ];
  const middle = [
    can(300, 190, 8, 0, 8, 'well'),
    can(293, 190, 0.8, 8, 20, 'post'), can(307, 190, 0.8, 8, 20, 'post'),
    rect(290, 183, 310, 197, 20, 22, 'wellroof'),
  ];
  return {
    key: 'western', name: 'Westernstad', width: W, height: H,
    spawns: mirrorPoint([{ x: 20, y: 20, z: 0 }, { x: 20, y: 165, z: 0 }, { x: 20, y: 360, z: 0 }], W, H),
    pads: mirrorPoint([{ x: 150, y: 190, z: 0 }, { x: 100, y: 108, z: STOREY }], W, H),
    solids: [...mirrorPoint(half, W, H), ...middle],
  };
}

// --- Kasteelruïne: ramparts, four towers you can climb, a ruined keep -------------------------
function kasteel() {
  const W = 520;
  const H = 420;
  const R = STOREY; // rampart walkway height = the tower roofs
  const tower = building({
    x0: 2, y0: 2, x1: 52, y1: 52, storeys: 1, roof: 'open', parapet: 6, kinds: { wall: 'stone', roof: 'flags', step: 'sstep' },
    openings: [
      { side: 's', from: 30, to: 46, door: true },
      { side: 'e', from: 3, to: 15, z0: R, z1: R + 12 }, // onto the rampart
    ],
    stairs: [{ storey: 0, at: 5, c: 10, dir: '+y', depth: 5.5 }],
  });
  const quarter = [
    ...tower,
    rect(52, 0, W / 2, 14, 0, R, 'rampart'),
    ...merlons(true, 1.5, 54, W / 2, R),
    ...stairs({ at: 170, c: 20, dir: '-x', n: 8, rise: R / 8, width: 12, kind: 'sstep' }),
    can(160, 110, 4, 0, 20, 'column'), can(118, 150, 4, 0, 8, 'column'),
    crate(96, 70, 8), crate(106, 70, 16), crate(106, 80, 8),
    rect(60, 130, 64, 170, 0, 12, 'ruin'),
  ];
  const keepHalf = [
    // North wall of the keep: high, a breach, then low (you can look and shoot over it).
    rect(200, 158.5, 235, 161.5, 0, 30, 'keep'), rect(255, 158.5, 320, 161.5, 0, 14, 'keep'),
    // West wall with a doorway.
    rect(198.5, 158.5, 201.5, 195, 0, 30, 'keep'), rect(198.5, 195, 201.5, 215, 20, 30, 'keep'), rect(198.5, 215, 201.5, 261.5, 0, 30, 'keep'),
    // Rubble to climb onto the low wall.
    rect(265, 146, 295, 158, 0, 4, 'rubble'), rect(270, 150, 290, 158, 0, 8, 'rubble'),
    rect(150, 250, 166, 262, 0, 6, 'rubble'), can(140, 300, 6, 0, 7, 'well'),
    rect(90, 330, 110, 340, 0, 12, 'cart'),
  ];
  const middle = [rect(245, 195, 275, 225, 0, 3, 'dais'), rect(250, 200, 270, 220, 0, 6, 'dais'), rect(257, 207, 263, 213, 6, 18, 'statue')];
  return {
    key: 'kasteel', name: 'Kasteelruïne', width: W, height: H,
    spawns: mirrorPoint([{ x: 24, y: 110, z: 0 }, { x: 24, y: 210, z: 0 }, { x: 24, y: 300, z: 0 }], W, H),
    pads: mirrorPoint([{ x: 260, y: 8.5, z: R }, { x: 130, y: 210, z: 0 }], W, H),
    solids: [...mirrorPoint(mirrorX(quarter, W), W, H), ...mirrorPoint(keepHalf, W, H), ...middle],
  };
}

export const PB_LEVELS = { bouw: bouwplaats(), western: westernstad(), kasteel: kasteel() };
