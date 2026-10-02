// The `node` export of `ffrwd:av/node@0.19.0`, made the way both modules need
// it: no params, one rgba picture on a port `v` that is the clock, and rows or
// pictures out. What `ffrwd-node` does for a Rust module, cut to what `scan`
// and `mosaic_codes` use.

export const PIXEL_FORMAT = 'rgba';

const NO_PARAMS = '{"type":"object","properties":{},"additionalProperties":false}';

/** The clock input `v`: a picture, `window` frames a call, `stride` taken. */
export function pictureClock(window = 1, stride = 1) {
  return {
    name: 'v',
    kind: 'video',
    required: true,
    many: false,
    pairing: { tag: 'lockstep' },
    rows: 'ignore',
    window,
    stride,
    accepts: {
      pixelFormats: [PIXEL_FORMAT],
      sampleFormats: [],
      sampleRates: new Uint32Array(0),
      channelCounts: new Uint32Array(0),
      codecs: [],
      wants: 'all',
    },
  };
}

/** A data output of JSON rows, each matching `schema`. */
export function rowsOutput(name, schema) {
  return { name, kind: 'data', format: { tag: 'data', val: 'json' }, latency: 0, schema };
}

/** A picture output named after input `port`, in its format. */
export function likeOutput(port) {
  return { name: port, kind: 'video', format: { tag: 'like', val: { port } }, latency: 0 };
}

/** What one call emits, built as the call goes. */
class Out {
  constructor() {
    this.items = [];
  }

  /** One JSON row on `port` at `pts`. */
  message(port, pts, text) {
    const data = new TextEncoder().encode(text);
    this.items.push({ port, payload: { tag: 'message', val: { pts, data } } });
  }

  /** Input frame `frame` of stream `id` leaving on `port` uncopied. */
  pass(port, id, frame) {
    const { pts, duration, index } = frame;
    this.items.push({ port, payload: { tag: 'same', val: { pts, duration, id, index } } });
  }

  /** New bytes on `port`, at `frame`'s own time. */
  frame(port, frame, data) {
    const { pts, duration } = frame;
    this.items.push({ port, payload: { tag: 'frame', val: { pts, duration, data } } });
  }
}

/** The `node` export for a module named `name`.
 *
 * `shape` is its node shape. `open(v)` makes the instance's state from its
 * picture, `{ id, width, height }`, and `process(state, tick, out)` runs one
 * tick. An error is thrown as its message, which is the call's `err`.
 */
export function node({ name, version, shape, open, process }) {
  let state = null;

  function readParams(params) {
    const text = params.trim();
    if (text === '') return;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw `${name} cannot read its params: ${error.message}`;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw `${name} takes its params as a JSON object`;
    }
    const named = Object.keys(parsed).filter((key) => parsed[key] !== null);
    if (named.length > 0) {
      throw `${name} takes no parameters, and was given ${named.join(', ')}`;
    }
  }

  return {
    describe() {
      return {
        name,
        version,
        paramsSchema: NO_PARAMS,
        rowsSchema: '',
        pixelFormats: [],
        sampleFormats: [],
        sampleRates: new Uint32Array(0),
        channelCounts: new Uint32Array(0),
        rowsLanguage: [],
      };
    },

    shape(params, bound) {
      readParams(params);
      for (const port of bound) {
        if (port !== 'v') throw `${name} has no input '${port}'; it reads 'v'`;
      }
      return {
        clock: { tag: 'input', val: 'v' },
        bounded: true,
        relation: [],
        ...shape,
      };
    },

    init(bound, latched, params) {
      readParams(params);
      const v = bound.find((stream) => stream.port === 'v');
      if (v === undefined) throw `${name} reads a picture on 'v', and none is bound`;
      if (v.format?.tag !== 'video') throw `${name} reads video on 'v'`;
      const { width, height, pixFmt } = v.format.val;
      if (pixFmt !== PIXEL_FORMAT) throw `${name} reads ${PIXEL_FORMAT}, opened for ${pixFmt}`;
      state = open({ id: v.id, width, height });
    },

    setParams(params) {
      readParams(params);
    },

    process(tick) {
      if (state === null) throw `${name} was called before init`;
      const out = new Out();
      process(state, tick, out);
      return { items: out.items, rows: [], finished: false };
    },
  };
}
