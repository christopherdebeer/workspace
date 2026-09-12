import * as THREE from 'three';
import { mulberry32, type Rng } from './rng';
import type { RoofTex, WallTex } from './culture';

/**
 * ── THE WALL AND ROOF CANVASES, OUT OF MAIN.TS SO A LAB CAN BAKE THEM ──
 *
 * Every building texture the world draws is a 128px canvas painted once at
 * load from a seeded RNG and cached for ever. They lived beside the road,
 * water and terrain canvases in main.ts, which was fine until the façade lab
 * needed the SAME stone, brick, timber and adobe on its one building — and a
 * lab that redraws what it inspects proves nothing (labs.ts, the rule that
 * keeps a lab honest). So the families are drawn here, by a factory that
 * takes the renderer's anisotropy as an argument rather than reading it off
 * the game's renderer: main.ts builds its instance with TEX_ANISO and the lab
 * with its own, and both get byte-identical canvases from the same seeds.
 *
 * The road, water and terrain canvases stay in main.ts; they are not what a
 * building lab looks at, and moving them would be churn for its own sake.
 */
export type CanvasTexFn = (size: number, repeatX: number, repeatY: number, seed: number,
  draw: (c: CanvasRenderingContext2D, s: number, r: Rng) => void) => THREE.Texture;

/** The canvas-texture factory, bound to one anisotropy. NEAREST magnification
 *  everywhere (crisp texels are half the pixel look); mipmapping stays ON, or
 *  distant surfaces shimmer as texels fall below the pixel grid; and above 1
 *  the minification is trilinear with anisotropic taps — see TEX_ANISO in
 *  main.ts for why a road ahead of the truck needs that. */
export function makeCanvasTex(aniso: number): CanvasTexFn {
  return (size, repeatX, repeatY, seed, draw) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    draw(cv.getContext('2d')!, size, mulberry32(seed));
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = aniso > 1 ? THREE.LinearMipmapLinearFilter : THREE.NearestMipmapNearestFilter;
    if (aniso > 1) t.anisotropy = aniso;
    t.repeat.set(repeatX, repeatY);
    return t;
  };
}

export function speckle(c: CanvasRenderingContext2D, s: number, r: Rng, colors: string[], n: number, rad = 1.6): void {
  for (let i = 0; i < n; i++) {
    c.fillStyle = colors[i % colors.length];
    c.fillRect(r() * s, r() * s, rad + r() * rad, rad + r() * rad);
  }
}
// A crack is a random walk with momentum — jagged, branchless, believable.
export function cracks(c: CanvasRenderingContext2D, s: number, r: Rng, n: number, color: string): void {
  c.strokeStyle = color;
  c.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    let x = r() * s, y = r() * s, ang = r() * Math.PI * 2;
    c.beginPath();
    c.moveTo(x, y);
    for (let j = 0, steps = 4 + Math.floor(r() * 5); j < steps; j++) {
      ang += (r() - 0.5) * 1.2;
      x += Math.cos(ang) * (3 + r() * 6);
      y += Math.sin(ang) * (3 + r() * 6);
      c.lineTo(x, y);
    }
    c.stroke();
  }
}
// Moss/overgrowth: clustered soft blobs in layered greens.
export function moss(c: CanvasRenderingContext2D, s: number, r: Rng, n: number, colors: string[]): void {
  for (let i = 0; i < n; i++) {
    const cx = r() * s, cy = r() * s, blob = 2 + r() * 5;
    for (let j = 0; j < 6; j++) {
      c.fillStyle = colors[j % colors.length];
      c.beginPath();
      c.arc(cx + (r() - 0.5) * blob * 2, cy + (r() - 0.5) * blob * 2, 1 + (r() * blob) / 2, 0, Math.PI * 2);
      c.fill();
    }
  }
}

export interface WallTextures {
  WALL_TEX: Record<WallTex, THREE.Texture>;
  ROOF_TEX: Record<RoofTex, THREE.Texture>;
  /** The two limewash walls and the felt roof the hashed creams wear. */
  wallTexes: THREE.Texture[];
  roofTex: THREE.Texture;
}

/** Every building canvas, drawn through the given factory. Called once by
 *  main.ts at load and once by the façade lab; the seeds are the recipe. */
