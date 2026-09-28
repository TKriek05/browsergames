# Timon's Arcade

Multiplayer browsergames voor **2 t/m 6 spelers** met een simpele kamercode.
Eén Node.js-app serveert de frontend én de WebSockets. Geen framework, geen
build-stap, geen database, geen accounts, geen tracking.

- **Frontend:** vanilla JavaScript (ES modules), HTML, CSS, Canvas
- **Backend:** Node.js (LTS, ≥ 20.12) met precies één dependency: [`ws`](https://github.com/websockets/ws)
- **Status:** Fase 0 klaar (netwerkfundament + lobby + demo-game *Neon Tikkertje*).

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
4. **Reconnect testen:** ververs een tabblad tijdens het spel → je komt terug op je plek.
   Sluit een tabblad → na 60 s neemt een bot je plek over.

### Automatische tests

```bash
npm test                                   # node --test: regels, protocol, server-integratie
npm run bots                               # 6 nep-clients, 1 kamer, 20 s (server moet draaien)
node tools/botclients.js --chaos           # + wegvallen/terugkomen, host vertrekt, rommel sturen, kamer overvol
node tools/botclients.js --rooms 8 --duration 60
```

Veel kamers vanaf één IP? Start de server dan met ruimere limieten:
`MAX_CONN_PER_IP=500 MAX_ROOMS_PER_IP=100 ROOMS_PER_MINUTE=500 CONNECTS_PER_MINUTE=2000 npm start`.

---

## Projectstructuur

```
server/            http (statische bestanden + /healthz) en WebSocket, kamers, protocol, rate limiting
  games/           server-kant per game (tag.js = Neon Tikkertje)
shared/            code die client én server gebruiken (pure ES modules)
  physics/ maps/ rules/  fysica, levels als data, bordspelregels
public/            alles wat de browser krijgt
  js/core/         net, session, input, touch, audio, storage, loop, canvas, interp, predict, qr, ui, pixelfont
  js/lobby.js      gedeelde lobby
  js/hub.js        startpagina + wisselen tussen hub/lobby/spel
  games/<id>/      client-kant per game
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

### Een game toevoegen

1. Limiet in `shared/constants.js` (`GAME_LIMITS`) en tekst + instellingen in `shared/catalog.js` (`available: true`).
2. Server: `server/games/<id>.js` met `create(room, settings)` → `onJoin`, `onLeave`, `onInput`, `tick`, `snapshot`
   (zie de uitleg bovenin `server/games/index.js`) en registreer hem daar.
3. Client: `public/games/<id>/client.js` met `meta` en `createGame()` → `mount`, `onSnapshot`, `render`, `unmount`
   (zie `public/js/core/gamehost.js`).

---

## Deployen: Node.js-site in CloudPanel achter Cloudflare

Voorbeeld: `games.tkriek.dev`, site-user `tkriek-games`, App Port `3000`. Pas namen aan naar jouw situatie.

### 1. Node.js-site aanmaken in CloudPanel

*Sites → Add Site → Create a Node.js Site*
- **Domain:** `games.tkriek.dev`
- **Node.js version:** de nieuwste LTS (22 of hoger)
- **App Port:** `3000` (moet uniek zijn op de server)
- **Site User:** `tkriek-games` (+ sterk wachtwoord)

De code komt in `/home/tkriek-games/htdocs/games.tkriek.dev`.

### 2. DNS in Cloudflare

- A-record `games` → IP van je VPS, **Proxied (oranje wolk)**.
- WebSockets staan in Cloudflare standaard aan (*Network → WebSockets*). Controleer het even.
- Zet uit (*Speed → Optimization* en *Scrape Shield*): **Rocket Loader**, **Email Address Obfuscation**
  en automatisch geïnjecteerde **Web Analytics**. Die voegen scripts toe die de CSP blokkeert
  (console-errors) en Rocket Loader breekt ES modules.
- *Caching → Configuration → Browser Cache TTL:* **Respect Existing Headers**.

### 3. SSL

1. Cloudflare *SSL/TLS → Overview*: tijdelijk **Full**.
2. CloudPanel: *Site → SSL/TLS → Actions → New Let's Encrypt Certificate*.
3. Daarna Cloudflare op **Full (strict)**.

Alternatief: een *Cloudflare Origin Certificate* maken en in CloudPanel importeren (*Import Certificate*).

### 4. SSH-key voor de site-user

Op je eigen computer:

```bash
ssh-keygen -t ed25519 -C "deploy games.tkriek.dev"     # als je nog geen key hebt
ssh-copy-id -p 22 tkriek-games@<IP-van-je-VPS>
ssh tkriek-games@<IP-van-je-VPS>                        # moet zonder wachtwoord werken
```

Gebruik het **echte IP** (of een DNS-only record): SSH gaat niet door de Cloudflare-proxy.
In CloudPanel kun je keys ook toevoegen via *Site → SSH/FTP → SSH Keys*.

### 5. Vhost aanpassen (nginx)

*Site → Vhost*: vervang het `location / { … }`-blok door de inhoud van
[`deploy/nginx-snippet.conf`](deploy/nginx-snippet.conf) en vervang `games.tkriek.dev` door je domein.
Lees de opmerkingen bovenin het bestand: staat er een blok voor statische bestanden
(`location ~* ^.+\.(css|js|…)$ { expires max; … }`), verwijder dat.

**Wat CloudPanel waarschijnlijk al zelf regelt** (controleer het in jouw Vhost, templates verschillen per versie):
- de redirect van http naar https en de SSL-certificaatregels;
- `proxy_pass` naar `127.0.0.1:{{app_port}}` met `Upgrade`/`Connection`-headers en lange timeouts
  in het standaard Node.js-template (onze snippet vervangt dat blok netjes);
- een `include` met globale instellingen; staat daar al `gzip on;`, haal dan de gzip-regels uit de
  snippet weg (dubbel `gzip on` geeft een nginx-fout bij het opslaan);
- eventueel eigen `add_header`-regels. Let op: nginx neemt `add_header` van het server-niveau
  niet over in een `location` die zelf `add_header` gebruikt.

### 6. Productie-instellingen

Open `deploy/ecosystem.config.cjs` en controleer `PORT` (= App Port), `ALLOWED_ORIGINS` en `HOST`
(`127.0.0.1`, zodat de app alleen via nginx bereikbaar is). Zet ook bovenin
`deploy/deploy.sh` je IP, site-user, pad en URL.

### 7. Eerste deploy

```bash
./deploy/deploy.sh
```

Het script draait de tests, synchroniseert de bestanden met `rsync --delete`
(zonder `.git`, `node_modules`, `tools/`, `test/`, README en CLAUDE.md; van `deploy/` gaat alleen
de pm2-config mee), schrijft een nieuwe build-id, draait `npm ci --omit=dev`, installeert pm2 als
dat nog niet bestaat, start/herlaadt de app en controleert `/healthz`.

### 8. pm2 laten opstarten na een reboot

Als root (eenmalig):

```bash
pm2 startup systemd -u tkriek-games --hp /home/tkriek-games
```

Dat print een commando dat je als root uitvoert. Daarna als site-user `pm2 save`.
Geen root? Voeg in CloudPanel (*Site → Cron Jobs*) toe: `@reboot` met
`bash -lc 'pm2 resurrect'`.

Liever systemd zonder pm2? Zie het voorbeeld in [`deploy/timons-arcade.service`](deploy/timons-arcade.service).

### 9. Logs bekijken

```bash
ssh tkriek-games@<IP>
pm2 logs timons-arcade            # live
pm2 logs timons-arcade --lines 200
tail -f ~/htdocs/games.tkriek.dev/logs/error.log
curl -s https://games.tkriek.dev/healthz
```

Elke minuut logt de server de tick-duur (`tick stats`) als er gespeeld wordt; boven 10 ms wordt het een waarschuwing.

### 10. Updaten

```bash
git pull   # of je eigen wijzigingen committen
./deploy/deploy.sh
```

Spelers met een oude pagina zien een melding *"Er is een nieuwe versie – Ververs"*.
Let op: kamers staan in het geheugen. **Een deploy of herstart beëindigt lopende potjes.**
Clients zien dan netjes *"De server wordt herstart"* en daarna *"Kamer niet gevonden"*.

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

Zie ook [`.env.example`](.env.example). Lokaal kun je een `.env` maken; Node leest die zelf in.

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
