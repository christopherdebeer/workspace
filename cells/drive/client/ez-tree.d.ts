/**
 * ── @dgreenheck/ez-tree, AS FAR AS THE TYPE CHECK IS CONCERNED ──
 *
 * The package reaches the browser from esm.sh through client/imports.json
 * and is never installed, so tsc has no declarations for it. esm.sh serves
 * the published ones (X-TypeScript-Types → build/ez-tree.es.d.ts, 1.9k
 * lines). They are not vendored here because the one module that imports
 * the package, flora-ez-lab.ts, is an evaluation surface still being shaped
 * against them: it calls a `createGeometry(options)` that 1.1.0 does not
 * export (the published surface is `generate()` with `branchesMesh` and
 * `leavesMesh`, and `TreeOptions.copy`). Until that settles, the module is
 * declared loosely so the rest of the client stays checked; once it does,
 * replace this with the published declarations and let tsc hold the lab
 * to them.
 */
declare module '@dgreenheck/ez-tree';
