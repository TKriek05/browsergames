// Turbo Kart GP: the classic circuits (the tracks from phase 4 and the three
// hilly ones). Pure data; built into tracks by kart-tracks.js.
//   points: control points [x, y] or [x, y, road width] (world units, y grows south)
//   heights: [lap fraction, height] points (smoothstep in between)
//   items: rows of item boxes (lap fraction), pads: boost pads [fraction, lateral -1..1]
//   theme: colours and scenery of the 3D world

// Control points in world units (≈ 1 kart = 12 units). y grows "south".
export const CLASSIC_TRACKS = {
  ring: {
    name: 'Groene Vallei',
    width: 84,
    points: [[400, 0], [800, 0], [1100, 60], [1250, 250], [1200, 480], [1000, 560], [800, 500], [650, 560],
      [550, 750], [350, 850], [100, 820], [-100, 700], [-180, 450], [-150, 180], [0, 0]],
    items: [0.2, 0.47, 0.74], // item box rows (fraction of the lap)
    pads: [[0.09, 0], [0.58, -0.3], [0.86, 0.3]], // boost pads: fraction, lateral (-1..1 of half width)
    // Sunny summer day: green hills, pine trees, red/white barriers.
    theme: {
      sky: ['#3d8ee0', '#cfe8fb'], fog: '#d5e8f5', sun: ['#fffbe6', '#fff1b0'], sunDir: [0.5, 0.35, -1],
      light: { color: '#eee4cc', ambient: '#6f7a8c' }, clouds: 13,
      ground: ['#55a044', '#4e973e'], edge: '#c9b98a', road: ['#5b5c64', '#606169'], kerb: ['#e63946', '#f4f4f4'],
      wall: ['#f4f4f4', '#e63946'], trees: 'pine', leaves: ['#2f7a3b', '#3c8a45', '#28693a'],
      high: '#4a7f3a', shore: '#c9b98a', water: '#3a7fc0', mountain: ['#6f7a86', '#f4f7fa'], hilly: 110,
      buildings: 'farm', banners: ['#e63946', '#2a6fdb', '#ffb020', '#3c8a45'],
    },
  },
  park: {
    name: 'Herfstbos',
    width: 78,
    points: [[175, 0], [350, 0], [600, -80], [750, -250], [980, -300], [1150, -180], [1150, 50], [950, 180], [910, 360],
      [1040, 480], [1080, 610], [950, 730], [620, 720], [480, 600], [330, 570], [200, 620], [60, 720], [-150, 620], [-200, 380], [-100, 150], [0, 0]],
    items: [0.17, 0.44, 0.7],
    pads: [[0.06, 0], [0.33, 0.35], [0.62, -0.35], [0.9, 0]],
    // Autumn afternoon in the woods: low warm sun, orange trees, wooden fences.
    theme: {
      sky: ['#5a8fd0', '#f4dcb4'], fog: '#e8d8bc', sun: ['#fff0c8', '#ffcf80'], sunDir: [-0.6, 0.22, -1],
      light: { color: '#f0d8b4', ambient: '#76706a' }, clouds: 8,
      ground: ['#7d9a3e', '#76913a'], edge: '#a88a58', road: ['#57565a', '#5c5b5f'], kerb: ['#d9822b', '#f4efe4'],
      wall: ['#9a6a3c', '#86592f'], trees: 'round', leaves: ['#d9822b', '#c4452c', '#e8b23a', '#8a9a2e'],
      high: '#6f6a30', shore: '#a88a58', water: '#4a7a9a', mountain: ['#7a6a5c', '#f0f0ee'], hilly: 140,
      buildings: 'forest', banners: ['#d9822b', '#6b4a2e', '#f4efe4', '#3c6a3a'],
    },
  },
  boulevard: {
    name: 'Strandboulevard',
    width: 90,
    points: [[600, 0], [1200, 0], [1600, 100], [1800, 400], [1650, 700], [1300, 800], [900, 700], [600, 850],
      [250, 850], [-50, 700], [-200, 400], [-150, 120], [0, 0]],
    items: [0.14, 0.42, 0.69],
    pads: [[0.05, 0.35], [0.05, -0.35], [0.3, 0], [0.8, 0]],
    // Seaside at golden hour: sand, palm trees, blue/white barriers, the sea.
    theme: {
      sky: ['#4a78c0', '#ffc98a'], fog: '#f2d2a8', sun: ['#fff4d0', '#ffb060'], sunDir: [0.2, 0.12, 1],
      light: { color: '#f2d6b0', ambient: '#7a7080' }, clouds: 9,
      ground: ['#dcc890', '#93b05a'], edge: '#d4b878', road: ['#5a5a62', '#5f5f67'], kerb: ['#2a6fdb', '#f4f4f4'],
      wall: ['#f4f4f4', '#2a6fdb'], trees: 'palm', leaves: ['#3f8f3a', '#4fa046', '#35803a'],
      high: '#7f9a4a', shore: '#eed9a4', water: '#2f86c8', mountain: ['#9a8a6a', null], hilly: 70,
      buildings: 'beach', banners: ['#2a6fdb', '#f4f4f4', '#ffb020', '#e63946'], sea: true,
    },
  },
};

