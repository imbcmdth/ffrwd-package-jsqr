// The row `scan` writes for a code in view, which `ffrwd/rsqr` writes byte for
// byte the same, the order a frame's codes are written in, and which sighting
// each belongs to.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GAP, payloads, row, Sightings } from '../src/detect.js';

const found = (texts) => texts.map((text) => ({ text, box: { x: 0, y: 0, w: 1, h: 1 } }));

test('a row writes a whole second without a fraction', () => {
  assert.equal(row({ startT: 1, id: 3 }, 'ffrwd'), '{"start_t":1,"id":3,"text":"ffrwd"}');
  assert.equal(row({ startT: 0, id: 3 }, 'ffrwd'), '{"start_t":0,"id":3,"text":"ffrwd"}');
});

test('a row keeps every digit of a time that needs them', () => {
  assert.equal(
    row({ startT: 1.9666666666666663, id: 3 }, 'a'),
    '{"start_t":1.9666666666666663,"id":3,"text":"a"}',
  );
});

test('a payload with JSON in it is escaped into the row', () => {
  assert.equal(
    row({ startT: 0, id: 3 }, 'he said "hi"\n'),
    String.raw`{"start_t":0,"id":3,"text":"he said \"hi\"\n"}`,
  );
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

// The sighting one payload is named by on each frame `seen` lists, frame k
// at k / 30 s, as [start frame, id].
function named(count, seen) {
  const sightings = new Sightings();
  const names = [];
  for (let k = 0; k < count; k++) {
    sightings.tick(k / 30);
    if (seen.includes(k)) {
      const { startT, id } = sightings.see('a');
      names.push([Math.round(startT * 30), id]);
    }
  }
  return names;
}

test('a sighting is named by its first frame while it lasts', () => {
  assert.deepEqual(named(8, [2, 3, 4, 5]), [
    [2, 0],
    [2, 0],
    [2, 0],
    [2, 0],
  ]);
});

test('a gap of GAP frames is still the same sighting', () => {
  assert.equal(GAP, 14);
  assert.deepEqual(named(40, [5, 20]), [
    [5, 0],
    [5, 0],
  ]);
});

test('a longer gap starts a new sighting, with a new id', () => {
  assert.deepEqual(named(40, [5, 21]), [
    [5, 0],
    [21, 1],
  ]);
});

test('two payloads have sightings of their own', () => {
  const sightings = new Sightings();
  sightings.tick(0);
  assert.deepEqual(sightings.see('a'), { startT: 0, id: 0 });
  sightings.tick(1);
  assert.deepEqual(sightings.see('a'), { startT: 0, id: 0 });
  assert.deepEqual(sightings.see('b'), { startT: 1, id: 1 });
});

test('two payloads first seen together are told apart by id', () => {
  const sightings = new Sightings();
  sightings.tick(0);
  assert.deepEqual(
    ['a', 'b'].map((text) => sightings.see(text)),
    [
      { startT: 0, id: 0 },
      { startT: 0, id: 1 },
    ],
  );
});
