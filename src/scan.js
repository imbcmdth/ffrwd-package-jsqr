// `scan`: the picture untouched, every QR code beside it as a cue row.

import { heads, Instance, metaFor } from './instance.js';

const NAME = 'scan';
const VERSION = '0.1.0';

const ROWS_SCHEMA =
  '{"type":"object","properties":{"text":{"type":"string"},"start_t":{"type":"number"},' +
  '"end_t":{"type":"number"}},"required":["text","start_t","end_t"],' +
  '"additionalProperties":false}';

const instance = new Instance(NAME);

export const windowFilter = {
  describe() {
    return metaFor({
      name: NAME,
      version: VERSION,
      rowsSchema: ROWS_SCHEMA,
      // A run outlives the window it started in, so a call answers out of
      // what earlier calls left behind.
      pure: false,
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
      const { sightings } = instance.read(head.window);
      const cues = instance.runs.credit(instance.seconds(head.frame.pts), sightings);
      out.push({
        pts: head.frame.pts,
        frame: { tag: 'same' },
        rows: cues.map((cue) => JSON.stringify(cue)),
      });
    }
    if (!last) return { frames: out, trailing: [] };

    // Every frame has left, so a code still on screen closes here.
    const closing = instance.runs.flush().map((cue) => JSON.stringify(cue));
    if (out.length > 0) {
      out[out.length - 1].rows.push(...closing);
      return { frames: out, trailing: [] };
    }
    return { frames: out, trailing: closing };
  },
};
