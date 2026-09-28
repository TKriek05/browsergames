# Plan: Timon's Arcade in je GitHub-repo zetten en houden

Dit is het stappenplan om de code in `github.com/TKriek05/browsergames` te krijgen, er
netjes mee te werken en hem daarna op de server te zetten. Het live zetten op CloudPanel staat
stap voor stap in [CLOUDPANEL.md](CLOUDPANEL.md).

---

## Stap 1 – De code in de repo krijgen (kies één route)

### Route A (aanbevolen): Claude laten pushen

Dit is inmiddels gebeurd: de branch `claude/ecstatic-carson-tmelbl` staat op GitHub. Krijgt Claude
later toch `403 Resource not accessible by integration`, dan mist de Claude GitHub App schrijfrechten:

1. Ga naar <https://github.com/apps/claude/installations/select_target> en kies je account `TKriek05`.
2. Kies *Only select repositories* → `browsergames` (of *All repositories*) en sla op.
   Controleer dat de app **Contents: Read and write** en **Pull requests: Read and write** krijgt.
3. Koppel je GitHub-account (opnieuw) op <https://claude.ai/connect-github>.
4. Zeg in de sessie: *"push het"*. Claude pusht dan de branch `claude/ecstatic-carson-tmelbl`.

### Route B: zelf pushen met de git-bundle (volledige geschiedenis)

Je hebt `browsergames-faseN.bundle` gekregen. Daarin zitten alle commits.

```bash
git clone -b claude/ecstatic-carson-tmelbl browsergames-fase1.bundle browsergames
cd browsergames
git remote set-url origin https://github.com/TKriek05/browsergames.git

# De repo is nog leeg: maak van deze geschiedenis meteen je main-branch
git push -u origin claude/ecstatic-carson-tmelbl:main

# (of eerst als eigen branch, en via een pull request naar main:)
# git push -u origin claude/ecstatic-carson-tmelbl
```

### Route C: zelf uploaden met de zip (zonder geschiedenis)

```bash
unzip browsergames-fase1.zip && cd browsergames
git init -b main
git add .
git commit -m "Timon's Arcade: fase 0 en 1"
git remote add origin https://github.com/TKriek05/browsergames.git
git push -u origin main
```

Via de website kan ook (*Add file → Upload files*, map erin slepen), maar dan gaan
lege mappen en de uitvoerbaarheid van `deploy/deploy.sh` verloren. Gebruik liever de terminal.

---

## Stap 2 – De repo inrichten (eenmalig, ± 10 minuten)

1. **Default branch:** `main` (*Settings → General*).
2. **Branch protection** op `main` (*Settings → Branches → Add rule*):
   - *Require a pull request before merging*
   - *Require status checks to pass* → kies de check **Tests** (verschijnt na de eerste run).
3. **Actions aan laten staan.** `.github/workflows/test.yml` draait bij elke push en pull request
   `npm ci` + `npm test` op Node 22 en 24. Niets geheims nodig.
4. **Beschrijving + topics** (optioneel): "Multiplayer browser-arcade, vanilla JS + Node + ws".
5. **Zichtbaarheid:** privé of publiek. Er staan geen geheimen in de repo (`.env` staat in `.gitignore`).
   Publiek maken past bij een portfolio, en je README laat meteen zien hoe het werkt.

## Stap 3 – Werken met branches (per fase)

```
main                    altijd deploybaar
└─ fase-1-bordspellen   werk aan één fase of game
   └─ pull request → checks groen → merge → deploy
```

```bash
git switch main && git pull
git switch -c fase-2-eenden
# ... werken, testen ...
npm test
git add -A && git commit -m "Kwek Kwek Knal: eenden en hondje"
git push -u origin fase-2-eenden     # daarna pull request openen op GitHub
```

Commit-berichten in het Nederlands of Engels, als ze maar zeggen *wat* en *waarom*.

## Stap 4 – Lokaal draaien vanuit de repo

```bash
git clone https://github.com/TKriek05/browsergames.git
cd browsergames
npm install
npm run dev          # http://localhost:3000
npm test
```

Node 22 of nieuwer is nodig (`node -v`). Met nvm: `nvm install 22 && nvm use 22`.

## Stap 5 – Van repo naar server

Zie **[CLOUDPANEL.md](CLOUDPANEL.md)**. Kort: één keer `deploy/cloudpanel-setup.sh` draaien.

- **Route A (aanbevolen):** de server haalt de code met git van GitHub. Updaten = het setup-script
  opnieuw draaien. Voor een privé-repo maakt het script een *deploy key* aan (alleen lezen).
- **Route B:** `./deploy/deploy.sh` uploadt de code met rsync vanaf je eigen computer.

**Later (optioneel): automatisch deployen met GitHub Actions** na een merge naar `main`.
Dat vraagt een SSH-key als repository secret. Pas doen als het handmatige deployen goed loopt.

## Checklist

- [ ] Code staat op GitHub (route A, B of C)
- [ ] `main` is de default branch, met branch protection
- [ ] De eerste *Tests*-run in het tabblad *Actions* is groen
- [ ] Lokaal: `npm install && npm test` werkt
- [ ] Server: [CLOUDPANEL.md](CLOUDPANEL.md) doorlopen, `https://games.tkriek.dev/healthz` geeft `"status":"ok"`
