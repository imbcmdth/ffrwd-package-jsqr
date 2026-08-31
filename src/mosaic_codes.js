// `mosaic_codes`: the picture with every QR code pixelated, no rows.

import { mosaicBox } from './detect.js';
import { heads, Instance, metaFor } from './instance.js';

const NAME = 'mosaic_codes';
const VERSION = '0.1.0';

const instance = new Instance(NAME);

export const windowFilter = {
  describe() {
    return metaFor({
      name: NAME,
      version: VERSION,
      rowsSchema: '',
      // Each frame is redacted out of its own window and nothing else, so a
      // call answers out of what it was handed.
      pure: true,
    });
  },

  init(format, streamInfo, params) {
    instance.open(format, streamInfo, params);
  },

  setParams(params) {
    instance.readParams(params);
  },

  process(frames, trailing, last) {
    const out = [];
    for (const head of heads(frames, last)) {
      const { boxes } = instance.read(head.window);
      if (boxes.length === 0) {
        out.push({ pts: head.frame.pts, frame: { tag: 'same' }, rows: [] });
        continue;
      }
      const redacted = head.frame.frame.slice();
      for (const box of boxes) mosaicBox(redacted, instance.width, instance.height, box);
      out.push({ pts: head.frame.pts, frame: { tag: 'new', val: redacted }, rows: [] });
    }
    return { frames: out, trailing: [] };
  },
};
