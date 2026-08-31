// What the build and the checks over it agree on.

export const OUT_DIR = 'build';
export const WIT_DIR = 'wit';

// One component per export: a component carries one filter, so the two share
// their detection core in source and nowhere else.
export const EXPORTS = ['scan', 'mosaic_codes'];

export const WORLD = 'window-module';
export const WIT_PACKAGE = 'ffrwd:av@0.10.0';
