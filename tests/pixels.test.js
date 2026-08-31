// The pixel work over the rgba frames the wire carries: the box around a
// code, and the mosaic that redacts it.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { blockSize, boundingBox, CHANNELS, mosaicBox } from '../src/detect.js';

test('a 64-pixel box mosaics in 8-pixel blocks', () => {
  assert.equal(blockSize(64), 8);
});

test('a small box floors at two pixels', () => {
  assert.equal(blockSize(9), 2);
  assert.equal(blockSize(1), 2);
  assert.equal(blockSize(0), 2);
});

test('the block grows with the box, so it always swallows a module', () => {
  assert.equal(blockSize(160), 20);
  assert.equal(blockSize(800), 100);
});

test('the box is the axis-aligned hull of the four corners, clipped', () => {
  const location = {
    topLeftCorner: { x: 10.4, y: 20.2 },
    topRightCorner: { x: 70.9, y: 18.5 },
    bottomRightCorner: { x: 72.1, y: 80.6 },
    bottomLeftCorner: { x: 8.7, y: 82.3 },
  };
  assert.deepEqual(boundingBox(location, 200, 200), { x: 8, y: 18, w: 65, h: 65 });
});

test('a box running off the frame is cut to it', () => {
  const location = {
    topLeftCorner: { x: -5, y: -5 },
    topRightCorner: { x: 300, y: -5 },
    bottomRightCorner: { x: 300, y: 300 },
    bottomLeftCorner: { x: -5, y: 300 },
  };
  assert.deepEqual(boundingBox(location, 100, 100), { x: 0, y: 0, w: 100, h: 100 });
});

test('a mosaiced block is its own average, and nothing outside it moves', () => {
  const width = 4;
  const height = 2;
  const rgba = new Uint8Array(width * height * CHANNELS);
  const set = (x, y, value) => {
    const i = (y * width + x) * CHANNELS;
    rgba[i] = value;
    rgba[i + 1] = value;
    rgba[i + 2] = value;
    rgba[i + 3] = 255;
  };
  set(0, 0, 0);
  set(1, 0, 200);
  set(0, 1, 0);
  set(1, 1, 200);
  set(3, 0, 111);

  mosaicBox(rgba, width, height, { x: 0, y: 0, w: 2, h: 2 });

  for (const [x, y] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]) {
    assert.equal(rgba[(y * width + x) * CHANNELS], 100);
    assert.equal(rgba[(y * width + x) * CHANNELS + 3], 255, 'alpha is left alone');
  }
  assert.equal(rgba[3 * CHANNELS], 111);
});

test('the mosaic leaves no run of the original pixels behind', () => {
  const width = 32;
  const height = 32;
  const rgba = new Uint8Array(width * height * CHANNELS);
  // A checkerboard one pixel wide: nothing survives a block larger than one.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * CHANNELS;
      const value = (x + y) % 2 === 0 ? 0 : 255;
      rgba[i] = value;
      rgba[i + 1] = value;
      rgba[i + 2] = value;
      rgba[i + 3] = 255;
    }
  }
  mosaicBox(rgba, width, height, { x: 0, y: 0, w: 32, h: 32 });
  const colours = new Set();
  for (let i = 0; i < rgba.length; i += CHANNELS) colours.add(rgba[i]);
  assert.deepEqual([...colours], [128]);
});
