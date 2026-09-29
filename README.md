# Timon's Arcade

Multiplayer browsergames voor **2 t/m 6 spelers** met een simpele kamercode.
Eén Node.js-app serveert de frontend én de WebSockets. Geen framework, geen
build-stap, geen database, geen accounts, geen tracking.

- **Frontend:** vanilla JavaScript (ES modules), HTML, CSS, Canvas
- **Backend:** Node.js (LTS, ≥ 22) met precies één dependency: [`ws`](https://github.com/websockets/ws)
- **Status:** 29 spellen (bordspellen, kaartspel, quiz, realtime arcade en zes games in 3D), allemaal met bots,
  plus een **party-lobby**: de host kiest de games, iedereen stemt, de arcade kiest, of je speelt een toernooi.

> **Nieuw hier of code nog niet op GitHub?** Volg eerst [docs/SETUP.md](docs/SETUP.md):
> repo vullen, branches, automatische tests en de weg van repo naar server.

---

## Lokaal draaien

```bash
npm install
npm run dev        # herstart automatisch bij wijzigingen in server/ en shared/
# of: npm start
```

Open <http://localhost:3000>.

### Testen met meerdere spelers

1. **Twee tabbladen:** maak in tab 1 een kamer, kopieer de link en open die in tab 2.
   Elk tabblad is een aparte speler (de sessie staat in `sessionStorage`).
   Tip: gebruik een tweede browser of een privévenster als je de bijnaam apart wilt houden.
2. **Telefoon op hetzelfde wifi-netwerk:** zoek het IP van je pc (`ip a` / `ipconfig`)
   en open `http://192.168.x.x:3000`. Scan de QR-code in de lobby.
3. **Solo:** klik op *Solo* bij een game: je krijgt een kamer vol bots.
   Of maak een **party-lobby** (knoppen bovenaan de startpagina) en vul hem met bots.
4. **Reconnect testen:** ververs een tabblad tijdens het spel → je komt terug op je plek.
   Sluit een tabblad → na 60 s neemt een bot je plek over.

### Automatische tests

```bash
npm test                                   # node --test: regels (o.a. schaak-perft), protocol, server-integratie
npm run bots                               # 6 nep-clients, 1 kamer, 20 s (server moet draaien)
node tools/botclients.js --chaos           # + wegvallen/terugkomen, host vertrekt, rommel sturen, kamer overvol
node tools/botclients.js --rooms 8 --duration 60
node tools/botclients.js --party --clients 2 --duration 120   # party-lobby: wisselt steeds van game (rooktest voor álle games)
node tools/botclients.js --vote --clients 3 --duration 60     # stem-lobby: iedereen stemt, de stemmen wisselen de game
```

Veel kamers vanaf één IP? Start de server dan met ruimere limieten:
`MAX_CONN_PER_IP=500 MAX_ROOMS_PER_IP=100 ROOMS_PER_MINUTE=500 CONNECTS_PER_MINUTE=2000 npm start`.

---

## Party-lobby

Een kamer zit niet vast aan één game. In de lobby kiest de host de volgende game uit een raster met
alle spellen (spellen die niet bij het aantal spelers passen staan grijs). Iedereen kan met **Stem op een game**
laten weten wat hij wil spelen; de stemmen staan als gekleurde stipjes op de kaarten. Er zijn vier party-modi:

| Modus | Hoe het werkt |
|-------|---------------|
| **Vrije keuze** | De host kiest elke keer zelf de game (of drukt op *Verras ons*). De stemmen zijn een advies. |
| **Stemmen** | De game met de meeste stemmen wordt meteen gekozen. Gelijke stand: de huidige game blijft, anders wint de game die als eerste een stem kreeg. Games met te weinig plekken tellen niet. Na elke start begint het stemmen opnieuw. |
| **Willekeurig** | Na elke game trekt de arcade een nieuwe game (met een korte roulette), uit de games die de host heeft aangevinkt en die bij de groep passen. |
| **Toernooi** | Een reeks van 3, 5, 7 of 10 games. Elke gewonnen game telt; bij gelijke stand beslissen de plaatspunten. De volgende game kiest de host, het toeval (zonder herhalingen) of de stemmen. |

- Bots die bij een kleinere game niet passen, gaan **op de bank** en komen terug bij een grotere game.
- Wie geen plek heeft, kijkt mee en krijgt de eerstvolgende vrije plek.
- Bordspellen gaan in een party vanzelf terug naar de lobby na één potje; instellingen per game worden onthouden.
- Maak een party-lobby met de knoppen **Party-lobby**, **Stemmen**, **Willekeurig** of **Toernooi** bovenaan de startpagina.
  *Maak kamer* bij een game kan ook: daarna kun je in de lobby gewoon van game wisselen.

## Spellen

| Spel | Spelers | Bijzonderheden |
|---|---|---|
| Neon Tikkertje | 2-6 | Realtime (30 Hz), prediction + interpolatie, 3 arena's |
| Boter-kaas-en-eieren | 2 | Perfecte bot op "moeilijk" |
| Vier op een rij | 2 | Schijven vallen door het bord, alpha-beta-bot |
| Reversi | 2 | Automatisch passen, omdraai-animatie |
| Dammen | 2 | 10×10, Nederlandse regels: verplicht meeste slaan, vliegende dam, Turkse slag |
| Schaken | 2 | Volledige regels, perft-getest, engine in een worker thread |
| Erger je niet! | 2-4 | Geïnspireerd op mens-erger-je-niet, eigen naam |
| Ganzenbord | 2-6 | Klassieke vakjes: ganzen, brug, herberg, put, doolhof, gevangenis, dood |
| Zeeslag | 2 | Verborgen vloot per speler, slimme bot met kansenkaart |
| Turbo Kart GP | 1-6 | 3D-racer met achtervolgcamera, drift + mini-turbo, boost-pads, items (turbo, stuiterbal, olievlek, schild), 3 circuits (Groene Vallei, Herfstbos, Strandboulevard) of een Grand Prix met punten |
| Tank Tumult | 2-6 | 3D (eigen WebGL-engine), stuiterende kogels, kapotschietbare kratten, power-ups, op tijd of laatste tank |
| Kwek Kwek Knal | 1-6 | Eenden schieten met muis, touch of toetsen. Lag compensation: de server spoelt terug naar wat jij zag. Tegen elkaar of samen (quotum per ronde) |
| Boemstad | 2-6 | **3D.** Bommen leggen in een Hollands dorpje, power-ups, kettingreacties; na 90 s krimpt het dorp. Eerst N rondes |
| Minigolf | 1-6 | **3D.** Negen holes in een zonnig park (zand, water, bumpers, heuvel), iedereen tegelijk. Sleep terug en laat los, of pijltjes + spatie |
| Slangenstrijd | 2-6 | Battle royale met slangen, laatste die overblijft wint de ronde |
| Paddle Party | 2-4 | Pong met een batje aan elke kant, levens per speler |
| Stenenbreker | 1-4 | Samen de muur kapot kaatsen, power-up capsules, drie levels |
| Ruimtegolf | 1-6 | Samen de golven aanvallers tegenhouden, gedeelde levens |
| Rotsregen | 1-6 | Ruimteschip met wrap-around; samen of tegen elkaar |
| Blokval | 2-6 | Vallende blokken versus: rijen wegspelen stuurt rommelrijen naar de anderen |
| Spookjesdoolhof | 1-4 | Samen stipjes eten en spoken ontwijken, krachtpillen maken ze bang |
| Onthoud 'm | 2-6 | Memory: kaartjes omdraaien en paren zoeken (16, 24 of 36 kaarten) |
| Mijnenveger | 1-6 | Samen tegelijk hetzelfde veld vegen, gedeelde levens |
| Spetterveld | 2-6 | **3D first-person shooter** (paintball): muis via pointer lock + WASD, lag compensation, 3 velden (opblaasbunkers, bos, boerenerf), verf blijft plakken |
| Pesten | 2-6 | Het Nederlandse kaartspel: 2 en joker (stapelen), 7 blijft kleven, 8 wacht, aas keert, boer vraagt een kleur |
| Quizkoorts | 1-6 | Kennisquiz in een tv-studio: 186 eigen vragen in 9 onderwerpen, snel én goed = meeste punten |
| Pinguïnbotsen | 2-6 | **3D.** Glibberen en duwen op een smeltende ijsschots; laatste pinguïn op het ijs wint de ronde |
| Knalkanon | 2-6 | Artillerie om de beurt: hoek, kracht, wind, drie wapens en kraters in het landschap |
| Hapvis | 1-6 | Onder water: eet plankton en kleinere vissen, vlucht voor grotere; punten gaan nooit omlaag |

Bij alle bordspellen: beurtindicator, zet-animaties, **zet terugnemen alleen als de ander akkoord gaat**
(tegen een bot mag het meteen), **nog een potje** (wie begint wisselt), score over alle potjes in de lobby,
toeschouwers, snelle reacties en volledige bediening met het toetsenbord (pijltjes + Enter, spatie om te gooien).

## Projectstructuur

```
server/            http (statische bestanden + /healthz) en WebSocket, kamers, protocol, rate limiting
  games/           server-kant per game (arcade.js = basis voor de kleinere realtime games)
  ai/              bots voor de bordspellen (zware zoekers in worker threads)
  lagcomp.js       terugspoelen voor schoten (lag compensation)
shared/            code die client én server gebruiken (pure ES modules; party.js = party-regels en toernooipunten)
  physics/ maps/ rules/  fysica, levels als data, bordspelregels
public/            alles wat de browser krijgt
  js/core/         net, session, input, touch, audio, storage, loop, canvas, interp, predict, qr, ui, pixelfont, fx
  js/gl/           eigen WebGL-mini-engine voor de 3D-games (mesh, renderer, mat4, particles)
  js/lobby.js      gedeelde lobby
  js/party.js      party-deel van de lobby: gamekiezer, stemmen, roulette, party-modus, toernooistand
  js/hub.js        startpagina + wisselen tussen hub/lobby/spel
  games/<id>/      client-kant per game (common/arcade.js = gedeelde client-basis)
tools/botclients.js  stresstest
deploy/            deploy.sh, pm2-config, nginx-snippet, systemd-voorbeeld
test/              node --test
```

## Hoe het werkt (kort)

- **Server-authoritative:** de server bepaalt de spelstaat. Clients sturen alleen *input*.
- **Kamers** leven in het geheugen. 4-letterige code (geen I, L, O), max. 6 personen.
  Extra mensen worden toeschouwer. Lege plekken vul je met bots (makkelijk/normaal/moeilijk).
- **Reconnect:** elke speler krijgt een sessietoken. Binnen 60 s terugkomen = zelfde plek.
- **Host-migratie:** vertrekt de host, dan wordt de volgende speler host.
- **Protocol:** JSON (`{ t, v, … }`) voor lobby en bordspellen, compacte binaire berichten voor
  snelle games (input 10 bytes, snapshots ~180 bytes voor 6 spelers).
- **Tickrates:** simulatie 30 Hz, snapshots 20 Hz, andere spelers 100 ms geïnterpoleerd.
  Je eigen figuur wordt voorspeld met exact dezelfde fysicacode (`shared/physics/`) en
  gecorrigeerd zodra de server antwoordt (prediction + reconciliation).
- **Heartbeat:** WebSocket-ping elke 25 s (Cloudflare sluit stille verbindingen na ± 100 s),
  plus een app-ping elke 2 s voor de latency-indicator.
- **Beveiliging:** origin-check, `maxPayload` 16 KB, schema-validatie van elk bericht,
  rate limits per verbinding en per IP, bijnamen opgeschoond en alleen als tekst getoond,
  strikte CSP (geen inline scripts/styles).

### Een bordspel toevoegen

1. Regels als pure module in `shared/rules/<id>.js` (interface bovenin `shared/rules/tictactoe.js`):
   `setup`, `toMove`, `legalMoves`, `apply` (muteert niets), `result`, `view` (verborgen info!).
2. Tests in `test/` met bekende stellingen.
3. Registreer de module in `BOARD_RULES` in `server/games/index.js`. De adapter `server/games/board.js`
   regelt beurten, validatie, bots, terugnemen, rematch en score.
4. Optioneel een bot in `server/ai/<id>.js` (en in `server/ai/engines.js`); `worker: true` voor zware zoekers.
   Zonder engine doet een bot een willekeurige geldige zet.
5. Client: `public/games/<id>/client.js` met `createBoardModule({ draw, pick, onPick, … })` uit
   `public/games/board/kit.js`.

### Een game toevoegen

1. Limiet in `shared/constants.js` (`GAME_LIMITS`) en tekst + instellingen in `shared/catalog.js` (`available: true`).
2. Server: `server/games/<id>.js` met `create(room, settings)` → `onJoin`, `onLeave`, `onInput`, `tick`, `snapshot`
   (zie de uitleg bovenin `server/games/index.js`) en registreer hem daar.
3. Client: `public/games/<id>/client.js` met `meta` en `createGame()` → `mount`, `onSnapshot`, `render`, `unmount`
   (zie `public/js/core/gamehost.js`).
4. Kleine realtime game? Erf van `ArcadeGame` (`server/games/arcade.js`: aftellen → spelen → ronde-einde → einde)
   en gebruik `createArcadeCore` (`public/games/common/arcade.js`) op de client. Wil je 3D: `meta.gl = true`
   en de engine in `public/js/gl/` (zie Boemstad of Minigolf als voorbeeld).

---

## Deployen: Node.js-site in CloudPanel achter Cloudflare

Het volledige stappenplan staat in **[docs/CLOUDPANEL.md](docs/CLOUDPANEL.md)**. In het kort:

1. **Cloudflare:** A-record `games` → VPS-IP (oranje wolk), SSL/TLS op *Full*.
2. **CloudPanel:** *Add Site → Create a Node.js Site* (Node 22+, App Port `3000`, site-user `tkriek-games`).
3. **Inloggen** als site-user: SSH (`ssh tkriek-games@<IP>`), een app als Termius, of de webconsole
   van je VPS + `su - tkriek-games`. De repo hoeft niet op je eigen computer te staan.
4. **Setup-script** op de server. Het regelt Node, code, `.env`, `npm ci`, pm2 en herstart na een reboot:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/TKriek05/browsergames/HEAD/deploy/cloudpanel-setup.sh | bash -s -- --domain games.tkriek.dev --port 3000
   ```
5. **Vhost:** vervang `location /` door `~/arcade-vhost-snippet.conf` (het script zet hem klaar).
6. **SSL:** Let's Encrypt in CloudPanel, daarna Cloudflare op *Full (strict)*.
7. **Beveiliging:** *Allow traffic from Cloudflare only*; Rocket Loader, Email Obfuscation en Web Analytics uit.

**Updaten:** hetzelfde setup-commando opnieuw draaien (git op de server), of `./deploy/deploy.sh`
(rsync vanaf je computer). Spelers met een oude pagina zien *"Er is een nieuwe versie – Ververs"*.
Let op: kamers staan in het geheugen. **Een deploy of herstart beëindigt lopende potjes.**

**Logs:** `pm2 logs timons-arcade`. Elke minuut logt de server de tick-duur (`tick stats`) als er
gespeeld wordt; boven 10 ms wordt het een waarschuwing.

**Zoekmachines:** de site is *noindex*. Elke response heeft `X-Robots-Tag: noindex, nofollow, noarchive`
en de pagina een robots-meta-tag. Bewust geen `robots.txt`-blokkade, anders zien crawlers de noindex niet.

Liever systemd zonder pm2? Zie het voorbeeld in [`deploy/timons-arcade.service`](deploy/timons-arcade.service).

### Omgevingsvariabelen

| Variabele | Standaard | Uitleg |
|---|---|---|
| `PORT` | `3000` | Poort van de app (= App Port in CloudPanel) |
| `HOST` | `0.0.0.0` | Gebruik `127.0.0.1` in productie |
| `ALLOWED_ORIGINS` | *(leeg)* | Komma-gescheiden, bijv. `https://games.tkriek.dev`. Leeg = alleen dezelfde host |
| `MAX_ROOMS` | `500` | Max. kamers tegelijk |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug` |
| `MAX_CONN_PER_IP` | `24` | Gelijktijdige verbindingen per IP |
| `MAX_ROOMS_PER_IP` | `8` | Open kamers per IP |
| `TRUST_PROXY` | `loopback` | `CF-Connecting-IP`/`X-Forwarded-For` alleen vertrouwen als het verzoek van 127.0.0.1 komt |

Op de server staan ze in `.env` (gemaakt door het setup-script, niet in git). Zie ook
[`.env.example`](.env.example). Lokaal kun je ook een `.env` maken; Node leest die zelf in.

---

## Troubleshooting

**WebSocket verbindt niet** (overlay blijft op "Opnieuw verbinden…")
- Browserconsole: `403` bij `/ws` → `ALLOWED_ORIGINS` klopt niet (exact, met `https://`, zonder `/` aan het eind).
- `404` bij `/ws` → de `location = /ws`-regels staan niet in de Vhost of er is een tikfout.
- Cloudflare *Network → WebSockets* moet aan staan.
- `429` → te veel verbindingen vanaf één IP (bijv. een klas op school achter één IP): verhoog `MAX_CONN_PER_IP`.

**502 Bad Gateway**
- De app draait niet: `pm2 status`, `pm2 logs timons-arcade`.
- Poort klopt niet: `PORT` in `ecosystem.config.cjs` moet gelijk zijn aan de App Port in CloudPanel.
- `HOST=127.0.0.1` en nginx proxyt naar `localhost` dat naar `::1` (IPv6) resolvet → gebruik `127.0.0.1` in de Vhost.

**Verbinding valt na ± 100 seconden weg**
- Cloudflare sluit stille WebSockets na ± 100 s. De server pingt elke 25 s; gebeurt het toch,
  controleer dan `proxy_read_timeout` in de `/ws`-location en of er geen tweede proxy tussen zit.

**Mixed content / `ws://` geblokkeerd**
- De client kiest automatisch `wss://` op een https-pagina. Zie je toch `ws://`-fouten, dan wordt de pagina
  via http geserveerd: zet in Cloudflare *Always Use HTTPS* aan en controleer de SSL-modus (Full strict).

**"Er is een nieuwe versie" blijft komen / oude bestanden**
- Er staat nog een `expires max`-blok voor `.js`/`.css` in de Vhost: verwijder het (zie stap 5).
- Cloudflare *Browser Cache TTL* op *Respect Existing Headers* zetten en eventueel *Purge Everything*.

**Console-errors over Content-Security-Policy**
- Rocket Loader, Email Obfuscation of Cloudflare Web Analytics injecteren scripts. Zet ze uit (stap 2).

**Spelers komen van hetzelfde IP en worden geweigerd**
- Verhoog `MAX_CONN_PER_IP` / `MAX_ROOMS_PER_IP` in `ecosystem.config.cjs` en deploy opnieuw.

**IP-adressen in de logs zijn van Cloudflare**
- De app vertrouwt `CF-Connecting-IP` alleen van nginx op dezelfde machine. Wie je origin-IP kent, kan
  nginx rechtstreeks aanspreken en die header vervalsen. Beperk poort 80/443 in de CloudPanel-firewall
  (of Hetzner Cloud Firewall) tot de [Cloudflare IP-ranges](https://www.cloudflare.com/ips/).

---

## Afspraken

Zie [`CLAUDE.md`](CLAUDE.md) voor code-conventies. Kort: comments in het Engels, UI-teksten in het Nederlands,
geen externe CDN's of assets, geen auteursrechtelijk materiaal (eigen namen, eigen pixel art, eigen geluiden).
