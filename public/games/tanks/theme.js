// Tank Tumult looks per arena: a desert camp, a forest and a winter fort.
// Only visuals; the arena layout itself lives in shared/maps/tank-arenas.js.
export const TANK_THEMES = {
  kruispunt: {
    sky: ['#4a93d8', '#d8ecf8'], fog: '#e6dcc4',
    light: { color: '#e4d6b6', ambient: '#6a6456' },
    floor: ['#cfb27c', '#c7a973'], track: '#b89c66', outside: '#c4a670',
    wall: '#95784a', wallTop: '#a88a5a', wallLine: '#7a6040', cap: null, // sandbags
    border: '#76767a', borderTop: '#88888c',
    deco: 'desert', decoColors: ['#6f8f3a', '#a08a6a', '#8a7a5a'],
  },
  doolhof: {
    sky: ['#5a9ad8', '#d4e8f0'], fog: '#c8d8c0',
    light: { color: '#e2dcc4', ambient: '#646c5e' },
    floor: ['#5a8a3a', '#548436'], track: '#6b7a3e', outside: '#4c7a32',
    wall: '#77776f', wallTop: '#8a8a82', wallLine: '#62625c', cap: '#3c6a2c', // mossy stone
    border: '#6a6a66', borderTop: '#7c7c76',
    deco: 'forest', decoColors: ['#2f6a34', '#3a7a3c', '#28603a'],
  },
  fort: {
    sky: ['#8aa8c8', '#e8eef4'], fog: '#e4eaf0',
    light: { color: '#dde2ec', ambient: '#6c7486' },
    floor: ['#e2e8ee', '#d9e0e8'], track: '#c2ccd8', outside: '#e8eef3',
    wall: '#666c77', wallTop: '#7a808b', wallLine: '#555a64', cap: '#f4f7fb', // stone with snow
    border: '#5a5f69', borderTop: '#6c717b',
    deco: 'snow', decoColors: ['#2f5a44', '#3a664c', '#2a4f3e'],
  },
};

export const tankTheme = (key) => TANK_THEMES[key] ?? TANK_THEMES.kruispunt;
