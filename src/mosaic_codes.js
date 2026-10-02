// `mosaic_codes`: the picture with every QR code pixelated, redacted by the
// codes found in it and in the frames after it.

import { mosaicBox, STRIDE, WINDOW } from './detect.js';
import { Instance } from './instance.js';
import { likeOutput, node as makeNode, pictureClock } from './node.js';

export const node = makeNode({
  name: 'mosaic_codes',
  version: '0.2.0',
  shape: {
    inputs: [pictureClock(WINDOW, STRIDE)],
    outputs: [likeOutput('v')],
    // The decode cache only saves work; each frame is redacted out of its own
    // window.
    pure: true,
    oneToOne: true,
  },
  open: (v) => ({ v, instance: new Instance(v.width, v.height) }),
  process({ v, instance }, tick, out) {
    const window = tick.frames(v.id);
    const head = window[0];
    if (head === undefined) return;
    const boxes = instance.boxes(
      window.map((frame) => frame.pts),
      (i) => tick.fetch(v.id, window[i].index),
    );
    if (boxes.length === 0) {
      out.pass('v', v.id, head);
      return;
    }
    const redacted = tick.fetch(v.id, head.index);
    for (const box of boxes) mosaicBox(redacted, v.width, v.height, box);
    out.frame('v', head, redacted);
  },
});
