# CLAUDE.md – afspraken voor dit project

Timon's Arcade: multiplayer browsergames (2–6 spelers) met kamercodes. Eén Node.js-app serveert
`public/` en handelt WebSockets af op dezelfde poort.

## Commando's

- `npm run dev` – server met auto-restart (poort 3000)
- `npm test` – alle tests (`node --test "test/**/*.test.js"`)
- `node tools/botclients.js [--chaos] [--rooms N] [--duration S]` – stresstest tegen een draaiende server
- Browsercheck: Playwright staat globaal; start de server en open twee pages (zie README "Testen").

## Harde regels

- **Frontend:** vanilla JS met ES modules, HTML, CSS, Canvas. Geen framework, geen build-stap, geen bundler.
- **Backend:** Node.js LTS, enige dependency `ws`. Geen Express/Socket.IO. Ook geen devDependencies.
- Geen database, geen accounts, geen cookies, geen tracking, geen externe CDN's/fonts/assets.
- Geen auteursrechtelijk materiaal: eigen namen, eigen pixel art (procedureel of eigen SVG), eigen WebAudio-geluiden.
- **Comments in het Engels, UI-teksten in het Nederlands.**
- Nooit `innerHTML` met (speler)data. Gebruik `h()` uit `public/js/core/ui.js` (textContent).
- CSP is strikt: geen inline `<script>`, geen `style="…"` in HTML. Dynamische stijl via `el.style.x = …`
  (CSSOM mag) of via data-attributen + CSS (zie `[data-color]` in `base.css`).
- Bestanden klein en gefocust (richtlijn: max. ± 500 regels; splits zodra een bestand twee taken krijgt). Tuning-waarden als constanten bovenaan het
  bestand of in `shared/constants.js`.

## Architectuur

