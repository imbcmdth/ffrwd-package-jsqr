// Codes made in the tests rather than shipped as fixtures: a QR encoder writes
// the matrix, and this paints it into rgba pixels.

import QRCode from 'qrcode';

import { CHANNELS } from '../src/detect.js';

export const SCALE = 6;
export const QUIET = 4;

// One code's matrix as a square of rgba pixels, dark modules on white, with
// the quiet zone a decoder needs around it.
export function render(text, scale = SCALE) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const modules = qr.modules.size;
  const side = (modules + QUIET * 2) * scale;
  const rgba = white(side, side);
  for (let row = 0; row < modules; row++) {
    for (let column = 0; column < modules; column++) {
      if (!qr.modules.get(row, column)) continue;
      const x0 = (column + QUIET) * scale;
      const y0 = (row + QUIET) * scale;
      for (let y = y0; y < y0 + scale; y++) {
        for (let x = x0; x < x0 + scale; x++) {
          const i = (y * side + x) * CHANNELS;
          rgba[i] = 0;
          rgba[i + 1] = 0;
          rgba[i + 2] = 0;
        }
      }
    }
  }
  return { rgba, width: side, height: side };
}

export function white(width, height) {
  return new Uint8Array(width * height * CHANNELS).fill(255);
}

// Pastes one rendered code into a larger frame at (x, y).
export function paste(frame, width, code, x, y) {
  for (let row = 0; row < code.height; row++) {
    const from = row * code.width * CHANNELS;
    const to = ((y + row) * width + x) * CHANNELS;
    frame.set(code.rgba.subarray(from, from + code.width * CHANNELS), to);
  }
}
