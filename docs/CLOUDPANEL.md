# Timon's Arcade draaien op CloudPanel

Stappenplan om de arcade live te zetten als **Node.js-site in CloudPanel**, achter **Cloudflare**.
Reken op ± 30 minuten de eerste keer. Daarna is updaten één commando.

Het meeste werk doet [`deploy/cloudpanel-setup.sh`](../deploy/cloudpanel-setup.sh): Node controleren,
code ophalen, `.env` schrijven, `npm ci`, pm2 starten, opstarten na een reboot regelen en de
nginx-regels voor je klaarzetten.

## Hoe het in elkaar zit

```
Speler ──https/wss──▶ Cloudflare ──▶ nginx van CloudPanel (:443) ──▶ Node-app op 127.0.0.1:3000
                                         ├─ /      → bestanden + /healthz
                                         └─ /ws    → WebSocket (Upgrade-headers)
```

- De Node-app serveert zelf de website én de WebSockets op één poort.
- nginx (door CloudPanel beheerd) doet SSL en stuurt alles door naar de app.
- pm2 houdt de app draaiende en start hem opnieuw na een crash of reboot.
- Kamers staan in het geheugen van de app: **één instance**, geen cluster.

## Wat je nodig hebt

- Een VPS met **CloudPanel v2** (bijv. Hetzner), Ubuntu of Debian.
- Een domein in **Cloudflare**, bijvoorbeeld `games.tkriek.dev`.
- SSH op je eigen computer (Linux/macOS, of op Windows: WSL of de ingebouwde OpenSSH).
- De code op GitHub: `TKriek05/browsergames` (zie [SETUP.md](SETUP.md)).

In de voorbeelden: domein `games.tkriek.dev`, site-user `tkriek-games`, App Port `3000`.
Vervang die door je eigen waarden.

---

## Stap 1 – DNS in Cloudflare

*Cloudflare → je domein → DNS → Add record*

| Type | Naam | Inhoud | Proxy |
|---|---|---|---|
| A | `games` | IP-adres van je VPS | **Proxied** (oranje wolk) |

Zet ook alvast: *SSL/TLS → Overview* op **Full** (in stap 6 gaat hij naar Full (strict)).

## Stap 2 – Node.js-site aanmaken in CloudPanel

**Via de interface:** *Sites → + Add Site → Create a Node.js Site*

| Veld | Waarde |
|---|---|
| Domain Name | `games.tkriek.dev` |
| Node.js Version | 22 of nieuwer (LTS) |
| App Port | `3000` (moet uniek zijn op de server als je meer Node-sites hebt) |
| Site User | `tkriek-games` |
| Site User Password | een sterk wachtwoord (bewaar het in je wachtwoordmanager) |

**Of via de terminal** (als root op de server):

```bash
clpctl site:add:nodejs --domainName=games.tkriek.dev --nodejsVersion=22 --appPort=3000 \
  --siteUser=tkriek-games --siteUserPassword='KIES-EEN-STERK-WACHTWOORD'
```

CloudPanel maakt de map `/home/tkriek-games/htdocs/games.tkriek.dev` en een nginx-vhost
die doorstuurt naar poort 3000.

## Stap 3 – Inloggen met een SSH-key

Op je eigen computer:

```bash
ssh-keygen -t ed25519 -C "timon@laptop"          # alleen als je nog geen key hebt
ssh-copy-id tkriek-games@<IP-VAN-JE-VPS>          # vraagt één keer het site-user-wachtwoord
ssh tkriek-games@<IP-VAN-JE-VPS>                  # moet nu zonder wachtwoord lukken
```

Geen `ssh-copy-id` (Windows)? Plak de inhoud van `~/.ssh/id_ed25519.pub` in CloudPanel:
*Sites → games.tkriek.dev → SSH/FTP → SSH Keys → Add Key*.

> Gebruik het **echte IP-adres** van je VPS. Cloudflare's proxy stuurt alleen websiteverkeer door,
> geen SSH.

## Stap 4 – Het setup-script draaien

Kies één route en blijf daarbij.

### Route A (aanbevolen): git op de server

De server haalt de code zelf van GitHub. Werkt ook vanaf Windows, want je hebt geen rsync nodig.

Vanuit je lokale map met de repo:

```bash
ssh tkriek-games@<IP> 'bash -s -- --domain games.tkriek.dev --port 3000 --branch main' < deploy/cloudpanel-setup.sh
```

- **Publieke repo:** dit werkt meteen.
- **Privé-repo:** voeg `--repo git@github.com:TKriek05/browsergames.git` toe. De eerste keer maakt het
  script een sleutel aan en toont hem. Zet die op GitHub (*repo → Settings → Deploy keys →
  Add deploy key*, alleen lezen) en draai het commando opnieuw.
