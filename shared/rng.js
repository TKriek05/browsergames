// Small seeded random generator (mulberry32). The server uses it for dice so
// tests can replay exact games; pass Math.random-like functions around as `rng`.
export function createRng(seed = (Math.random() * 2 ** 32) >>> 0) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer in [min, max].
export function rollInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}
