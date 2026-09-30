// Turbo Kart GP: the big circuits (inspired by modern kart racers, all our
// own): a harbour town with a figure eight over a bridge, jungle ruins with a
// waterfall jump and a rope bridge, a snowy mountain that climbs over itself,
// and a road through the clouds with gaps to jump. Pure data; built into
// tracks by kart-tracks.js (see there for the fields).
//   walls: step profile [fraction, left, right] of the barrier distance beyond
//          the road edge; -1 = no barrier (drive off and you fall)
//   ramps: [fraction, launch speed] jumps; gaps: [from, to] no road (jump it!)

const W = 26; // the default barrier distance
const OPEN = -1;

export const BIG_TRACKS = {
  harbour: {
    name: 'Havenstad',
    big: true,
    width: 96,
    points: [[0, 0, 110], [700, 0, 110], [1100, 90, 100], [1360, 330, 96], [1220, 620, 90], [1000, 860, 96], [880, 1150, 100],
      [1060, 1430, 100], [1420, 1470, 100], [1700, 1250, 96], [1720, 900, 92], [1500, 700, 90], [1200, 590, 88],
      [880, 480, 96], [560, 470, 104], [260, 560, 104], [-60, 520, 100], [-300, 330, 100], [-260, 90, 104]],
    heights: [[0, 0], [0.07, 0], [0.12, 8], [0.2, 50], [0.26, 50], [0.34, 6], [0.42, 0], [0.62, 0], [0.7, 0], [1, 0]],
    walls: [[0, W, W], [0.14, 14, 14], [0.3, W, W], [0.46, W, W]],
    ramps: [[0.765, 145]],
    gaps: [[0.771, 0.778]],
    items: [0.1, 0.38, 0.6, 0.86],
    pads: [[0.04, 0], [0.33, 0.4], [0.33, -0.4], [0.755, 0], [0.93, 0.3]],
    theme: {
      sky: ['#3f86d8', '#d7ecf9'], fog: '#d8e6ef', sun: ['#fffbe6', '#fff1b8'], sunDir: [0.45, 0.4, -1],
      light: { color: '#f2ecdc', ambient: '#6f7a8c' }, clouds: 12,
      ground: ['#7fb05a', '#77a653'], edge: '#c8c0a8', road: ['#54555c', '#595a61'], kerb: ['#e63946', '#f4f4f4'],
      wall: ['#f4f4f4', '#2a6fdb'], trees: 'round', leaves: ['#3f8a3a', '#4a9a44', '#357a34'],
      high: '#8a8f94', shore: '#c8b89a', water: '#2f7fb8', mountain: ['#7a8490', '#f4f7fa'], hilly: 60,
      buildings: 'city', banners: ['#e63946', '#2a6fdb', '#ffb020', '#f4f4f4'], sea: true, pavement: '#b8b4ac',
    },
  },
  jungle: {
    name: 'Jungletempel',
    big: true,
    width: 90,
    points: [[0, 0, 104], [760, 0, 104], [1250, -120, 96], [1600, -440, 92], [1650, -860, 90], [1420, -1200, 90],
      [1060, -1330, 96], [720, -1170, 80], [420, -1330, 76], [110, -1170, 80], [-200, -1340, 84], [-520, -1200, 90],
      [-680, -880, 96], [-560, -560, 100], [-420, -300, 104], [-300, -90, 104]],
    heights: [[0, 0], [0.06, 0], [0.18, 30], [0.3, 72], [0.4, 96], [0.447, 96], [0.472, 40], [0.52, 38], [0.62, 44],
      [0.74, 52], [0.86, 14], [0.94, 0], [1, 0]],
    walls: [[0, W, W], [0.36, W, W], [0.5, OPEN, OPEN], [0.6, W, W], [0.8, W, W]],
    ramps: [[0.444, 150]],
    items: [0.14, 0.34, 0.56, 0.8],
    pads: [[0.05, 0], [0.43, 0.3], [0.43, -0.3], [0.7, 0], [0.9, 0]],
    theme: {
      sky: ['#4f97d6', '#e2f0dc'], fog: '#cfe2cf', sun: ['#fffbe0', '#ffe8a8'], sunDir: [-0.4, 0.55, -1],
      light: { color: '#f2f0d8', ambient: '#62725e' }, clouds: 8,
      ground: ['#4f8f36', '#478630'], edge: '#8a6a44', road: ['#6a5a48', '#6f5f4c'], kerb: ['#c9a25a', '#6a4a2e'],
      wall: ['#a89a78', '#7a6e58'], trees: 'jungle', leaves: ['#2a7a34', '#3a8f3a', '#246a2e', '#4f9a3a'],
      high: '#5a6a4a', shore: '#a88a58', water: '#3a9ab0', mountain: ['#5a7a4a', null], hilly: 180,
      buildings: 'temple', banners: ['#c9a25a', '#3a8f3a', '#c4452c', '#f4efe4'], bridgeDeck: 'wood',
    },
  },
  summit: {
    name: 'Sneeuwtop',
    big: true,
    width: 92,
    points: [[0, 0, 104], [700, 0, 104], [1090, -110, 96], [1310, -420, 92], [1260, -800, 90], [1000, -1100, 92],
      [600, -1210, 92], [240, -1060, 94], [170, -720, 96], [480, -480, 96], [880, -430, 100], [1300, -420, 100],
      [1720, -400, 100], [1940, -120, 96], [1850, 260, 96], [1450, 470, 100], [960, 420, 104], [480, 330, 104],
      [80, 330, 104], [-200, 350, 104], [-420, 260, 104], [-460, 90, 104], [-300, 0, 104]],
    heights: [[0, 0], [0.05, 0], [0.13, 14], [0.22, 40], [0.3, 70], [0.38, 94], [0.44, 104], [0.5, 106], [0.55, 104],
      [0.585, 104], [0.61, 70], [0.68, 58], [0.78, 30], [0.88, 8], [0.95, 0], [1, 0]],
    walls: [[0, W, W], [0.5, W, W], [0.57, 14, 14], [0.6, W, W]],
    ramps: [[0.588, 110]],
    items: [0.12, 0.33, 0.52, 0.76],
    pads: [[0.04, 0], [0.4, 0], [0.58, 0.3], [0.58, -0.3], [0.84, 0]],
    theme: {
      sky: ['#3a7fd0', '#e4f0fa'], fog: '#e8eef4', sun: ['#ffffff', '#fff6d8'], sunDir: [0.3, 0.5, -1],
      light: { color: '#f4f6fa', ambient: '#7a86a0' }, clouds: 10,
      ground: ['#f2f5f8', '#e8edf2'], edge: '#c8d0da', road: ['#5a5c66', '#5f616b'], kerb: ['#e63946', '#f4f4f4'],
      wall: ['#e63946', '#f4f4f4'], trees: 'snowpine', leaves: ['#2a5a3a', '#346a42', '#244e34'],
      high: '#dde4ec', shore: '#c8d0da', water: '#6a9ac0', mountain: ['#8a94a4', '#ffffff'], hilly: 230,
      buildings: 'ski', banners: ['#e63946', '#2a6fdb', '#f4f4f4', '#ffb020'], snow: true,
    },
  },
  clouds: {
    name: 'Wolkenpaleis',
    big: true,
    width: 92,
    points: [[0, 0, 108], [780, 0, 108], [1250, 120, 96], [1500, 460, 90], [1400, 860, 86], [1050, 1060, 82],
      [620, 1000, 90], [320, 1180, 96], [-80, 1260, 96], [-480, 1080, 90], [-640, 700, 86], [-560, 330, 92],
      [-320, 80, 104]],
    heights: [[0, 0], [0.06, 0], [0.14, 16], [0.24, 50], [0.3, 62], [0.4, 62], [0.43, 28], [0.52, 24], [0.62, 46],
      [0.7, 56], [0.8, 30], [0.9, 8], [0.95, 0], [1, 0]],
    walls: [[0, W, W], [0.1, 8, 8], [0.2, OPEN, OPEN], [0.3, 8, 8], [0.36, OPEN, 8], [0.46, OPEN, OPEN], [0.58, 8, OPEN],
      [0.68, OPEN, OPEN], [0.78, 8, 8], [0.92, W, W]],
    ramps: [[0.405, 135], [0.735, 140]],
    gaps: [[0.412, 0.422], [0.741, 0.749]],
    items: [0.12, 0.34, 0.56, 0.82],
    pads: [[0.05, 0], [0.395, 0], [0.73, 0], [0.9, 0.3], [0.9, -0.3]],
    theme: {
      sky: ['#7fb4ef', '#fbe6f0'], fog: '#f4e8f2', sun: ['#ffffff', '#fff2d0'], sunDir: [0.3, 0.3, 1],
      light: { color: '#fff4f0', ambient: '#9a94b4' }, clouds: 16,
      ground: ['#ffffff', '#f4f0f8'], edge: '#e8dff0', road: ['#8a86a8', '#908cae'], kerb: ['#ffd23e', '#ffffff'],
      wall: ['#ffffff', '#f7b8d0'], trees: 'none', leaves: ['#ffffff'],
      high: '#ffffff', shore: '#ffffff', water: '#cfe0f8', mountain: ['#ffffff', null], hilly: 0,
      buildings: 'castle', banners: ['#f7b8d0', '#b8d8ff', '#ffe08a', '#c8f0c8'], floating: true,
    },
  },
};