- `--branch main` gaat ervan uit dat je `main` hebt aangemaakt (zie [SETUP.md](SETUP.md), stap 2).

### Route B: code uploaden met rsync vanaf je computer

Handig als je vanaf je eigen computer wilt deployen zonder eerst te pushen. Je hebt rsync nodig
(Linux, macOS of WSL).

1. Zet bovenin [`deploy/deploy.sh`](../deploy/deploy.sh) je IP, site-user, pad en URL.
2. Code uploaden en daarna het setup-script zonder git:

```bash
./deploy/deploy.sh --no-tests
ssh tkriek-games@<IP> 'bash -s -- --domain games.tkriek.dev --port 3000 --no-git' < deploy/cloudpanel-setup.sh
```

### Wat het script doet

1. Controleert Node.js (≥ 22). Installeert zo nodig nvm + Node voor de site-user.
2. Haalt de code op (route A) of controleert of hij er staat (route B).
3. Schrijft **`.env`** met je instellingen, alleen de eerste keer. Een update overschrijft hem nooit.
4. `npm ci --omit=dev` (alleen de dependency `ws`).
5. Start de app met **pm2** (`pm2 startOrReload`) en slaat de proceslijst op.
6. Zet een **`@reboot`-regel in de crontab** van de site-user. Dan start pm2 weer na een reboot,
   zonder root. De cron-interface van CloudPanel kan geen `@reboot`, dus het script doet dit via `crontab`.
7. Test `http://127.0.0.1:3000/healthz`.
8. Zet de nginx-regels met jouw domein klaar in `~/arcade-vhost-snippet.conf`.

Het script mag je altijd opnieuw draaien. Dat is meteen je update-commando.

## Stap 5 – De Vhost aanpassen (WebSockets)

*Sites → games.tkriek.dev → Vhost*

1. Toon de klaargezette regels op de server: `cat ~/arcade-vhost-snippet.conf`.
2. Vervang in de Vhost-editor het bestaande blok `location / { … }` door die inhoud.
3. Staat er een blok voor statische bestanden, zoiets als
   `location ~* ^.+\.(css|js|jpg|…)$ { … expires max; … }`? **Verwijder dat.**
   Onze bestanden staan in `public/`, niet in de site-root, en `expires max` zou nieuwe versies
   blokkeren.
4. *Save*. CloudPanel controleert de nginx-syntax en zet de oude versie terug als er iets mis is.
   Geeft hij een fout over `gzip`? Dan staat gzip al in de globale instellingen: haal de
   `gzip…`-regels uit de snippet.

De snippet regelt: `/ws` met `Upgrade`/`Connection`-headers en lange timeouts, gzip,
security headers + CSP (zonder dubbele headers van Node) en geen extra caching.

## Stap 6 – SSL

1. CloudPanel: *Sites → games.tkriek.dev → SSL/TLS → Actions → New Let's Encrypt Certificate*.
   Dit lukt terwijl Cloudflare op **Full** staat (stap 1).
2. Daarna Cloudflare *SSL/TLS → Overview* op **Full (strict)**.
3. Cloudflare *SSL/TLS → Edge Certificates*: **Always Use HTTPS** aan.

Alternatief voor stap 1: een *Cloudflare Origin Certificate* (15 jaar geldig) maken en in CloudPanel
importeren via *Import Certificate*.

## Stap 7 – Beveiliging en Cloudflare-instellingen

In **CloudPanel**:

