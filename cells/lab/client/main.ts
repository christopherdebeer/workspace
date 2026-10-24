/**
 * The lab's one bundle: every experiment is in it, and none of them runs until its page asks.
 * A page names its experiment (`<html data-exp="mistwood">`); only that experiment's module is
 * loaded (the bundler keeps each `import()` lazy), so a page pays for nothing but itself.
 *
 * A new experiment: its folder under client/, a line here, a page in static/, an entry in
 * ../experiments.ts. An experiment may load this same bundle as a worker (`?worker=<id>` on its
 * URL); then only that worker's part runs.
 */
import { noPageZoom } from './kit/nozoom';


const experiments: Record<string, () => Promise<unknown>> = {
  mistwood: () => import('./mistwood/main'),
  plate: () => import('./plate/main'),
  bricks: () => import('./bricks/main'),
  blocks: () => import('./blocks/main'),
  technic: () => import('./technic/main'),
  marbles: () => import('./marbles/main'),
  squishy: () => import('./squishy/main'),
  'squishy-lab': () => import('./squishy-lab/main'),
  fungi: () => import('./fungi/main'),
  markovs: () => import('./markovs/main'),
  crystals: () => import('./crystals/main'),
  changes: () => import('./changes/main'),
  seals: () => import('./seals/main'),
  field: () => import('./field/main'),
  taohua: () => import('./taohua/main'),
  fab: () => import('./fab/main'),
  labyrinth: () => import('./labyrinth/main'),
  cloudfold: () => import('./cloudfold/main'),
  imperecept: () => import('./imperecept/main'),
};

// (loaded as a worker by an experiment that shapes off the page's thread: serve it)
const workers: Record<string, () => Promise<unknown>> = {
  blocks: () => import('./blocks/mesher').then((m) => m.serve()),
};

if (typeof document === 'undefined') {
  const w = new URL(self.location.href).searchParams.get('worker') ?? '';
  void workers[w]?.();
} else {
  // (the page itself never zooms: each experiment zooms its own way)
  noPageZoom();
  const id = document.documentElement.dataset.exp ?? '';
  const start = experiments[id];
  if (start) void start();
  else document.body.textContent = `no experiment "${id}" in this lab`;
}
