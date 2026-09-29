// Game catalog: display texts (Dutch) and host-configurable settings per game.
// Player limits come from constants.js so there is a single source of truth.
import { GAME_LIMITS } from './constants.js';

export const BOT_LEVEL_LABELS = { easy: 'Makkelijk', normal: 'Normaal', hard: 'Moeilijk' };

// Settings schema types:
//   select: { options: [{ value, label }], default }
//   toggle: { default: boolean }
const entries = [
  {
    id: 'tag',
    title: 'Neon Tikkertje',
    tagline: 'Tik elkaar af in een neon-arena, met power-ups. Wie het kortst de tikker is, wint.',
    kind: 'realtime',
    phase: 0,
    available: true,
    bots: true,
    controls: 'Pijltjes/WASD, gamepad of joystick',
    settings: [
      {
        key: 'duration',
        label: 'Speelduur',
        type: 'select',
        options: [
          { value: 60, label: '1 minuut' },
          { value: 90, label: '1,5 minuut' },
          { value: 120, label: '2 minuten' },
        ],
        default: 90,
      },
      {
        key: 'arena',
        label: 'Arena',
        type: 'select',
        options: [
          { value: 'pillars', label: 'Pilaren' },
          { value: 'maze', label: 'Doolhofje' },
          { value: 'open', label: 'Open veld' },
        ],
        default: 'pillars',
      },
      { key: 'powerups', label: 'Power-ups (turbo, schild, vriesgolf …)', type: 'toggle', default: true },
    ],
  },

  // --- Phase 1: board games -------------------------------------------------
  {
    id: 'tictactoe', title: 'Boter-kaas-en-eieren', tagline: 'Drie op een rij, de snelste klassieker.',
    kind: 'board', phase: 1, available: true, bots: true, controls: 'Klik of tik op een vak, of pijltjes + Enter',
  },
  {
    id: 'connect4', title: 'Vier op een rij', tagline: 'Laat schijven vallen en maak er vier op een rij.',
    kind: 'board', phase: 1, available: true, bots: true, controls: 'Klik of tik op een kolom, of pijltjes + Enter',
  },
  {
    id: 'checkers', title: 'Dammen', tagline: 'Nederlandse regels op een 10×10 bord.',
    kind: 'board', phase: 1, available: true, bots: true,
    controls: 'Klik je stuk en daarna het doelveld (bij twijfel ook de tussenvelden)',
  },
  {
    id: 'reversi', title: 'Reversi', tagline: 'Sluit stenen in en draai ze om.',
    kind: 'board', phase: 1, available: true, bots: true, controls: 'Klik of tik op een vak met een stip, of pijltjes + Enter',
  },
  {
    id: 'chess', title: 'Schaken', tagline: 'Volledige regels, met bots in drie niveaus.',
    kind: 'board', phase: 1, available: true, bots: true, controls: 'Klik een stuk en daarna het doelveld, of pijltjes + Enter',
  },
  {
    id: 'ludo', title: 'Erger je niet!', tagline: 'Gooi, loop en sla elkaar terug naar start.',
    kind: 'board', phase: 1, available: true, bots: true, controls: 'Gooi met de knop of spatie, klik daarna een pion',
  },
  {
    id: 'goose', title: 'Ganzenbord', tagline: 'Het oer-Hollandse dobbelspel voor de hele groep.',
    kind: 'board', phase: 1, available: true, bots: true, controls: 'Gooi met de knop of spatie',
  },
  {
    id: 'battleship', title: 'Zeeslag', tagline: 'Verstop je vloot en jaag op die van de ander.',
    kind: 'board', phase: 1, available: true, bots: true, controls: 'Plaats je schepen, klik daarna op het water van de tegenstander',
    settings: [
      { key: 'touching', label: 'Schepen mogen elkaar raken', type: 'toggle', default: false },
      { key: 'extraShot', label: 'Nog een keer schieten bij raak', type: 'toggle', default: true },
    ],
  },

  // --- Phase 2-4 ----------------------------------------------------------------
  {
    id: 'duckshoot',
    title: 'Kwek Kwek Knal',
    tagline: 'Schiet eenden met z’n allen, samen of tegen elkaar.',
    kind: 'realtime',
    phase: 2,
    available: true,
    bots: true,
    controls: 'Muis of tik om te schieten, rechtsklik/R om te herladen. Toetsen: pijltjes + spatie',
    settings: [
      {
        key: 'mode',
        label: 'Spelvorm',
        type: 'select',
        options: [
          { value: 'versus', label: 'Tegen elkaar' },
          { value: 'coop', label: 'Samen (haal het quotum)' },
        ],
        default: 'versus',
      },
      {
        key: 'rounds',
        label: 'Rondes',
        type: 'select',
        options: [
          { value: 3, label: '3 rondes' },
          { value: 5, label: '5 rondes' },
          { value: 7, label: '7 rondes' },
        ],
        default: 5,
      },
    ],
  },
  {
    id: 'tanks',
    title: 'Tank Tumult',
    tagline: 'Tankgevechten in 3D met stuiterende kogels en kratten.',
    kind: 'realtime',
    phase: 3,
    available: true,
    bots: true,
    controls: 'Pijltjes/WASD rijden, muis mikken + klik of spatie schieten. Gamepad: rechter stick mikt',
    settings: [
      {
        key: 'mode',
        label: 'Spelvorm',
        type: 'select',
        options: [
          { value: 'deathmatch', label: 'Op tijd (meeste treffers)' },
          { value: 'rounds', label: 'Laatste tank (3 rondes winnen)' },
        ],
        default: 'deathmatch',
      },
      {
        key: 'duration',
        label: 'Speelduur (op tijd)',
        type: 'select',
        options: [
          { value: 120, label: '2 minuten' },
          { value: 180, label: '3 minuten' },
          { value: 300, label: '5 minuten' },
        ],
        default: 180,
      },
      {
        key: 'arena',
        label: 'Arena',
        type: 'select',
        options: [
          { value: 'kruispunt', label: 'Woestijnkamp' },
          { value: 'doolhof', label: 'Bosdoolhof' },
          { value: 'fort', label: 'Winterfort' },
        ],
        default: 'kruispunt',
      },
    ],
  },
  {
    id: 'kartrace',
    title: 'Turbo Kart GP',
    tagline: 'Kartracen in 3D met drift, items en een Grand Prix.',
    kind: 'realtime',
    phase: 4,
    available: true,
    bots: true,
    controls: 'Pijltjes/WASD (omhoog = gas), Shift = driften, E = item. Touch: stuur + knoppen',
    settings: [
      {
        key: 'track',
        label: 'Circuit',
        type: 'select',
        options: [
          { value: 'ring', label: 'Groene Vallei' },
          { value: 'park', label: 'Herfstbos' },
          { value: 'boulevard', label: 'Strandboulevard' },
          { value: 'alpine', label: 'Alpenpas (heuvels)' },
          { value: 'canyon', label: 'Rode Canyon (heuvels)' },
          { value: 'volcano', label: 'Vulkaaneiland (heuvels)' },
          { value: 'gp', label: 'Grand Prix: Klassiek (3 races)' },
          { value: 'gphills', label: 'Grand Prix: Heuvels (3 races)' },
        ],
        default: 'ring',
      },
      {
        key: 'laps',
        label: 'Rondes',
        type: 'select',
        options: [
          { value: 2, label: '2 rondes' },
          { value: 3, label: '3 rondes' },
          { value: 5, label: '5 rondes' },
        ],
        default: 3,
      },
      { key: 'items', label: 'Items', type: 'toggle', default: true },
    ],
  },

  // --- Extras -------------------------------------------------------------------
  {
    id: 'snake', title: 'Slangenstrijd', tagline: 'Battle royale met slangen: blijf het langst over.',
    kind: 'realtime', phase: 5, available: true, bots: true, controls: 'Pijltjes/WASD, gamepad of joystick',
    settings: [
      {
        key: 'rounds', label: 'Rondes', type: 'select',
        options: [{ value: 1, label: '1 ronde' }, { value: 3, label: '3 rondes' }, { value: 5, label: '5 rondes' }],
        default: 3,
      },
    ],
  },
  {
    id: 'paddle', title: 'Paddle Party', tagline: 'Pong met tot vier spelers: elke kant een batje.',
    kind: 'realtime', phase: 5, available: true, bots: true, controls: 'Onder/boven: links-rechts. Links/rechts: omhoog-omlaag',
    settings: [
      {
        key: 'lives', label: 'Levens', type: 'select',
        options: [{ value: 3, label: '3 levens' }, { value: 5, label: '5 levens' }, { value: 7, label: '7 levens' }],
        default: 5,
      },
    ],
  },
  {
    id: 'breakout', title: 'Stenenbreker', tagline: 'Samen de muur kapot kaatsen, drie levels.',
    kind: 'realtime', phase: 5, available: true, bots: true, controls: 'Pijltjes, muis of joystick. Spatie/klik = bal afschieten',
  },
  {
    id: 'bomber', title: 'Boemstad', tagline: 'Leg bommen, blaas muren op, blijf overeind. Vijf maps, in 3D.',
    kind: 'realtime', phase: 5, available: true, bots: true, controls: 'Pijltjes/WASD lopen, spatie of BOM om een bom te leggen',
    settings: [
      {
        key: 'map', label: 'Map', type: 'select',
        options: [
          { value: 'stad', label: 'Dorpsplein' },
          { value: 'park', label: 'Stadspark' },
          { value: 'haven', label: 'Haven' },
          { value: 'kasteel', label: 'Kasteel' },
          { value: 'winter', label: 'Winterdorp' },
          { value: 'wissel', label: 'Elke ronde een andere' },
        ],
        default: 'stad',
      },
      {
        key: 'wins', label: 'Winnen bij', type: 'select',
        options: [{ value: 1, label: '1 ronde' }, { value: 2, label: '2 rondes' }, { value: 3, label: '3 rondes' }],
        default: 2,
      },
    ],
  },
  {
    id: 'ghosts', title: 'Spookjesdoolhof', tagline: 'Eet stipjes en ontloop de spoken, samen.',
    kind: 'realtime', phase: 5, available: true, bots: true, controls: 'Pijltjes/WASD, gamepad of joystick',
  },
  {
    id: 'blocks', title: 'Blokval', tagline: 'Vallende blokken, versus met rommelrijen.',
    kind: 'realtime', phase: 5, available: true, bots: true,
    controls: 'Links/rechts, omhoog = draaien, omlaag = sneller, spatie = laten vallen',
  },
  {
    id: 'minigolf', title: 'Minigolf', tagline: 'Negen holes in een zonnig park, in 3D.',
    kind: 'realtime', phase: 5, available: true, bots: true, controls: 'Sleep terug en laat los om te slaan, of pijltjes + spatie',
    settings: [
      {
        key: 'holes', label: 'Aantal holes', type: 'select',
        options: [{ value: 3, label: '3 holes' }, { value: 6, label: '6 holes' }, { value: 9, label: '9 holes' }],
        default: 6,
      },
    ],
  },
  {
    id: 'memory', title: 'Onthoud ’m', tagline: 'Draai kaartjes om en vind de paren.',
    kind: 'board', phase: 5, available: true, bots: true, controls: 'Klik of tik op een kaart, of pijltjes + Enter',
    settings: [
      {
        key: 'size', label: 'Aantal kaarten', type: 'select',
        options: [{ value: 'klein', label: '16 (4×4)' }, { value: 'normaal', label: '24 (6×4)' }, { value: 'groot', label: '36 (6×6)' }],
        default: 'normaal',
      },
    ],
  },
  {
    id: 'mines', title: 'Mijnenveger', tagline: 'Samen tegelijk het veld veilig vegen.',
    kind: 'board', phase: 5, available: true, bots: true,
    controls: 'Klik = vegen, rechtsklik of lang drukken = vlag. Toetsen: pijltjes, Enter, F',
    settings: [
      {
        key: 'size', label: 'Veld', type: 'select',
        options: [{ value: 'klein', label: 'Klein (9×9, 10 mijnen)' }, { value: 'middel', label: 'Middel (16×12, 32 mijnen)' }, { value: 'groot', label: 'Groot (24×14, 62 mijnen)' }],
        default: 'middel',
      },
      {
        key: 'lives', label: 'Levens', type: 'select',
        options: [{ value: 1, label: '1 leven' }, { value: 3, label: '3 levens' }, { value: 5, label: '5 levens' }],
        default: 3,
      },
    ],
  },
  {
    id: 'invaders', title: 'Ruimtegolf', tagline: 'Houd de aanvallende golven samen tegen.',
    kind: 'realtime', phase: 5, available: true, bots: true, controls: 'Links/rechts bewegen, spatie of VUUR schieten',
    settings: [
      {
        key: 'waves', label: 'Golven', type: 'select',
        options: [{ value: 3, label: '3 golven' }, { value: 5, label: '5 golven' }, { value: 0, label: 'Eindeloos' }],
        default: 5,
      },
    ],
  },
  {
    id: 'rocks', title: 'Rotsregen', tagline: 'Schiet de ruimterotsen aan gruzelementen.',
    kind: 'realtime', phase: 5, available: true, bots: true, controls: 'Links/rechts draaien, omhoog = gas, spatie = vuur',
    settings: [
      {
        key: 'mode', label: 'Spelvorm', type: 'select',
        options: [{ value: 'coop', label: 'Samen' }, { value: 'versus', label: 'Tegen elkaar' }],
        default: 'coop',
      },
      {
        key: 'lives', label: 'Levens', type: 'select',
        options: [{ value: 1, label: '1 leven' }, { value: 3, label: '3 levens' }, { value: 5, label: '5 levens' }],
        default: 3,
      },
    ],
  },

  // --- Party update ---------------------------------------------------------------
  {
    id: 'paintball', title: 'Spetterveld', tagline: 'Paintball in 3D: spetter je vrienden onder de verf. De verf blijft overal zitten.',
    kind: 'realtime', phase: 6, available: true, bots: true,
    controls: 'Klik om te richten met de muis, WASD lopen, klik = schieten, R = herladen. Toetsen: pijltjes draaien, spatie schiet',
    settings: [
      {
        key: 'duration', label: 'Speelduur', type: 'select',
        options: [{ value: 120, label: '2 minuten' }, { value: 180, label: '3 minuten' }, { value: 300, label: '5 minuten' }],
        default: 180,
      },
      {
        key: 'arena', label: 'Veld', type: 'select',
        options: [
          { value: 'haven', label: 'Containerhaven' }, { value: 'avond', label: 'Avondveld' }, { value: 'opblaas', label: 'Opblaasveld' },
          { value: 'bos', label: 'Bosveld' }, { value: 'erf', label: 'Boerenerf' },
        ],
        default: 'haven',
      },
      { key: 'powerups', label: 'Power-ups (snelvuur, hagel, pantser …)', type: 'toggle', default: true },
    ],
  },
  {
    id: 'pesten', title: 'Pesten', tagline: 'Het kaartspel met pestkaarten: wie is als eerste door zijn kaarten heen?',
    kind: 'board', phase: 6, available: true, bots: true,
    controls: 'Klik een kaart om te spelen, of pak een kaart van de stapel. Toetsen: pijltjes + Enter',
    settings: [
      {
        key: 'hand', label: 'Kaarten per speler', type: 'select',
        options: [{ value: 7, label: '7 kaarten' }, { value: 5, label: '5 kaarten' }],
        default: 7,
      },
      { key: 'jokers', label: 'Met jokers (+5)', type: 'toggle', default: true },
    ],
  },
  {
    id: 'quiz', title: 'Quizkoorts', tagline: 'Een snelle kennisquiz: goed én snel antwoorden levert de meeste punten.',
    kind: 'quiz', phase: 6, available: true, bots: true,
    controls: 'Klik of tik op een antwoord, of druk op 1 t/m 4 (of A t/m D)',
    settings: [
      {
        key: 'count', label: 'Aantal vragen', type: 'select',
        options: [{ value: 10, label: '10 vragen' }, { value: 15, label: '15 vragen' }, { value: 20, label: '20 vragen' }],
        default: 10,
      },
      {
        key: 'time', label: 'Tijd per vraag', type: 'select',
        options: [{ value: 10, label: '10 seconden' }, { value: 15, label: '15 seconden' }, { value: 20, label: '20 seconden' }],
        default: 15,
      },
      {
        key: 'category', label: 'Onderwerp', type: 'select',
        options: [
          { value: 'alles', label: 'Van alles wat' },
          ...['Nederland', 'Aardrijkskunde', 'Geschiedenis', 'Natuur', 'Wetenschap', 'Sport & spel', 'Taal & cultuur', 'Eten & drinken', 'Techniek']
            .map((c) => ({ value: c, label: c })),
        ],
        default: 'alles',
      },
    ],
  },
  {
    id: 'penguins', title: 'Pinguïnbotsen', tagline: 'Glibber over een smeltende ijsschots en duw de rest het water in. In 3D.',
    kind: 'realtime', phase: 6, available: true, bots: true,
    controls: 'Pijltjes/WASD of joystick glijden, spatie of DUW om te botsen',
    settings: [
      {
        key: 'wins', label: 'Winnen bij', type: 'select',
        options: [{ value: 2, label: '2 rondes' }, { value: 3, label: '3 rondes' }, { value: 5, label: '5 rondes' }],
        default: 3,
      },
      { key: 'powerups', label: 'Power-ups (visje, ijzers, bokshandschoen …)', type: 'toggle', default: true },
    ],
  },
  {
    id: 'artillery', title: 'Knalkanon', tagline: 'Om de beurt schieten over de heuvels: let op de wind en blaas kraters.',
    kind: 'board', phase: 6, available: true, bots: true,
    controls: 'Sleep vanaf je kanon om te richten of gebruik ←/→ (hoek) en ↑/↓ (kracht). A/D rijden, 1-3 wapen, spatie = vuur',
    settings: [
      {
        key: 'rounds', label: 'Winnen bij', type: 'select',
        options: [{ value: 1, label: '1 ronde' }, { value: 2, label: '2 rondes' }, { value: 3, label: '3 rondes' }],
        default: 1,
      },
      {
        key: 'landscape', label: 'Landschap', type: 'select',
        options: [
          { value: 'mix', label: 'Afwisselend' }, { value: 'gras', label: 'Groene heuvels' },
          { value: 'woestijn', label: 'Woestijn' }, { value: 'sneeuw', label: 'Sneeuwbergen' },
        ],
        default: 'mix',
      },
    ],
  },
  {
    id: 'fish', title: 'Hapvis', tagline: 'Eet plankton en kleinere vissen, en zwem weg van de grote.',
    kind: 'realtime', phase: 6, available: true, bots: true,
    controls: 'Pijltjes/WASD, joystick of muis om te zwemmen, spatie of HAP voor een sprintje',
    settings: [
      {
        key: 'duration', label: 'Speelduur', type: 'select',
        options: [{ value: 120, label: '2 minuten' }, { value: 180, label: '3 minuten' }, { value: 300, label: '5 minuten' }],
        default: 180,
      },
      { key: 'powerups', label: 'Power-ups (turbo, stekels, magneet …)', type: 'toggle', default: true },
    ],
  },
  {
    id: 'kladder', title: 'Kladderkoning', tagline: 'Verfbattle: rol zoveel mogelijk van het doek in jouw kleur. Duw = spetter!',
    kind: 'realtime', phase: 7, available: true, bots: true,
    controls: 'Pijltjes/WASD of joystick om te rollen, spatie of DUW voor een spetterstoot',
    settings: [
      {
        key: 'duration', label: 'Speelduur', type: 'select',
        options: [{ value: 90, label: '1,5 minuut' }, { value: 120, label: '2 minuten' }, { value: 180, label: '3 minuten' }],
        default: 120,
      },
      {
        key: 'map', label: 'Doek', type: 'select',
        options: [{ value: 'atelier', label: 'Atelier' }, { value: 'open', label: 'Leeg doek' }, { value: 'doolhof', label: 'Doolhof' }],
        default: 'atelier',
      },
      { key: 'powerups', label: 'Power-ups (brede roller, turbo, verfbom)', type: 'toggle', default: true },
    ],
  },
];

// Fill in limits + defaults so consumers can rely on every field existing.
export const CATALOG = Object.freeze(
  Object.fromEntries(
    entries.map((e) => {
      const limits = GAME_LIMITS[e.id];
      if (!limits) throw new Error(`Missing GAME_LIMITS entry for ${e.id}`);
      return [
        e.id,
        Object.freeze({
          available: false,
          bots: false,
          spectators: true,
          controls: '',
          settings: [],
          ...e,
          min: limits.min,
          max: limits.max,
        }),
      ];
    }),
  ),
);

export const GAME_IDS = Object.keys(CATALOG);

export function getGame(id) {
  return Object.hasOwn(CATALOG, id) ? CATALOG[id] : null;
}
