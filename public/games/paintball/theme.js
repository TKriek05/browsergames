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
};

export const pbTheme = (key) => PB_THEMES[key] ?? PB_THEMES.opblaas;
