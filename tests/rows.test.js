// The row `scan` writes for a code in view, which `ffrwd/rsqr` writes byte for
// byte the same, the order a frame's codes are written in, and which sighting
// each belongs to.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GAP, payloads, row, Sightings } from '../src/detect.js';

const found = (texts) => texts.map((text) => ({ text, box: { x: 0, y: 0, w: 1, h: 1 } }));

test('a row writes a whole second without a fraction', () => {
  assert.equal(row(1, 'ffrwd'), '{"start_t":1,"text":"ffrwd"}');
  assert.equal(row(0, 'ffrwd'), '{"start_t":0,"text":"ffrwd"}');
});

test('a row keeps every digit of a time that needs them', () => {
  assert.equal(row(1.9666666666666663, 'a'), '{"start_t":1.9666666666666663,"text":"a"}');
});

test('a payload with JSON in it is escaped into the row', () => {
  assert.equal(row(0, 'he said "hi"\n'), String.raw`{"start_t":0,"text":"he said \"hi\"\n"}`);
});

test('a frame names each payload once, in sorted order', () => {
  assert.deepEqual(payloads(found(['right', 'left', 'right'])), ['left', 'right']);
});

test('payloads sort by UTF-16 code unit, as rsqr sorts them', () => {
  assert.deepEqual(payloads(found(['\u{FF5E}', '\u{1F600}'])), ['\u{1F600}', '\u{FF5E}']);
});

test('a frame with no code names nothing', () => {
  assert.deepEqual(payloads([]), []);
});

// The start, in frames, each sighting of one payload is named by over the
// frames `seen` lists, frame k at k / 30 s.
function starts(count, seen) {
  const sightings = new Sightings();
  const named = [];
  for (let k = 0; k < count; k++) {
    sightings.tick(k / 30);
    if (seen.includes(k)) named.push(Math.round(sightings.see('a') * 30));
  }
  return named;
}

test('a sighting is named by its first frame while it lasts', () => {
  assert.deepEqual(starts(8, [2, 3, 4, 5]), [2, 2, 2, 2]);
});

test('a gap of GAP frames is still the same sighting', () => {
  assert.equal(GAP, 14);
  assert.deepEqual(starts(40, [5, 20]), [5, 5]);
});

test('a longer gap starts a new sighting', () => {
  assert.deepEqual(starts(40, [5, 21]), [5, 21]);
});

test('two payloads have sightings of their own', () => {
  const sightings = new Sightings();
  sightings.tick(0);
  assert.equal(sightings.see('a'), 0);
  sightings.tick(1);
  assert.equal(sightings.see('a'), 0);
  assert.equal(sightings.see('b'), 1);
});
