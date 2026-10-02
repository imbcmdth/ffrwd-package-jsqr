// What the build and the checks over it agree on.

export const OUT_DIR = 'build';
export const WIT_DIR = 'wit';

// One component per export: a component carries one node, so the two share
// their detection core in source and nowhere else.
export const EXPORTS = ['scan', 'mosaic_codes'];

export const WORLD = 'node-module';
