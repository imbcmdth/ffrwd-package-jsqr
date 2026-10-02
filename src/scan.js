// `scan`: a row per frame for each QR code in view, every row of one sighting
// naming it by the time it began.

import { detectCodes, payloads, row, Sightings } from './detect.js';
import { node as makeNode, pictureClock, rowsOutput } from './node.js';

const ROW_SCHEMA =
  '{"type":"object","properties":{"start_t":{"type":"number"},"text":{"type":"string"}},' +
  '"required":["start_t","text"],"additionalProperties":false}';

export const node = makeNode({
  name: 'scan',
  version: '0.2.0',
  shape: {
    inputs: [pictureClock()],
    outputs: [rowsOutput('codes', ROW_SCHEMA)],
    // Which sighting a code belongs to outlives the frame it is read on.
    pure: false,
    oneToOne: false,
  },
  open: (v) => ({ v, sightings: new Sightings() }),
  process({ v, sightings }, tick, out) {
    const frame = tick.frames(v.id).at(-1);
    if (frame === undefined) return;
    const { num, den } = tick.timeBase();
    sightings.tick((Number(frame.pts) * num) / den);
    const pixels = tick.fetch(v.id, frame.index);
    for (const text of payloads(detectCodes(pixels, v.width, v.height))) {
      out.message('codes', frame.pts, row(sightings.see(text), text));
    }
  },
});
