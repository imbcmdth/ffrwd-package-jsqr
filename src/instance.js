// What `mosaic_codes` keeps between calls: the geometry, and the codes of the
// frames it has already decoded.

import { DetectionCache } from './detect.js';

/** One opened instance. */
export class Instance {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.cache = new DetectionCache();
  }

  /** Every distinct box anywhere in one window, which is what the frame the
   * window heads has to have redacted out of it. `pts` is every timestamp of
   * the window, oldest first, and `fetch(i)` copies index `i`'s bytes in. A
   * timestamp met before is answered out of the cache and its bytes are never
   * asked for.
   */
  boxes(pts, fetch) {
    const boxes = [];
    const placed = new Set();
    pts.forEach((stamp, i) => {
      // A held timestamp never reaches the decoder, so the empty array stands
      // in for bytes that were never copied.
      const bytes = this.cache.holds(stamp) ? new Uint8Array(0) : fetch(i);
      for (const code of this.cache.codesFor(stamp, bytes, this.width, this.height)) {
        const key = `${code.box.x},${code.box.y},${code.box.w},${code.box.h}`;
        if (placed.has(key)) continue;
        placed.add(key);
        boxes.push(code.box);
      }
    });
    return boxes;
  }
}
