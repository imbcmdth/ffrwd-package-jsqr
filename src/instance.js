// What both exports share at the wasm boundary: the opened instance, the one
// window each call is read over, and the meta that describes it.

import { CodeRuns, DetectionCache, STRIDE, WINDOW } from './detect.js';

export const PIXEL_FORMAT = 'rgba';

// Neither export takes a value parameter: the window is settled at describe
// time, before `init` is ever called, so there is nothing left for a call to
// say.
export const PARAMS_SCHEMA = '{"type":"object","properties":{},"additionalProperties":false}';

/** One opened instance: the geometry, the time base, and the running state. */
export class Instance {
  constructor(name) {
    this.name = name;
    this.width = 0;
    this.height = 0;
    this.timeBase = { num: 1, den: 1 };
    this.cache = new DetectionCache();
    this.runs = new CodeRuns();
  }

  open(format, streamInfo, params) {
    if (format.tag !== 'video') {
      throw `${this.name} filters video, opened for ${format.tag}`;
    }
    if (format.val.pixFmt !== PIXEL_FORMAT) {
      throw `${this.name} filters ${PIXEL_FORMAT}, opened for ${format.val.pixFmt}`;
    }
    this.width = format.val.width;
    this.height = format.val.height;
    this.timeBase = streamInfo.timeBase;
    this.readParams(params);
    this.cache = new DetectionCache();
    this.runs = new CodeRuns();
  }

  /** Checks the parameters, leaving the previous ones in force on refusal. */
  readParams(params) {
    const text = params.trim();
    if (text === '') return;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw `${this.name} cannot read its params: ${error.message}`;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw `${this.name} takes its params as a JSON object`;
    }
    const named = Object.keys(parsed);
    if (named.length > 0) {
      throw `${this.name} takes no parameters, and was given ${named.join(', ')}`;
    }
  }

  /** A timestamp in the stream's own base, as seconds. */
  seconds(pts) {
    return (Number(pts) * this.timeBase.num) / this.timeBase.den;
  }

  /** One window read: what it saw, and where.
   *
   * `sightings` maps each payload to the time of the LAST frame in the window
   * it was really seen in - the end of its cue. `boxes` is every distinct box
   * anywhere in the window, which is what the frame the window heads has to
   * have redacted out of it.
   */
  read(window) {
    const sightings = new Map();
    const boxes = [];
    const placed = new Set();
    for (const inFrame of window) {
      const time = this.seconds(inFrame.pts);
      for (const code of this.cache.codesFor(inFrame.pts, inFrame.frame, this.width, this.height)) {
        const previous = sightings.get(code.text);
        if (previous === undefined || time > previous) sightings.set(code.text, time);
        const key = `${code.box.x},${code.box.y},${code.box.w},${code.box.h}`;
        if (placed.has(key)) continue;
        placed.add(key);
        boxes.push(code.box);
      }
    }
    return { sightings, boxes };
  }
}

/** The window-meta both exports fill the same way. */
export function metaFor({ name, version, rowsSchema, pure }) {
  return {
    meta: {
      name,
      version,
      paramsSchema: PARAMS_SCHEMA,
      rowsSchema,
      pixelFormats: [PIXEL_FORMAT],
      sampleFormats: [],
      sampleRates: [],
      channelCounts: [],
      // The cues mint an untagged track: the language a call could name is
      // not declared here yet.
      rowsLanguage: [],
    },
    window: WINDOW,
    stride: STRIDE,
    pure,
    // One output per frame consumed, each at that frame's own pts.
    oneToOne: true,
    readsRows: false,
    forwardsRows: false,
    inputs: 1,
  };
}

/** The frames one call speaks for: its first, or every leftover on the last.
 *
 * A regular call consumes one frame and sees the `window` frames from it on.
 * The final call is handed whatever the last stride left over and consumes
 * all of it, so it speaks for every one - each over the frames still ahead of
 * it, a window that shortens to nothing at the end of the stream.
 */
export function heads(frames, last) {
  const count = last ? frames.length : Math.min(1, frames.length);
  const spoken = [];
  for (let i = 0; i < count; i++) spoken.push({ frame: frames[i], window: frames.slice(i) });
  return spoken;
}
