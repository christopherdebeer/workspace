// Generate public/pan.html — the harness page hydrated with the REAL parcland
// scene (public/parcland-scene.json, captured via @c15r/canvas.scene) so pan
// profiling runs against the board that actually crashes, not a toy.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scene = JSON.parse(readFileSync(join(here, 'public/parcland-scene.json'), 'utf8'));

const elements = scene.elements.map((e) => ({
  ...(e.content ?? {}),
  ...(e.placement ?? {}),
  id: e.id,
}));
const payload = JSON.stringify({
  canvasId: 'parcland',
  cam: { scale: 0.35, translateX: 600, translateY: 500 },
  elements,
}).replace(/</g, '\\u003c');

const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>canvas pan harness (parcland)</title>
  <style>
    html, body { touch-action: none; user-select: none; overflow: hidden; }
    #drillUp, #context-menu, .modal { display: none; }
    #mode { position: fixed; z-index: 2; top: 0; left: 0; }
  </style>
  <script>
    window.marked = { parse: (s) => '<p>' + String(s).replace(/</g, '&lt;') + '</p>' };
    window.CodeMirror = function () { return { getValue: () => '', setValue: () => {}, on: () => {} }; };
  </script>
</head>
<body>
  <button id="drillUp">↑ Drill Up</button>
  <div id="canvas" mode="navigate">
    <svg id="edges-layer"></svg>
    <div id="canvas-container"></div>
    <div id="context-menu"></div>
  </div>
  <div id="static-container"></div>
  <button id="mode">mode</button>
  <script id="canvas-hydrate" type="application/json">${payload}</script>
  <script type="module" src="/app.js"></script>
  <link rel="stylesheet" href="/app.css">
</body>
</html>
`;
writeFileSync(join(here, 'public/pan.html'), html);
console.log(`wrote public/pan.html (${elements.length} elements)`);