export function wallTextures(canvasTex: CanvasTexFn): WallTextures {
  const roofTex = canvasTex(128, 1 / 10, 1 / 10, 105, (c, s, r) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, s, s);
    speckle(c, s, r, ['rgba(0,0,0,0.10)', 'rgba(0,0,0,0.05)'], 300);
    c.strokeStyle = 'rgba(0,0,0,0.10)'; c.lineWidth = 1;
    for (let i = 16; i < s; i += 26) { c.beginPath(); c.moveTo(0, i); c.lineTo(s, i); c.stroke(); } // panel seams
    cracks(c, s, r, 3, 'rgba(30,26,18,0.25)');
    moss(c, s, r, 6, ['rgba(64,96,44,0.45)', 'rgba(42,70,32,0.4)', 'rgba(96,128,60,0.3)']);
  });
  // Crumbling walls, two variants so neighbouring parcels don't twin: floor
  // bands, cracks, and moss/vines claiming the concrete. White base — the
  // per-parcel material colour tints it.
  const wallTexes = [7101, 7102].map((seed) => canvasTex(128, 1 / 9, 1 / 9, seed, (c, s, r) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, s, s);
    c.fillStyle = 'rgba(0,0,0,0.10)';
    for (let y = 10; y < s; y += 24) c.fillRect(0, y, s, 3); // floor bands
    speckle(c, s, r, ['rgba(0,0,0,0.08)', 'rgba(255,255,255,0.05)'], 240);
    cracks(c, s, r, 5, 'rgba(20,16,10,0.35)');
    moss(c, s, r, 7, ['rgba(64,96,44,0.5)', 'rgba(42,70,32,0.45)', 'rgba(96,128,60,0.35)']);
  }));
  // ── M5: THE MATERIAL FAMILIES ─────────────────────────────────────
  //
  // The two textures above — one roof, two walls — were the whole vocabulary of
  // the built world, so every building on the planet was rendered concrete under
  // panel-seam felt however much its PAINT varied. That is why the twelve creams
  // read as twelve creams rather than as places: colour without material is a
  // tint, and the eye reads material first.
  //
  // These are drawn once at load into a canvas and cached forever, which is the
  // route `grainFx` and `wallTexes` already established. The cost is paid once
  // and shared by every instance in the world, so a family costs a texture, not
  // a draw call. White base throughout — the culture's paint tints it, exactly
  // as the limewash pair already worked.
  const WALL_TEX: Record<WallTex, THREE.Texture> = {
    // Lime render: near-flat, the detail carried by wear rather than by units.
    render: wallTexes[0],
    // Ashlar. COURSES, not a grid: real stonework breaks its vertical joints
    // between courses, and a texture that does not is instantly a wallpaper.
    stone: canvasTex(128, 1 / 9, 1 / 9, 3301, (c, s, r) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, s, s);
      const rows = 7, h = s / rows;
      for (let i = 0; i < rows; i++) {
        const y = i * h;
        // Each course offset by its own amount, so no two courses line up.
        let x = -r() * 40;
        while (x < s) {
          const w = 16 + r() * 26;
          c.fillStyle = `rgba(0,0,0,${(0.03 + r() * 0.07).toFixed(3)})`;
          c.fillRect(x + 1, y + 1, w - 2, h - 2);
          x += w;
        }
        c.strokeStyle = 'rgba(0,0,0,0.13)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(0, y); c.lineTo(s, y); c.stroke();
      }
      speckle(c, s, r, ['rgba(0,0,0,0.05)', 'rgba(255,255,255,0.05)'], 200);
      moss(c, s, r, 4, ['rgba(64,96,44,0.35)', 'rgba(42,70,32,0.3)']);
    }),
    // Stretcher bond: half-lap every course, which is the pattern the eye
    // actually recognises as brick from thirty metres.
    brick: canvasTex(128, 1 / 6, 1 / 6, 3302, (c, s, r) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, s, s);
      const rows = 16, h = s / rows, bw = s / 4;
      for (let i = 0; i < rows; i++) {
        const y = i * h, off = (i % 2) * (bw / 2);
        for (let j = -1; j < 5; j++) {
          c.fillStyle = `rgba(0,0,0,${(0.02 + r() * 0.06).toFixed(3)})`;
          c.fillRect(j * bw + off + 1, y + 1, bw - 2, h - 2);
        }
      }
      c.strokeStyle = 'rgba(255,255,255,0.10)'; c.lineWidth = 1;
      for (let i = 0; i <= rows; i++) { c.beginPath(); c.moveTo(0, i * h); c.lineTo(s, i * h); c.stroke(); }
      speckle(c, s, r, ['rgba(0,0,0,0.06)'], 160);
    }),
    // Vertical board-and-batten. The battens are the read; the boards between
    // them only need to vary slightly in tone.
    timber: canvasTex(128, 1 / 7, 1 / 7, 3303, (c, s, r) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, s, s);
      for (let x = 0; x < s; x += 11) {
        c.fillStyle = `rgba(0,0,0,${(0.02 + r() * 0.08).toFixed(3)})`;
        c.fillRect(x, 0, 10, s);
        c.fillStyle = 'rgba(0,0,0,0.16)'; c.fillRect(x + 9, 0, 2, s);      // batten shadow
        c.fillStyle = 'rgba(255,255,255,0.10)'; c.fillRect(x + 11, 0, 1, s); // its lit edge
      }
      // Grain, along the board rather than across it.
      c.strokeStyle = 'rgba(0,0,0,0.07)'; c.lineWidth = 1;
      for (let i = 0; i < 26; i++) {
        const x = r() * s; c.beginPath(); c.moveTo(x, r() * s * 0.4); c.lineTo(x + (r() - 0.5) * 3, s); c.stroke();
      }
    }),
    // Earth: no units at all. Hand-shaped, so what varies is the SURFACE —
    // broad soft undulation, and the darker line where a wall has been patched.
    adobe: canvasTex(128, 1 / 8, 1 / 8, 3304, (c, s, r) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, s, s);
      for (let i = 0; i < 40; i++) {
        c.fillStyle = `rgba(0,0,0,${(0.015 + r() * 0.035).toFixed(3)})`;
        c.beginPath(); c.ellipse(r() * s, r() * s, 8 + r() * 22, 6 + r() * 16, r() * 3.14, 0, 6.2832); c.fill();
      }
      speckle(c, s, r, ['rgba(0,0,0,0.05)', 'rgba(255,255,255,0.06)'], 260, 1.2);
      cracks(c, s, r, 3, 'rgba(60,44,24,0.18)');
    }),
  };
  // ── THE ROOF CANVASES CARRY TONE; THE UNITS ARE THE SHADER'S ──
  //
  // These used to draw the courses — rows of barrels, broken-bond slates,
  // corrugated ribs — and roof-fx.ts draws all of that per fragment now, in
  // a frame that runs WITH the slope (the canvas is mapped in world plan, so
  // its rows ran along world z whichever way the ridge went), at the size a
  // real unit is, with edges the quantiser keeps. A canvas that still drew
  // rows would lay a second, coarser, wrongly-turned set under the shader's.
  // What a canvas is good for is what a shader's hash is bad at: the moss on
  // the shaded slope, the rust running from a fixing, the patchy weathering
  // of a roof that has stood forty years. White base, tinted by the paint.
  const ROOF_TEX: Record<RoofTex, THREE.Texture> = {
    // Pantile: a warm patchiness — some tiles have baked darker — and moss.
    pantile: canvasTex(128, 1 / 7, 1 / 7, 3401, (c, s, r) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, s, s);
      speckle(c, s, r, ['rgba(60,30,10,0.10)', 'rgba(255,240,220,0.08)', 'rgba(40,20,10,0.06)'], 220, 2.5);
      moss(c, s, r, 5, ['rgba(64,96,44,0.35)', 'rgba(96,128,60,0.25)']);
    }),
    // Slate: never one grey — a cool mottle and the odd pale slate.
    slate: canvasTex(128, 1 / 8, 1 / 8, 3402, (c, s, r) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, s, s);
      speckle(c, s, r, ['rgba(0,0,0,0.10)', 'rgba(20,30,50,0.08)', 'rgba(255,255,255,0.06)'], 260, 2.2);
      speckle(c, s, r, ['rgba(255,255,255,0.06)'], 120, 1.2);
    }),
    // Shingle: the grain runs down the slope (canvas y is the slope in the
    // shader's frame), warm wear, and moss where it stays damp.
    shingle: canvasTex(128, 1 / 8, 1 / 8, 3403, (c, s, r) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, s, s);
      for (let x = 0; x < s; x += 3) {
        c.fillStyle = `rgba(40,24,10,${(0.02 + r() * 0.07).toFixed(3)})`;
        c.fillRect(x, 0, 1 + Math.floor(r() * 2), s);
      }
      moss(c, s, r, 6, ['rgba(64,96,44,0.4)', 'rgba(42,70,32,0.35)']);
    }),
    // Corrugated iron: rust at the fixings and the runs below them — the
    // ribs and the sheet laps are the shader's.
    corrugated: canvasTex(128, 1 / 6, 1 / 6, 3404, (c, s, r) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, s, s);
      for (let i = 0; i < 26; i++) {
        const x = r() * s, y = r() * s;
        c.fillStyle = `rgba(122,68,32,${(0.15 + r() * 0.3).toFixed(2)})`;
        c.fillRect(x, y, 1 + r() * 3, 1 + r() * 3);
        c.fillStyle = `rgba(122,68,32,${(0.05 + r() * 0.12).toFixed(2)})`;
        c.fillRect(x, y, 1 + r() * 2, 6 + r() * 24);   // the run below it
      }
    }),
    // Flat: felt and gravel, with the ponding and the patch lines that go with
    // it. Keeps the old panel-seam roof, which is exactly what this is.
    flat: roofTex,
  };
  return { WALL_TEX, ROOF_TEX, wallTexes, roofTex };
}
