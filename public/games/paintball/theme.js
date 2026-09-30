// Spetterveld: the look of each field (sky, ground, bunker colours, scenery).
export const PB_THEMES = {
  opblaas: {
    sky: ['#5aa7e8', '#cfe8f7'], fog: '#d6e9f2', light: { color: '#fff4dc', ambient: '#8a97a8' },
    clouds: { count: 12, color: '#ffffff', shade: '#dbe6f2', seed: 11 },
    outside: '#5a8f45', field: ['#4f9440', '#478a39'], lines: '#f4f4f4', net: '#1f2a24',
    bunkers: ['#e63946', '#1d6fd8', '#ffc21a'], cans: ['#ff8a1e', '#1d6fd8', '#e63946'], trim: '#ffffff',
  },
  bos: {
    sky: ['#79aee0', '#dbe8ea'], fog: '#b9cfc2', light: { color: '#fff0d0', ambient: '#7d8f82' },
    clouds: { count: 9, color: '#f7f7f2', shade: '#d3dcd8', seed: 5 },
    outside: '#476e33', field: ['#6a7440', '#616a37'], lines: null, net: '#2b2418',
    bark: '#6b4a2b', leaves: ['#2f6b32', '#3f7f3a', '#2a5d2c'], wood: ['#b88a55', '#a57a48'], roof: '#5a3b22',
  },
  erf: {
    sky: ['#6fa9dc', '#f3e7cf'], fog: '#e8dcc2', light: { color: '#fff1d2', ambient: '#968c7c' },
    clouds: { count: 10, color: '#ffffff', shade: '#e6dccb', seed: 23 },
    outside: '#6f9640', field: ['#9c8462', '#937b59'], lines: null, net: '#3a2d1e',
    hay: ['#e2b94e', '#d4a83f'], barn: '#b3362c', wood: ['#a8784a', '#946a40'], metal: ['#8fa3ad', '#6f8590'],
  },
  // Late afternoon: a low sun, long shadows, grey concrete.
  haven: {
    sky: ['#5b7fb8', '#ffcf94'], fog: '#e9c79e', fogNear: 240, fogFar: 850,
    light: { dir: [-0.8, -0.42, -0.25], color: '#ffdcaa', ambient: '#8f93a4' },
    sun: { dir: [0.8, 0.3, 0.25], radius: 0.07, top: '#fff2c8', bottom: '#ffb070' },
    clouds: { count: 8, color: '#fff0dc', shade: '#e8b894', seed: 41 },
    outside: '#7d7b76', field: ['#a3a19b', '#9a9892'], lines: '#e8c547', net: '#2a2a2a',
    containers: ['#b5462f', '#2f6a8f', '#3d7a4a', '#c98a2e', '#6a4a8a'], tires: '#232326',
    reel: ['#a8784a', '#8a5f38'], pallet: ['#c49a62', '#a88050'],
  },
  // Evening under floodlights: a dark sky with the moon, paint that shines.
  avond: {
    night: true,
    sky: ['#070c24', '#26305c'], fog: '#161d3a', fogNear: 220, fogFar: 760,
    light: { dir: [-0.3, -0.8, -0.45], color: '#e6ebff', ambient: '#5a6690' },
    sun: { dir: [-0.4, 0.5, -0.65], radius: 0.035, top: '#f4f6ff', bottom: '#dfe4ff' },
    clouds: { count: 6, color: '#2f3a64', shade: '#222a4c', seed: 9 },
    outside: '#1c2f22', field: ['#2f6a3a', '#2a6034'], lines: '#f4f4f4', net: '#0e1210',
    bunkers: ['#e63946', '#1d6fd8', '#ffc21a'], cans: ['#ff8a1e', '#1d6fd8', '#e63946'], trim: '#ffffff', dome: '#f2f2ee',
  },
};

// The big fields with height.
Object.assign(PB_THEMES, {
  // A building site on a bright day: sand, concrete, yellow machines.
  bouw: {
    sky: ['#4f96e0', '#d8ecf8'], fog: '#dbe7ee', light: { color: '#fff6e4', ambient: '#8e96a4' },
    clouds: { count: 12, color: '#ffffff', shade: '#dde6ee', seed: 31 },
    outside: '#b8a47a', field: ['#c9b48a', '#c2ad83'], lines: null, net: '#2a2a28',
    wood: ['#c49a62', '#a88050'], containers: ['#2f6a8f', '#b5462f', '#3d7a4a', '#c98a2e'],
  },
  // Wild-west town in the hot afternoon.
  western: {
    sky: ['#3f8ad8', '#f6e2c0'], fog: '#efd9b4', light: { dir: [-0.6, -0.8, -0.2], color: '#fff0d0', ambient: '#9a8a78' },
    sun: { dir: [0.6, 0.5, 0.2], radius: 0.06, top: '#fff6d8', bottom: '#ffd89a' },
    clouds: { count: 5, color: '#fff8ec', shade: '#ecd8bc', seed: 17 },
    outside: '#d9b27a', field: ['#d4ab74', '#cda46e'], lines: null, net: '#3a2a1e',
    wood: ['#b88a55', '#a57a48'], hay: ['#e2b94e', '#d4a83f'],
  },
  // A castle ruin on a green hill under a cloudy sky.
  kasteel: {
    sky: ['#6a9ad0', '#dfe8ee'], fog: '#c9d6dc', light: { color: '#f4f0e4', ambient: '#838c96' },
    clouds: { count: 16, color: '#ffffff', shade: '#cfd8e0', seed: 7 },
    outside: '#5f8f45', field: ['#6f9a4c', '#679246'], lines: null, net: '#23281e',
    wood: ['#a8784a', '#946a40'],
  },
});

export const pbTheme = (key) => PB_THEMES[key] ?? PB_THEMES.opblaas;