- *Sites → games.tkriek.dev → Security* → **Allow traffic from Cloudflare only** aan. Dan kan niemand
  Cloudflare omzeilen door je server-IP direct aan te spreken. Let op: bij sommige CloudPanel-versies
  geldt dit alleen voor poort 443, niet voor 80 ([issue #671](https://github.com/cloudpanel-io/cloudpanel-ce/issues/671)).
  Omdat http toch naar https doorverwijst is dat geen groot risico, maar goed om te weten.
- *Admin → Security*: zet het CloudPanel-beheer (poort 8443) open voor alleen je eigen IP,
  of gebruik Basic Auth.

In **Cloudflare**:

| Waar | Instelling | Waarom |
|---|---|---|
| Network | **WebSockets aan** | Staat standaard aan; zonder werkt multiplayer niet |
| Speed → Optimization | **Rocket Loader uit** | Breekt ES modules |
| Scrape Shield | **Email Address Obfuscation uit** | Voegt een script toe dat de CSP blokkeert |
| Analytics → Web Analytics | automatisch injecteren **uit** | Zelfde reden (en: geen tracking) |
| Caching → Configuration | Browser Cache TTL: **Respect Existing Headers** | De app bepaalt zelf wat gecachet wordt |

## Stap 8 – Testen

```bash
curl -s https://games.tkriek.dev/healthz        # {"status":"ok",…}
```

1. Open `https://games.tkriek.dev`, kies een bijnaam en klik **Maak kamer**.
2. Open de link op je telefoon (4G, niet je wifi) en doe mee.
3. Start een potje en ververs één keer de pagina: je moet terugkomen op je plek.
4. Open de browserconsole (F12): geen rode fouten.

---

## Dagelijks gebruik

| Wat | Commando (als site-user op de server, tenzij anders vermeld) |
|---|---|
| Updaten, route A | `ssh tkriek-games@<IP> 'bash ~/htdocs/games.tkriek.dev/deploy/cloudpanel-setup.sh --domain games.tkriek.dev --branch main'` |
| Updaten, route B | `./deploy/deploy.sh` (op je eigen computer) |
| Status | `pm2 status` |
| Live logs | `pm2 logs timons-arcade` |
| Laatste fouten | `tail -n 100 ~/htdocs/games.tkriek.dev/logs/error.log` |
| Herstarten | `pm2 reload timons-arcade` |
| Instellingen wijzigen | `nano ~/htdocs/games.tkriek.dev/.env`, daarna `pm2 reload timons-arcade` |
| CPU/geheugen live | `pm2 monit` |

Een update of herstart beëindigt lopende potjes, want kamers staan in het geheugen. Spelers zien
"De server wordt herstart" en daarna "Kamer niet gevonden". Deploy dus als er niet gespeeld wordt:
`curl -s https://games.tkriek.dev/healthz` laat het aantal kamers en spelers zien.

**Backups:** de app heeft geen database. Het enige dat alleen op de server staat is `.env`.
Bewaar die waarden in je wachtwoordmanager.

## Instellingen (`.env`)

Het script maakt dit bestand. Alle opties staan in [`.env.example`](../.env.example).

```ini
PORT=3000                                  # = App Port in CloudPanel
HOST=127.0.0.1                             # alleen bereikbaar via nginx
ALLOWED_ORIGINS=https://games.tkriek.dev   # exact, zonder / aan het eind
MAX_ROOMS=500
LOG_LEVEL=info
TRUST_PROXY=loopback                       # CF-Connecting-IP alleen via nginx vertrouwen
MAX_CONN_PER_IP=24                         # verhogen voor een klas achter één IP
MAX_ROOMS_PER_IP=8
```

Poort wijzigen? Pas zowel `PORT` in `.env` aan als de **App Port** in CloudPanel
(*Sites → games.tkriek.dev → Settings*), en reload.

## Als het niet werkt

| Symptoom | Oorzaak en oplossing |
|---|---|
| **502 Bad Gateway** | App draait niet of op een andere poort: `pm2 status`, `pm2 logs timons-arcade`, vergelijk `PORT` in `.env` met de App Port |
| Blijft hangen op "Opnieuw verbinden…" | `/ws`-blok ontbreekt in de Vhost (stap 5) of WebSockets staan uit in Cloudflare |
| WebSocket geeft **403** | `ALLOWED_ORIGINS` klopt niet: exact `https://games.tkriek.dev` |
| WebSocket geeft **429** | Te veel verbindingen vanaf één IP: verhoog `MAX_CONN_PER_IP` |
| Na een reboot is de site weg | `crontab -l` moet de `@reboot`-regel tonen; kijk in `~/.arcade-boot.log`. Handmatig: `pm2 resurrect` |
| `npm: command not found` via SSH | nvm wordt niet geladen: draai het setup-script opnieuw; dat laadt nvm zelf |
| Oude versie blijft zichtbaar | `expires max`-blok in de Vhost verwijderen, in Cloudflare *Purge Everything* |
| Rode CSP-fouten in de console | Rocket Loader / Email Obfuscation / Web Analytics uitzetten (stap 7) |

Meer oplossingen: [README → Troubleshooting](../README.md#troubleshooting).

## Checklist

- [ ] DNS-record `games` → VPS-IP, oranje wolk
- [ ] Node.js-site in CloudPanel, App Port 3000
- [ ] Inloggen met SSH-key werkt
- [ ] `cloudpanel-setup.sh` gedraaid: health check groen
- [ ] Vhost: `location /` vervangen, `/ws` erin, statische-bestanden-blok weg
- [ ] Let's Encrypt-certificaat, Cloudflare op Full (strict), Always Use HTTPS
- [ ] Allow traffic from Cloudflare only aan; CloudPanel-beheer afgeschermd
- [ ] Rocket Loader, Email Obfuscation en Web Analytics-injectie uit
- [ ] Getest met twee apparaten, pagina verversen tijdens een potje werkt
