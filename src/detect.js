// The detection core, shared by both exports and free of any wasm binding:
// the QR lookup over rgba pixels, the mosaic that redacts a code, and the
// sightings `scan` names its rows by.

import jsQR from 'jsqr';

// Bytes per pixel. The wire carries rgba, which is the byte order jsQR reads,
// so a frame is handed to the decoder without being converted at all.
export const CHANNELS = 4;

// How many frames `mosaic_codes` sees in one call: a frame is redacted by
// every code found in it or in the 14 frames after it, so a code is covered
// from before the decoder first read it. 15 frames is half a second at 30fps:
// long enough to cover the frames the decoder missed a code in, short enough
// that the look-ahead stays cheap.
export const WINDOW = 15;
export const STRIDE = 1;

// How many frames in a row a code may go unread and still be the same
// sighting to `scan`, which is the gap the window above heals for
// `mosaic_codes`: the two exports agree on what one appearance is.
export const GAP = WINDOW - 1;

// How many codes one frame is searched for. Each found code is painted out
// before the next pass, so the cost is one pass per code plus one that fails.
const MAX_CODES_PER_FRAME = 8;

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

  /** Whether this timestamp's codes are held, so `codesFor` would answer
   * without reading the frame. */
  holds(pts) {
    return this.codes.has(pts);
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

/** Each payload one frame shows, once, whatever order the decoder met them
 * in: sorted, so two decoders reading the same frame name them alike. */
export function payloads(codes) {
  return [...new Set(codes.map((code) => code.text))].sort();
}

/** The row `scan` writes for a code in view: the time its sighting began,
 * which names the sighting, and its payload. `ffrwd/rsqr` writes the same
 * bytes. */
export function row(startT, text) {
  return JSON.stringify({ start_t: startT, text });
}

/** Which sighting each code in view belongs to, named by the time it began.
 *
 * `tick` once a frame, then `see` each payload the frame shows. A sighting
 * ends when its payload goes unread for more than `gap` frames in a row, and
 * the next read starts a new one: the run table `ffrwd-node`'s `Spans` keeps
 * for a Rust module.
 */
export class Sightings {
  constructor(gap = GAP) {
    this.gap = gap;
    this.open = new Map();
    this.frame = -1;
    this.time = 0;
  }

  tick(time) {
    this.frame += 1;
    this.time = time;
    for (const [text, open] of this.open) {
      if (this.frame - open.seen - 1 > this.gap) this.open.delete(text);
    }
  }

  /** The start of the sighting `text` belongs to, begun here if none is open. */
  see(text) {
    let open = this.open.get(text);
    if (open === undefined) {
      open = { startT: this.time, seen: this.frame };
      this.open.set(text, open);
    }
    open.seen = this.frame;
    return open.startT;
  }
}
