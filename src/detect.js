// The detection core, shared by both exports and free of any wasm binding:
// the QR lookup over rgba pixels, the mosaic that redacts a code, and the
// runs that turn per-frame sightings into cues.

import jsQR from 'jsqr';

// Bytes per pixel. The wire carries rgba, which is the byte order jsQR reads,
// so a frame is handed to the decoder without being converted at all.
export const CHANNELS = 4;

// How many frames one call sees, and how many it consumes. The host reads
// these off `describe` BEFORE `init`, and never asks again - so this is the
// module's own constant and cannot be a parameter of the SQL call. 15 frames
// is half a second at 30fps: long enough to carry a code back over the frames
// the decoder missed it in, short enough that the look-ahead stays cheap.
export const WINDOW = 15;
export const STRIDE = 1;

// How many codes one frame is searched for. Each found code is painted out
// before the next pass, so the cost is one pass per code plus one that fails.
const MAX_CODES_PER_FRAME = 8;

// The frame interval assumed until two frames have arrived.
const ASSUMED_INTERVAL = 1 / 30;

/** The axis-aligned box around a code's four corners, clipped to the frame. */
export function boundingBox(location, width, height) {
  const corners = [
    location.topLeftCorner,
    location.topRightCorner,
    location.bottomRightCorner,
    location.bottomLeftCorner,
  ];
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const corner of corners) {
    left = Math.min(left, corner.x);
    top = Math.min(top, corner.y);
    right = Math.max(right, corner.x);
    bottom = Math.max(bottom, corner.y);
  }
  const x = Math.max(0, Math.floor(left));
  const y = Math.max(0, Math.floor(top));
  return {
    x,
    y,
    w: Math.max(1, Math.min(width, Math.ceil(right)) - x),
    h: Math.max(1, Math.min(height, Math.ceil(bottom)) - y),
  };
}

/** The mosaic block for a box that wide.
 *
 * A QR code carries up to 30% error correction and reads straight through a
 * blur, so the block has to be larger than the code's own module or the
 * redaction is decorative. Eight modules across the box is the fewest a
 * version-1 code reaches, so a block an eighth of the box wide swallows at
 * least one module whatever version it is.
 */
export function blockSize(boxWidth) {
  return Math.max(2, Math.floor(boxWidth / 8));
}

/** Pixelates one box of an rgba frame in place, block by block. */
export function mosaicBox(rgba, width, height, box) {
  const size = blockSize(box.w);
  const right = Math.min(width, box.x + box.w);
  const bottom = Math.min(height, box.y + box.h);
  for (let by = box.y; by < bottom; by += size) {
    for (let bx = box.x; bx < right; bx += size) {
      const blockRight = Math.min(right, bx + size);
      const blockBottom = Math.min(bottom, by + size);
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let y = by; y < blockBottom; y++) {
        for (let x = bx; x < blockRight; x++) {
          const i = (y * width + x) * CHANNELS;
          r += rgba[i];
          g += rgba[i + 1];
          b += rgba[i + 2];
          count++;
        }
      }
      if (count === 0) continue;
      const ar = Math.round(r / count);
      const ag = Math.round(g / count);
      const ab = Math.round(b / count);
      for (let y = by; y < blockBottom; y++) {
        for (let x = bx; x < blockRight; x++) {
          const i = (y * width + x) * CHANNELS;
          rgba[i] = ar;
          rgba[i + 1] = ag;
          rgba[i + 2] = ab;
        }
      }
    }
  }
}

/** Fills a box of an rgba buffer with white, so the next pass cannot see it. */
function paintOut(rgba, width, box) {
  for (let y = box.y; y < box.y + box.h; y++) {
    const row = y * width * CHANNELS;
    for (let x = box.x; x < box.x + box.w; x++) {
      const i = row + x * CHANNELS;
      rgba[i] = 255;
      rgba[i + 1] = 255;
      rgba[i + 2] = 255;
    }
  }
}