- **Server-authoritative.** Clients sturen alleen input; server valideert alles (snelheid, zetten, scores).
- `shared/` bevat pure modules (geen DOM, geen Node-API's) die client én server importeren.
  De server serveert `shared/` onder `/shared/`. Imports vanuit `public/` gebruiken paden die zowel
  als URL als op schijf kloppen, bijv. `../../../shared/x.js` vanuit `public/js/core/`.
- **Protocol** (`shared/messages.js`): JSON `{ t, v, … }`; binair `[u8 type][u8 version]…`.
  Wijzig je het wire-formaat → verhoog `PROTOCOL_VERSION` in `shared/constants.js`.
- **Validatie** (`server/protocol.js`): elk C2S-type heeft een schema; alleen bekende velden worden
  gekopieerd. Nieuw berichttype = schema toevoegen (en eventueel aan `LOBBY_TYPES`).
- **Realtime games:** 30 Hz simulatie, 20 Hz binaire snapshots, input via `InputQueue`
  (credits, geen speedhacks). Client: `Predictor` voor eigen entiteit, `SnapshotBuffer` (100 ms) voor de rest.
  Gedeelde fysica moet deterministisch zijn: alleen `+ - * /` en `Math.sqrt`, resultaat door `Math.fround`
  (zelfde precisie als de float32 in de snapshot). Geen `Math.random` in gedeelde fysica.
- **Bordspellen:** `realtime: false`, 10 Hz tick voor timers/bots, `snapshot(player)` per ontvanger
  (verborgen info!), `dirty = true` om een snapshot te pushen. Regels als pure modules in `shared/rules/`
  met `node --test`-tests. Zware AI (minimax) via `worker_threads` of strikt tijdsbudget.
- **Bots** draaien altijd op de server (`player.isBot`, `player.botLevel`: easy/normal/hard).
- **Eenmalige acties in realtime games** (een schot): JSON `{ t:'input', data }` → `onAction(player, data)`.
  Schoten dragen hun kijktijd mee (`serverNow() - INTERP_DELAY_MS`); de server spoelt terug met
  `server/lagcomp.js` (max. `MAX_REWIND_MS`).
- **Resultaten** voor de lobby: `{ title, columns, rows: [{ id, name, color, rank, values }] }`.
- **Arcade-basis (fase 5):** `server/games/arcade.js` (`ArcadeGame`: fases COUNTDOWN/PLAY/ROUND_END/END,
  `eachInput`, `endRound`, `finish`, `rows`) + client `public/games/common/arcade.js` (`createArcadeCore`).
- **Zware bot-berekeningen in realtime games** (Minigolf): als generator met een tijdsbudget per tick,
  nooit in één keer in `tick()`.

## Party-lobby

- Een kamer is niet vast aan één game: de host wisselt in de lobby met `C2S.GAME`. `Room.selectGame` zet
  `gameId/meta/module/settings` (instellingen per game onthouden in `settingsByGame`) en `_fitSeats` past de plekken
  aan: bots gaan eerst naar de bank (`benched`, komen terug bij een grotere game), daarna kijken de laatste joiners mee.
- `room.party = { mode: 'free'|'random'|'tournament', order, length, pool, draws, tournament }`, pure regels in
  `shared/party.js` (`gameFits`, `drawGame`, `scoreGame`, `champions`). Willekeurig: na elke **afgemaakte** game trekt de
  server een nieuwe (`drawNext`, `draws++` = roulette in de lobby). Toernooi: winst (rank 1) telt, plaatspunten
  (n-1 … 0) beslissen bij gelijke stand; afgebroken games tellen niet.
- `room.autoReturn` (party-modus ≠ free): bordspellen gaan na één potje zelf terug naar de lobby (geen rematch).
- CREATE zonder `game` = party-lobby (`mode` optioneel). Client: `public/js/party.js` (gamekaart, roulette, gamekiezer,
  pool, toernooistand) naast `public/js/lobby.js`.
- `node tools/botclients.js --party --clients 2` wisselt steeds van game: goede rooktest voor alle game-modules.

## Bordspellen (fase 1)

- Regels: `shared/rules/<id>.js`, puur en onveranderlijk (`apply` geeft een nieuwe state terug).
  `info` uit `apply` is publiek; alles wat geheim is (Zeeslag-vloot) alleen via `view(state, seat)`.
- Dobbelstenen en ander toeval alleen via de `rng` die de server meegeeft (tests gebruiken een vaste rng).
- Schaken: `shared/chess/position.js` (0x88, make/unmake). Perft-tests nooit laten verslechteren.
- Bots: `server/ai/<id>.js` → `pick(state, seat, level, rng)`; `worker: true` = draait in `server/ai/pool.js`.
  Bots mogen alleen zien wat hun seat mag zien (gebruik `rules.view`).
- Client: `createBoardModule(spec)` uit `public/games/board/kit.js`; houd lokale UI-state in `f.local`.
- `simultaneous: true` in de regels = iedereen tegelijk (geen beurten, bv. Mijnenveger); `botPace` = seconden per botzet.
- Merknamen vermijden: "Erger je niet!" i.p.v. het merk mens-erger-je-niet, "Reversi" i.p.v. Othello.

## 3D (WebGL)

- Eigen mini-engine in `public/js/gl/`: `mesh.js` (low-poly MeshBuilder, vertexkleuren, emissive, tint),
  `renderer.js` (WebGL 1, licht + mist + luchtverloop met retro-zon, punten-deeltjes), `mat4.js`, `particles.js`.
- `meta.gl = true`: `view.glCanvas` (WebGL, lage resolutie, pixelated) met `view.canvas` als 2D-HUD erboven.
- Spelwereld is 2D (x, y) → 3D (x, 0, y). Fysica blijft 2D en deterministisch in `shared/physics/`.
- Geen WebGL? `createRenderer3D` geeft `null`: val terug op een eenvoudige 2D-weergave.
- Lucht: `setColors({ sky, fog, light, sun: { …, retro? }, clouds })`. Zon is standaard gewoon; `retro: true` = synthwave-strepen.

## Stijl per game

- Elke game heeft een eigen sfeer die bij het spel past; neon alleen waar het in de naam zit (Neon Tikkertje).
  Voorbeelden: Turbo Kart GP = zonnige circuits per thema (`theme` in `shared/maps/kart-tracks.js`),
  Tank Tumult = legerterreinen per arena (`public/games/tanks/theme.js`), bordspellen = hout/vilt/papier/karton.
- Bordspellen: gebruik de oppervlakken uit `public/games/board/draw.js` (`woodTable`, `woodSquare`, `boardFrame`,
  `feltTable`, `dropShadow`) in plaats van een donkere achtergrond met glow.
- De site zelf (hub, lobby, zijpaneel) houdt de Timon's Arcade-huisstijl.
- **Pixel of scherp:** pixel-art alleen waar het de stijl is (Neon Tikkertje, Kwek Kwek Knal, Ruimtegolf).
  Alle andere games gebruiken `meta.pixelated: false`: 3D op schermresolutie met anti-aliasing, 2D met
  vectorvormen, `drawText` uit `core/hudtext.js` (gewone letter, zelfde aanroep als de pixelfont),
  `createSharpLayer(view, draw)` voor vaste achtergronden en `createFx({ smooth: true })`.
- 3D-deeltjes: `particles.draw(r, scale, additive)`; additief alleen voor vuur/vonken, rook en stof normaal.

## Nieuwe games (fase 6)

- **Spetterveld** (`paintball`): first person. Camera = `r.camera()` op ooghoogte; de eigen marker wordt na
  `gl.clear(DEPTH_BUFFER_BIT)` getekend. Beweging gedeeld (`shared/physics/paintball.js`), schoten als JSON-actie
  `{ a, t, x, y }` met lag compensation; de server vertrouwt de meegestuurde loop-positie tot `MAX_SHOT_OFFSET`.
  Game-specifieke toetsen via `meta.keys` (→ `new Input(meta.keys)`, extra acties met `input.pressed('turnLeft')`).
- **Quizkoorts** (`quiz`): eigen server-module (`realtime: false`); de vragenbank staat alleen op de server
  (`server/games/quiz-questions.js`), het goede antwoord gaat pas mee bij de onthulling. Catalogus-soort `kind: 'quiz'`.
- **Knalkanon** (`artillery`): beurtspel met eigen server-module; het terrein (720 hoogtes) gaat alleen in de
  snapshot als het veranderd is (`sentRev` per speler, reset bij reconnect).
- **Pinguïnbotsen** (`penguins`) en **Hapvis** (`fish`): voorspelde eigen beweging, botsen/opeten alleen op de server.
  Hapvis-plankton staat op vaste plekken uit de seed; de snapshot stuurt alleen een bitmasker.
- Pesten: `shared/rules/pesten.js` + `server/ai/pesten.js`; kaarten als vectorvormen in `public/games/pesten/cards.js`.
- Input onthoudt korte tikken tussen twee ticks (`Input.tapped`), zodat een snelle spatie niet wegvalt.

## Game-module interface

Server (`server/games/<id>.js`, registreren in `server/games/index.js`):
`{ id, realtime, create(room, settings) }` → instance met `onJoin`, `onLeave`, `onReconnect?`,
`onBotTakeover?`, `onInput(player, msg)`, `tick(dt)`, `snapshot(writerOrPlayer)`, `dispose?`.

Client (`public/games/<id>/client.js`): `export const meta = { width, height, pixelated, step, touchButtons }`
en `createGame()` → `mount(view, net, ctx)`, `onSnapshot(snap)`, `onEvent?`, `onRoom?`, `onReconnect?`,
`update?(dt)`, `render(alpha)`, `unmount()`.

Nieuwe game: limiet in `GAME_LIMITS`, catalogus-entry (`available: true`) in `shared/catalog.js`,
thumbnail in `public/js/thumbs.js`, server- en clientmodule, tests.

## Kwaliteit

- Na elke wijziging: `npm test`. Bij netcode-wijzigingen ook `botclients.js --chaos`.
- Browser: geen console-errors/warnings in Chrome, Firefox, Safari (ook iOS). Toetsenbord moet overal werken,
  focus zichtbaar, `prefers-reduced-motion` respecteren (geen shake, minder deeltjes).
- Performance: geen allocaties in hot loops, pools voor deeltjes/kogels, offscreen canvas voor vaste lagen.
  Server logt elke minuut de tick-duur.
- Werk fase voor fase en commit per fase met een duidelijke boodschap.

## Roadmap

0. Fundament + lobby + Neon Tikkertje ✅
1. Bordspellen: boter-kaas-en-eieren, vier op een rij, dammen, reversi, schaken, Erger je niet!, ganzenbord, zeeslag ✅
2. Kwek Kwek Knal (eenden schieten, lag compensation) ✅
3. Tank Tumult (tanks in 3D) ✅
4. Turbo Kart GP (3D-kartrace met eigen WebGL-engine) ✅
5. Extra's: Slangenstrijd, Paddle Party, Stenenbreker, Boemstad (3D), Spookjesdoolhof, Blokval, Minigolf (3D),
   Onthoud 'm, Mijnenveger, Ruimtegolf, Rotsregen ✅
6. Party-update: party-lobby (vrije keuze, willekeurig, toernooi), Spetterveld (3D-shooter), Pesten, Quizkoorts,
   Pinguïnbotsen (3D), Knalkanon, Hapvis ✅
