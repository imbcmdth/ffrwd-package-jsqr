// Both exports driven the way the host drives a node: shape, init on a bound
// picture, then a tick at a time, over codes painted here.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectCodes, STRIDE, WINDOW } from '../src/detect.js';
import { node as mosaicCodes } from '../src/mosaic_codes.js';
import { node as scan } from '../src/scan.js';
import { paste, render, white } from './paint.js';

const WIDTH = 240;
const HEIGHT = 120;

const A = { text: 'ffrwd', scale: 3, x: 0, y: 0 };
const B = { text: 'https://want.video', scale: 2, x: 120, y: 0 };

function picture(codes) {
  const rgba = white(WIDTH, HEIGHT);
  for (const code of codes) paste(rgba, WIDTH, render(code.text, code.scale), code.x, code.y);
  return rgba;
}

// What `shape` is told: the picture on `v`, at 30 frames a second.
const BINDINGS = [{ input: 'v', streams: [{ rate: { num: 30, den: 1 } }] }];

function bound() {
  return [
    {
      port: 'v',
      id: 0,
      info: { index: 0, kind: 'video', codec: 'rawvideo', tags: [], timeBase: { num: 1, den: 30 } },
      format: { tag: 'video', val: { width: WIDTH, height: HEIGHT, pixFmt: 'rgba' } },
      rendition: {},
      decodeDelay: 0,
      hint: { rate: { num: 30, den: 1 } },
    },
  ];
}

// A tick as the host hands it: `pictures` are the window's frames, oldest
// first, the first at `pts`.
function tick(pts, pictures) {
  const frames = pictures.map((_, index) => ({ pts: BigInt(pts + index), index, rows: [] }));
  return {
    pts: () => BigInt(pts),
    timeBase: () => ({ num: 1, den: 30 }),
    last: () => false,
    frames: () => frames,
    fetch: (_, index) => pictures[index].slice(),
  };
}

function rows(emitted) {
  return emitted.items.map(({ port, payload }) => {
    assert.equal(port, 'codes');
    assert.equal(payload.tag, 'message');
    return [Number(payload.val.pts), new TextDecoder().decode(payload.val.data)];
  });
}

test('scan writes rows alone, a frame at a time', () => {
  const shape = scan.shape('', BINDINGS);
  assert.deepEqual(
    shape.outputs.map((output) => output.name),
    ['codes'],
  );
  assert.equal(shape.inputs[0].window, 1);
  assert.equal(shape.pure, false);
});

test('scan names every row of a sighting by its first frame, and sorts a frame', () => {
  scan.init(bound(), ['codes'], '');
  const seen = (k) => (k === 1 ? [B] : k <= 3 ? [B, A] : []);
  const written = [];
  for (let k = 1; k < 6; k++) written.push(...rows(scan.process(tick(k, [picture(seen(k))]))));
  const at = (k, id, text) => JSON.stringify({ start_t: k / 30, id, text });
  assert.deepEqual(written, [
    [1, at(1, 0, 'https://want.video')],
    [2, at(2, 1, 'ffrwd')],
    [2, at(1, 0, 'https://want.video')],
    [3, at(2, 1, 'ffrwd')],
    [3, at(1, 0, 'https://want.video')],
  ]);
});

test('scan refuses a param it does not take', () => {
  assert.throws(() => scan.shape('{"window":3}', BINDINGS), /takes no parameters/);
});

test('mosaic_codes follows its picture over a sliding window', () => {
  const shape = mosaicCodes.shape('', BINDINGS);
  assert.deepEqual([shape.inputs[0].window, shape.inputs[0].stride], [WINDOW, STRIDE]);
  assert.deepEqual(shape.outputs[0].format, { tag: 'like', val: { port: 'v' } });
  assert.equal(shape.pure && shape.oneToOne, true);
});

test('mosaic_codes hands a window with no code back uncopied', () => {
  mosaicCodes.init(bound(), ['v'], '');
  const emitted = mosaicCodes.process(tick(0, [picture([]), picture([])]));
  assert.deepEqual(emitted.items, [
    { port: 'v', payload: { tag: 'same', val: { pts: 0n, duration: undefined, id: 0, index: 0 } } },
  ]);
});

// Black and white columns a pixel wide: a picture a mosaic cannot leave as it
// was, and no code.
function stripes() {
  const rgba = white(WIDTH, HEIGHT);
  for (let i = 0; i < rgba.length; i += 8) rgba.fill(0, i, i + 3);
  return rgba;
}

test('mosaic_codes redacts a frame by a code later in its window', () => {
  mosaicCodes.init(bound(), ['v'], '');
  const emitted = mosaicCodes.process(tick(0, [stripes(), picture([A])]));
  const [{ payload }] = emitted.items;
  assert.equal(payload.tag, 'frame');
  assert.notDeepEqual(payload.val.data, stripes());
});

test('the code mosaic_codes redacts no longer reads', () => {
  mosaicCodes.init(bound(), ['v'], '');
  const emitted = mosaicCodes.process(tick(0, [picture([A])]));
  const [{ payload }] = emitted.items;
  assert.equal(detectCodes(picture([A]), WIDTH, HEIGHT).length, 1);
  assert.deepEqual(detectCodes(payload.val.data, WIDTH, HEIGHT), []);
});
