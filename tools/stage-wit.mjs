// Stages the wit componentize-js builds against. It is the `ffrwd/wasm`
// package's own file, copied where the build wants it and never edited here.

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { WIT_DIR } from './config.mjs';

export function stageWit() {
  let installed;
  try {
    installed = execFileSync('ffrwd', ['path', 'ffrwd/wasm'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }).trim();
  } catch (error) {
    throw new Error(`cannot locate ffrwd/wasm: ${error.message}\nrun: ffrwd install`);
  }
  mkdirSync(WIT_DIR, { recursive: true });
  copyFileSync(join(installed, 'wit', 'av.wit'), join(WIT_DIR, 'av.wit'));
  return installed;
}
