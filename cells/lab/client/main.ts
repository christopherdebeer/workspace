/**
 * The lab's one bundle: every experiment is in it, and none of them runs until its page asks.
 * A page names its experiment (`<html data-exp="mistwood">`); only that experiment's module is
 * loaded (the bundler keeps each `import()` lazy), so a page pays for nothing but itself.
 *
 * A new experiment: its folder under client/, a line here, a page in static/, an entry in
 * ../experiments.ts.
 */
const experiments: Record<string, () => Promise<unknown>> = {
  mistwood: () => import('./mistwood/main'),
  plate: () => import('./plate/main'),
  bricks: () => import('./bricks/main'),
  fungi: () => import('./fungi/main'),
  markovs: () => import('./markovs/main'),
  crystals: () => import('./crystals/main'),
  changes: () => import('./changes/main'),
  seals: () => import('./seals/main'),
};

const id = document.documentElement.dataset.exp ?? '';
const start = experiments[id];
if (start) void start();
else document.body.textContent = `no experiment "${id}" in this lab`;
