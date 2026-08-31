// The retroactive window, driven the way the host drives it: no pixels, no
// wasm. `heads` says which frames a call speaks for; `CodeRuns` turns the
// credit each of them gets into cues.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CodeRuns, WINDOW } from '../src/detect.js';
import { heads } from '../src/instance.js';

const FPS = 30;
const at = (index) => index / FPS;

// The whole stream through the module, the way the sidecar cuts it: a call
// per frame carrying that frame and the WINDOW - 1 after it, then a final
// call carrying whatever the last stride left over. `seen(k)` is the payloads
// frame k was really decoded in.
function drive(count, seen, size = WINDOW) {
  const frames = [];
  for (let k = 0; k < count; k++) frames.push({ pts: k, texts: seen(k) });

  const calls = [];
  for (let k = 0; k + size <= count; k++) calls.push({ window: frames.slice(k, k + size) });
  const consumed = calls.length;
  calls.push({ window: frames.slice(consumed), last: true });

  const runs = new CodeRuns();
  const cues = [];
  const credited = [];
  for (const call of calls) {
    for (const head of heads(call.window, call.last === true)) {
      const sightings = new Map();
      for (const frame of head.window) {
        for (const text of frame.texts) sightings.set(text, at(frame.pts));
      }
      credited.push({ frame: head.frame.pts, texts: [...sightings.keys()] });
      cues.push(...runs.credit(at(head.frame.pts), sightings));
    }
  }
  cues.push(...runs.flush());
  return { cues, credited };
}

test('every frame is spoken for exactly once, in order', () => {
  const { credited } = drive(40, () => []);
  assert.deepEqual(
    credited.map((one) => one.frame),
    Array.from({ length: 40 }, (_, k) => k),
  );
});

test('a stream shorter than the window is all one final call', () => {
  const { credited } = drive(4, () => []);
  assert.deepEqual(
    credited.map((one) => one.frame),
    [0, 1, 2, 3],
  );
});

test('a call speaks for its first frame and sees the window from it', () => {
  const frames = [{ pts: 0 }, { pts: 1 }, { pts: 2 }];
  const regular = heads(frames, false);
  assert.equal(regular.length, 1);
  assert.equal(regular[0].frame.pts, 0);
  assert.equal(regular[0].window.length, 3);
});

test('the final call speaks for every frame left over, over shortening windows', () => {
  const frames = [{ pts: 0 }, { pts: 1 }, { pts: 2 }];
  const final = heads(frames, true);
  assert.deepEqual(
    final.map((one) => [one.frame.pts, one.window.length]),
    [
      [0, 3],
      [1, 2],
      [2, 1],
    ],
  );
});

test('a sighting is carried back over every frame of its window', () => {
  const { credited } = drive(40, (k) => (k === 12 ? ['a'] : []));
  // Frame 12 is the last frame of the window headed by frame 0 through the
  // window headed by frame 12, so all of them are credited with it.
  const carrying = credited.filter((one) => one.texts.length > 0).map((one) => one.frame);
  assert.deepEqual(carrying, Array.from({ length: 13 }, (_, k) => k));
});

test('a code seen once makes one cue from its window back to its sighting', () => {
  const { cues } = drive(40, (k) => (k === 12 ? ['a'] : []));
  assert.deepEqual(cues, [{ text: 'a', start_t: at(0), end_t: at(12) }]);
});

test('a code first seen well into the stream starts a window earlier', () => {
  const { cues } = drive(60, (k) => (k === 30 ? ['a'] : []));
  assert.deepEqual(cues, [{ text: 'a', start_t: at(30 - WINDOW + 1), end_t: at(30) }]);
});

test('a gap the window can span heals into one run', () => {
  const seen = new Set([5, 6, 8, 9]);
  const { cues } = drive(40, (k) => (seen.has(k) ? ['ffrwd'] : []));
  assert.deepEqual(cues, [{ text: 'ffrwd', start_t: at(0), end_t: at(9) }]);
});

test('a gap the window cannot span breaks the run in two', () => {
  const seen = new Set([20, 21, 60, 61]);
  const { cues } = drive(90, (k) => (seen.has(k) ? ['ffrwd'] : []));
  assert.deepEqual(cues, [
    { text: 'ffrwd', start_t: at(20 - WINDOW + 1), end_t: at(21) },
    { text: 'ffrwd', start_t: at(60 - WINDOW + 1), end_t: at(61) },
  ]);
});

test('one cue covers a whole run, however many frames it was seen in', () => {
  const { cues } = drive(90, (k) => (k >= 30 && k <= 60 ? ['a'] : []));
  assert.deepEqual(cues, [{ text: 'a', start_t: at(30 - WINDOW + 1), end_t: at(60) }]);
});

test('two codes on screen together make one cue each', () => {
  const { cues } = drive(60, (k) => (k >= 20 && k <= 30 ? ['left', 'right'] : []));
  assert.deepEqual(
    cues.map((cue) => cue.text).sort(),
    ['left', 'right'],
  );
  for (const cue of cues) {
    assert.equal(cue.start_t, at(20 - WINDOW + 1));
    assert.equal(cue.end_t, at(30));
  }
});

test('a code still on screen when the stream ends is closed by the flush', () => {
  const count = 40;
  const { cues } = drive(count, (k) => (k >= 20 ? ['a'] : []));
  assert.deepEqual(cues, [
    { text: 'a', start_t: at(20 - WINDOW + 1), end_t: at(count - 1) },
  ]);
});

test('a code caught in one frame alone still spans a frame', () => {
  const runs = new CodeRuns();
  runs.credit(0, new Map([['a', 0]]));
  const [cue] = runs.flush();
  assert.equal(cue.start_t, 0);
  assert.ok(cue.end_t > cue.start_t);
  assert.deepEqual(runs.flush(), []);
});

test('a frame with no code credits nothing and closes nothing', () => {
  const runs = new CodeRuns();
  assert.deepEqual(runs.credit(0, new Map()), []);
  assert.deepEqual(runs.flush(), []);
});
