// Checks every built component against the sidecar's own description: the
// world this ffrwd hosts, and no capability the module does not use.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { EXPORTS, OUT_DIR, WIT_PACKAGE } from './config.mjs';

const CAPABILITIES = ['nn', 'http', 'udp'];

function sidecar() {
  const override = process.env.FFRWD_WASM;
  if (override && override.trim() !== '') return override.trim();
  return 'ffrwd-wasm';
}

export function describe(wasm) {
  const out = execFileSync(sidecar(), ['--describe', wasm], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return JSON.parse(out);
}

const failures = [];
for (const name of EXPORTS) {
  const wasm = join(OUT_DIR, `${name}.wasm`);
  if (!existsSync(wasm)) {
    failures.push(`${wasm} is not built`);
    continue;
  }
  const described = describe(wasm);
  console.log(`${wasm}\n${JSON.stringify(described)}`);
  if (described.world !== WIT_PACKAGE) {
    failures.push(`${name} targets ${described.world}, wanted ${WIT_PACKAGE}`);
  }
  if (described.name !== name) {
    failures.push(`${name} exports '${described.name}'`);
  }
  for (const capability of CAPABILITIES) {
    if (described[capability]) failures.push(`${name} asks for ${capability}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log(`ok  ${EXPORTS.length} components, ${WIT_PACKAGE}, no capabilities`);
