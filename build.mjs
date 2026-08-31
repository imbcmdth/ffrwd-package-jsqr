// Builds one wasm component per export. A component carries one filter, so
// `scan` and `mosaic_codes` are two components over the one detection core.

import { componentize } from '@bytecodealliance/componentize-js';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { EXPORTS, OUT_DIR, WIT_DIR, WORLD } from './tools/config.mjs';
import { stageWit } from './tools/stage-wit.mjs';

// StarlingMonkey pulls in wasi:http for its fetch machinery unless these are
// off, and the module would then need capabilities it never uses.
const DISABLED = ['http', 'fetch-event', 'random', 'clocks'];

// weval compiles the JavaScript ahead of time instead of leaving every frame
// to the interpreter: ~19% off each frame, paid for in a bigger component and
// a slower start. Frames outnumber starts in anything this module is for.
const AOT = true;

// componentize-js takes one source file, so jsQR is bundled into it.
async function bundle(name) {
  const out = join(OUT_DIR, `${name}.bundle.js`);
  await build({
    entryPoints: [join('src', `${name}.js`)],
    outfile: out,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    mainFields: ['module', 'main'],
    legalComments: 'inline',
  });
  return out;
}

async function componentizeExport(name) {
  const sourcePath = await bundle(name);
  const { component } = await componentize({
    sourcePath,
    witPath: WIT_DIR,
    worldName: WORLD,
    disableFeatures: DISABLED,
    enableAot: AOT,
  });
  const wasm = join(OUT_DIR, `${name}.wasm`);
  writeFileSync(wasm, component);
  return { wasm, bytes: component.length };
}

stageWit();
mkdirSync(OUT_DIR, { recursive: true });
for (const name of EXPORTS) {
  const { wasm, bytes } = await componentizeExport(name);
  console.log(`${wasm}  ${(bytes / 1024 / 1024).toFixed(2)} MiB`);
}
