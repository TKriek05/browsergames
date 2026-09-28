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

## Bordspellen (fase 1)

- Regels: `shared/rules/<id>.js`, puur en onveranderlijk (`apply` geeft een nieuwe state terug).
  `info` uit `apply` is publiek; alles wat geheim is (Zeeslag-vloot) alleen via `view(state, seat)`.
- Dobbelstenen en ander toeval alleen via de `rng` die de server meegeeft (tests gebruiken een vaste rng).
- Schaken: `shared/chess/position.js` (0x88, make/unmake). Perft-tests nooit laten verslechteren.
- Bots: `server/ai/<id>.js` → `pick(state, seat, level, rng)`; `worker: true` = draait in `server/ai/pool.js`.
  Bots mogen alleen zien wat hun seat mag zien (gebruik `rules.view`).
- Client: `createBoardModule(spec)` uit `public/games/board/kit.js`; houd lokale UI-state in `f.local`.
- Merknamen vermijden: "Erger je niet!" i.p.v. het merk mens-erger-je-niet, "Reversi" i.p.v. Othello.

## 3D (WebGL)

- Eigen mini-engine in `public/js/gl/`: `mesh.js` (low-poly MeshBuilder, vertexkleuren, emissive, tint),
  `renderer.js` (WebGL 1, licht + mist + luchtverloop met retro-zon, punten-deeltjes), `mat4.js`, `particles.js`.
- `meta.gl = true`: `view.glCanvas` (WebGL, lage resolutie, pixelated) met `view.canvas` als 2D-HUD erboven.
- Spelwereld is 2D (x, y) → 3D (x, 0, y). Fysica blijft 2D en deterministisch in `shared/physics/`.
- Geen WebGL? `createRenderer3D` geeft `null`: val terug op een eenvoudige 2D-weergave.

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
4. Neon Kart GP (3D-kartrace met eigen WebGL-engine) ✅
5. Extra's (snake, paddle, breakout, bomber, spoken, blokken, minigolf, memory, mijnenveger, invaders, rotsen)
