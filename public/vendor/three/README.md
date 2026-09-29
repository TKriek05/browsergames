# three.js (vendored)

- Versie: **0.186.1** (npm-pakket `three`), licentie MIT (zie `LICENSE`).
- Bestanden: `three.module.js` en `three.core.js` uit `build/`, eenmalig geminificeerd met
  `esbuild --minify --format=esm --legal-comments=inline` (inhoud verder ongewijzigd; `three.module.js` importeert `./three.core.js`).
- Alleen gebruikt door `public/js/gl/renderer.js`. De server serveert ze gzip'd (± 200 kB samen).

Bijwerken: nieuwe versie uit npm halen, dezelfde twee bestanden minifiëren en hier vervangen, dan alle 3D-games nalopen
(Tank Tumult, Turbo Kart GP, Boemstad, Minigolf, Spetterveld, Pinguïnbotsen).
