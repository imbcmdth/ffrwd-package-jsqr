// Detection against codes made here: a QR encoder writes the matrix,
// paint.js paints it into rgba pixels, and the module's own core reads it
// back. No binary fixture, and the round trip is what proves the decoder runs.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DetectionCache, detectCodes, mosaicBox } from '../src/detect.js';
import { Instance } from '../src/instance.js';
import { paste, QUIET, render, SCALE, white } from './paint.js';

test('a rendered code decodes back to its own payload', () => {
  const code = render('ffrwd');
  const found = detectCodes(code.rgba, code.width, code.height);
  assert.equal(found.length, 1);
  assert.equal(found[0].text, 'ffrwd');
});

test('the frame handed to the decoder is not written to', () => {
  const code = render('ffrwd');
  const before = code.rgba.slice();
  detectCodes(code.rgba, code.width, code.height);
  assert.deepEqual(code.rgba, before);
});

test('the box found around a code covers the code and not the quiet zone', () => {
  const code = render('ffrwd');
  const [{ box }] = detectCodes(code.rgba, code.width, code.height);
  const inset = QUIET * SCALE;
  // jsQR reports the finder-pattern hull, which is the dark square itself.
  assert.ok(box.x >= inset - SCALE, `box.x ${box.x}`);
  assert.ok(box.y >= inset - SCALE, `box.y ${box.y}`);
  assert.ok(box.x + box.w <= code.width - inset + SCALE, `box right ${box.x + box.w}`);
  assert.ok(box.h > SCALE * 8, `box.h ${box.h}`);
});

test('a longer payload survives the round trip', () => {
  const text = 'https://want.video/ffrwd/jsqr';
  const code = render(text);
  const found = detectCodes(code.rgba, code.width, code.height);
  assert.deepEqual(
    found.map((one) => one.text),
    [text],
  );
});

// jsQR reads one code per pass and groups finder patterns by module size, so
// a second code is reached by painting the first out and asking again - and
// two codes the same size on one frame confuse the locator into finding
// neither.
test('two codes in one frame are both found', () => {
  const near = render('near', 10);
  const far = render('far', 4);
  const width = 1000;
  const height = 600;
  const frame = white(width, height);
  paste(frame, width, near, 20, 20);
  paste(frame, width, far, 700, 400);

  const found = detectCodes(frame, width, height);
  assert.deepEqual(
    found.map((one) => one.text).sort(),
    ['far', 'near'],
  );
});

test('a frame with no code finds nothing', () => {
  assert.deepEqual(detectCodes(white(120, 120), 120, 120), []);
});

test('the mosaic over a found box leaves the code unreadable', () => {
  const code = render('ffrwd');
  const [{ box }] = detectCodes(code.rgba, code.width, code.height);
  mosaicBox(code.rgba, code.width, code.height, box);
  assert.deepEqual(detectCodes(code.rgba, code.width, code.height), []);
});

test('a frame is decoded once per timestamp, however often it is handed in', () => {
  const cache = new DetectionCache();
  const code = render('ffrwd');
  const first = cache.codesFor(7n, code.rgba, code.width, code.height);
  const again = cache.codesFor(7n, code.rgba, code.width, code.height);
  // The same answer, not merely an equal one: the second ask did no work.
  assert.equal(first, again);
  assert.deepEqual(
    first.map((one) => one.text),
    ['ffrwd'],
  );
});

test('a timestamp that has left the window is dropped', () => {
  const cache = new DetectionCache(2);
  const blank = white(60, 60);
  const first = cache.codesFor(1n, blank, 60, 60);
  cache.codesFor(2n, blank, 60, 60);
  cache.codesFor(3n, blank, 60, 60);
  assert.notEqual(cache.codesFor(1n, blank, 60, 60), first);
});

test('a window read fetches only the timestamps not yet decoded', () => {
  const code = render('ffrwd');
  const instance = new Instance(code.width, code.height);
  instance.boxes([0n], () => code.rgba);
  // The next window holds pts 0 and 1; only pts 1 is fetched.
  const fetched = [];
  const boxes = instance.boxes([0n, 1n], (i) => {
    fetched.push(i);
    return code.rgba;
  });
  assert.deepEqual(fetched, [1]);
  // Both frames still count, and the one box they share is listed once.
  assert.equal(boxes.length, 1);
});