// --- Tracks with hills ------------------------------------------------------------------
// heights: [lap fraction, height] points; the road eases (smoothstep) from one to the next.
Object.assign(CLASSIC_TRACKS, {
  alpine: {
    name: 'Alpenpas',
    width: 80,
    points: [[300, 0], [700, 0], [1000, -80], [1150, -300], [1080, -540], [820, -610], [640, -540], [460, -610],
      [230, -650], [0, -540], [-150, -300], [-120, -80], [0, 0]],
    heights: [[0, 0], [0.06, 0], [0.2, 20], [0.33, 52], [0.45, 70], [0.55, 60], [0.66, 38], [0.8, 16], [0.93, 0], [1, 0]],
    items: [0.18, 0.46, 0.73],
    pads: [[0.08, 0], [0.5, 0.3], [0.86, -0.3]],
    // Crisp mountain morning: green alpine meadows, pines, grey rock, snowy peaks close by.
    theme: {
      sky: ['#2f7fd8', '#d8ecfa'], fog: '#dbe8f2', sun: ['#ffffff', '#fff4c8'], sunDir: [0.4, 0.45, -1],
      light: { color: '#f2f0e8', ambient: '#6a7890' }, clouds: 10,
      ground: ['#5fa84a', '#57a044'], edge: '#b9b2a2', road: ['#55565e', '#5a5b63'], kerb: ['#e63946', '#f4f4f4'],
      wall: ['#c8c8cc', '#8a8a92'], trees: 'pine', leaves: ['#2a6a36', '#347a3e', '#24603a'],
      high: '#8a8a88', shore: '#b9b2a2', water: '#3f86c6', mountain: ['#7a8490', '#f7f9fb'], hilly: 170,
      buildings: 'forest', banners: ['#e63946', '#f4f4f4', '#2a6fdb', '#3c8a45'],
    },
  },
  canyon: {
    name: 'Rode Canyon',
    width: 84,
    points: [[400, 0], [900, 0], [1300, 120], [1450, 380], [1300, 620], [1000, 650], [850, 480], [650, 450],
      [500, 650], [250, 700], [0, 560], [-120, 300], [0, 0]],
    heights: [[0, 0], [0.07, 0], [0.17, 26], [0.27, 6], [0.38, 38], [0.5, 12], [0.6, 34], [0.72, 8], [0.82, 22], [0.93, 0], [1, 0]],
    items: [0.15, 0.43, 0.7],
    pads: [[0.1, 0], [0.34, -0.3], [0.64, 0.3], [0.88, 0]],
    // Hot desert afternoon: red rock, sand, cacti, a pale dusty sky.
    theme: {
      sky: ['#4f8fd0', '#f6dcb4'], fog: '#efd6b4', sun: ['#fffae0', '#ffd890'], sunDir: [-0.5, 0.5, -1],
      light: { color: '#fbe8cc', ambient: '#7a6a62' }, clouds: 4,
      ground: ['#d9a86a', '#cf9c5e'], edge: '#b8744a', road: ['#5e5a58', '#63605d'], kerb: ['#f4f4f4', '#c4452c'],
      wall: ['#e8d8bc', '#b85a38'], trees: 'cactus', leaves: ['#4f8a3a', '#5a9a44', '#447a34'],
      high: '#b85a38', shore: '#d9b27a', water: '#3a8fb8', mountain: ['#b0583a', null], hilly: 150,
      buildings: 'desert', banners: ['#c4452c', '#ffb020', '#2a6fdb', '#f4f4f4'],
    },
  },
  volcano: {
    name: 'Vulkaaneiland',
    width: 86,
    points: [[500, 0], [1000, -40], [1350, 100], [1500, 400], [1400, 700], [1100, 850], [800, 760], [600, 900],
      [300, 900], [50, 760], [-100, 480], [-80, 200], [100, 40], [300, 0]],
    heights: [[0, 0], [0.07, 0], [0.25, 28], [0.4, 56], [0.5, 64], [0.62, 42], [0.78, 16], [0.9, 0], [1, 0]],
    items: [0.16, 0.45, 0.72],
    pads: [[0.06, 0.3], [0.06, -0.3], [0.55, 0], [0.84, 0]],
    // A tropical island: palm trees, black lava rock, a smoking volcano in the middle, the sea around.
    theme: {
      sky: ['#3a86d6', '#c8ecf4'], fog: '#d4ecee', sun: ['#fffbe0', '#ffe8a0'], sunDir: [0.3, 0.55, 1],
      light: { color: '#f4efdc', ambient: '#687a82' }, clouds: 12,
      ground: ['#4f9a3e', '#46903a'], edge: '#3a3434', road: ['#4e4d52', '#535257'], kerb: ['#ffb020', '#2a2a30'],
      wall: ['#f4f4f4', '#2a9d8f'], trees: 'palm', leaves: ['#2f8a3a', '#3fa046', '#2a7a34'],
      high: '#3a3434', shore: '#eed9a4', water: '#1f8fc8', mountain: ['#4a4040', null], hilly: 90,
      buildings: 'beach', banners: ['#2a9d8f', '#ffb020', '#e63946', '#f4f4f4'], sea: true, volcano: true,
    },
  },
});
