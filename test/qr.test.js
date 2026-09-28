// Structural checks for the self-written QR generator. (It was also verified
// end-to-end with an independent decoder during development.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQr } from '../public/js/core/qr.js';

function hasFinder(qr, x0, y0) {
  for (let dy = 0; dy < 7; dy++) {
    for (let dx = 0; dx < 7; dx++) {
      const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      if (qr.modules[y0 + dy][x0 + dx] !== (d !== 2)) return false;
    }
  }
  return true;
}

// Read the 15 format bits next to the top-left finder and check the BCH code.
function formatBitsValid(qr) {
  const m = qr.modules;
  let bits = 0;
  const seq = [];
  for (let i = 0; i <= 5; i++) seq.push(m[i][8]);
  seq.push(m[7][8], m[8][8], m[8][7]);
  for (let i = 9; i < 15; i++) seq.push(m[8][14 - i]);
  seq.forEach((b, i) => { if (b) bits |= 1 << i; });
  const raw = bits ^ 0x5412;
  let rem = raw >>> 10;
  const data = rem;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | (rem & 0x3ff)) === raw && (data >>> 3) === 0; // level M
}

test('QR: picks the smallest version and draws finder patterns', () => {
  const qr = createQr('https://games.tkriek.dev/?room=KXQF');
  assert.equal(qr.size, 29, 'version 3');
  assert.ok(hasFinder(qr, 0, 0));
  assert.ok(hasFinder(qr, qr.size - 7, 0));
  assert.ok(hasFinder(qr, 0, qr.size - 7));
  assert.ok(qr.modules[qr.size - 8][8], 'dark module');
  assert.ok(formatBitsValid(qr));
});

test('QR: larger payloads grow the version, too large throws', () => {
  assert.equal(createQr('x'.repeat(100)).size, 6 * 4 + 17, 'version 6 holds 106 bytes at level M');
  assert.throws(() => createQr('x'.repeat(400)));
});
