// Checks every built component against the sidecar's own description and
// shape: a node of the world this ffrwd hosts, no capability the module does
// not use, and the ports the package's SQL declares.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { EXPORTS, OUT_DIR, WORLD } from './config.mjs';

const CAPABILITIES = ['nn', 'http', 'udp', 'tcp', 'gpu'];

function sidecar() {
  const override = process.env.FFRWD_WASM;
  if (override && override.trim() !== '') return override.trim();
  return 'ffrwd-wasm';
}

function ask(args) {
  return JSON.parse(
    execFileSync(sidecar(), args, { encoding: 'utf8', shell: process.platform === 'win32' }),
  );
}

export function describe(wasm) {
  return ask(['--describe', wasm]);
}

export function shape(wasm) {
  return ask(['--shape', wasm, '--bound', 'v']);
}

const failures = [];
for (const name of EXPORTS) {
  const wasm = join(OUT_DIR, `${name}.wasm`);
  if (!existsSync(wasm)) {
    failures.push(`${wasm} is not built`);
    continue;
  }
  const described = describe(wasm);
  const shaped = shape(wasm);
  console.log(`${wasm}\n${JSON.stringify(described)}\n${JSON.stringify(shaped)}`);
  if (described.world !== WORLD || described.node !== true) {
    failures.push(`${name} is a ${described.world} module, wanted a node`);
  }
  if (described.name !== name) {
    failures.push(`${name} exports '${described.name}'`);
  }
  for (const capability of CAPABILITIES) {
    if (described[capability]) failures.push(`${name} asks for ${capability}`);
  }
  if (shaped.clock?.port !== 'v') {
    failures.push(`${name} is not clocked by 'v'`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log(`ok  ${EXPORTS.length} nodes, ${WORLD}, no capabilities`);
