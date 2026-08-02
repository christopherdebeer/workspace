/* ---------------------------------------------------------------------------
 * vendor-entry.js — the graph's 3D dependency tree as ONE self-hosted module.
 *
 * Built by build-vendor.mjs into a single ESM bundle and uploaded as a public
 * cell-data blob (served same-first-party at /@c15r/home/_data/…), so the
 * graph no longer depends on esm.sh at runtime — the CDN was measured
 * (2026-07-29) flapping 200→503→200 within a minute, blanking the sky.
 *
 * Everything scene.ts needs, from one bundle = one three module instance
 * (bloom/controls break across mismatched three copies — the same constraint
 * that forced the single pinned esm.sh version).
 * ------------------------------------------------------------------------- */
export * as THREE from 'three';
export { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
export { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
export { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
export { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
export { Text as TroikaText } from 'troika-three-text';
// The ?tune=1 instrument panel (graph.tsx). ~30KB — cheaper carried here than
// as the graph's last esm.sh module fetch.
export { default as GUI } from 'lil-gui';