/** Every QR code in one rgba frame, as `{ text, box }`.
 *
 * jsQR returns one code per pass, so each hit is painted out and the frame
 * searched again until a pass finds nothing. The first pass reads the frame
 * where it lies; a copy is taken only once a code is found, because the frame
 * handed in may be the frame handed back.
 *
 * jsQR groups finder patterns by module size, so two codes the SAME size on
 * one frame cross its locator and neither is found; codes at different sizes
 * come back one after another.
 */
export function detectCodes(frame, width, height) {
  const view = new Uint8ClampedArray(frame.buffer, frame.byteOffset, frame.byteLength);
  let scratch = null;
  const found = [];
  const seen = new Set();
  for (let pass = 0; pass < MAX_CODES_PER_FRAME; pass++) {
    // Inverted codes are rare and the attempt doubles the per-frame cost.
    const code = jsQR(scratch ?? view, width, height, { inversionAttempts: 'dontInvert' });
    if (!code || !code.location) break;
    const box = boundingBox(code.location, width, height);
    const key = `${code.data}@${box.x},${box.y},${box.w},${box.h}`;
    if (seen.has(key)) break;
    seen.add(key);
    found.push({ text: code.data, box });
    if (scratch === null) scratch = new Uint8ClampedArray(view);
    paintOut(scratch, width, box);
  }
  return found;
}

/** Runs detection over a frame once per timestamp, however often asked.
 *
 * A window of 15 with a stride of 1 hands the same frame in 15 times, so this
 * is what keeps the work at one pass per frame rather than fifteen.
 */
export class DetectionCache {
  constructor(keep = WINDOW * 2) {
    this.keep = keep;
    this.codes = new Map();
  }

  codesFor(pts, frame, width, height) {
    const found = this.codes.get(pts);
    if (found !== undefined) return found;
    const codes = detectCodes(frame, width, height);
    this.codes.set(pts, codes);
    // The oldest entry is the first inserted, and the window only moves
    // forward, so dropping from the front is dropping what has left it.
    while (this.codes.size > this.keep) {
      this.codes.delete(this.codes.keys().next().value);
    }
    return codes;
  }
}

/** The runs a code makes across the windows it is credited to.
 *
 * A window credits the frame it heads with every code found anywhere in it,
 * so a code the decoder only catches late is carried back over the frames
 * before it. A run is the stretch of frames credited with one payload without
 * a break, which heals any gap the window can span, and it closes into one
 * cue: the first frame credited, through the last frame the code was really
 * seen in.
 */
export class CodeRuns {
  constructor() {
    this.runs = new Map();
    this.interval = ASSUMED_INTERVAL;
    this.previousTime = null;
  }

  /** One frame's credit. `sightings` maps payload to its last sighting's time.
   *
   * Returns the cues of the runs that ended before this frame.
   */
  credit(time, sightings) {
    if (this.previousTime !== null && time > this.previousTime) {
      this.interval = time - this.previousTime;
    }
    this.previousTime = time;

    for (const [text, lastSeen] of sightings) {
      const run = this.runs.get(text);
      if (run) {
        run.lastTime = Math.max(run.lastTime, lastSeen);
      } else {
        this.runs.set(text, { startTime: time, lastTime: lastSeen });
      }
    }

    const cues = [];
    for (const [text, run] of this.runs) {
      if (sightings.has(text)) continue;
      cues.push(this.cue(text, run));
      this.runs.delete(text);
    }
    return cues;
  }

  /** The cues of every run still open, which then close. */
  flush() {
    const cues = [];
    for (const [text, run] of this.runs) cues.push(this.cue(text, run));
    this.runs.clear();
    return cues;
  }

  // A run as one cue. A code caught in a single frame would span nothing, so
  // such a cue is given one frame's width.
  cue(text, run) {
    const start = run.startTime;
    const end = run.lastTime > start ? run.lastTime : start + this.interval;
    return { text, start_t: start, end_t: end };
  }
}
