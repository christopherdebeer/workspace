import * as THREE from 'three';
import { facade, markAtlas } from './facade';
import {
  MARK_CULTURES, MARK_N, MARK_PALETTE, MARK_SERVICE_FIRST, markLookAt, packMark,
} from './graffiti';

/**
 * ── THE MARKS LAB: A WALL, AND NOTHING ELSE ──
 *
 * Built because the first cut of wall graffiti could not be SEEN. Verifying
 * it in the game meant finding a town, waiting on an upstream that was
 * failing, and hoping the camera settled facing the lower two metres of a
 * façade — and when nothing appeared, "the density is zero", "the shader did
 * not compile" and "the tile never arrived" all look identical.
 *
 * So: four wall slabs carrying the PRODUCTION façade material (imported, not
 * reimplemented — a lab that copies what it inspects proves nothing), with
 * the attribute the game computes per building driven by dials instead. What
 * the wall does here is exactly what a wall does in Freiburg.
 *
 * The atlas strip along the bottom is the other half of the answer: it draws
 * every mark in the sheet at size, so "the placement is wrong" and "the
 * artwork is empty" are never the same picture again.
 */

const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

/** A wall slab: a box, so it has a real normal and a real base like a
 *  building does. The façade shader keys off both. */
function slab(w: number, h: number, x: number, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, 1.2);
  geo.translate(x, h / 2, 0);
  // aBase is the building's ground line and aMark its packed look — the two
  // attributes the batch supplies in the game. Filled per slab here.
  const n = geo.attributes.position.count;
  geo.setAttribute('aBase', new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute('aMark', new THREE.BufferAttribute(new Float32Array(n), 1));
  return new THREE.Mesh(geo, mat);
}

export async function startMarksLab(): Promise<void> {
  document.title = 'DRIVE · MARKS LAB';
  const style = document.createElement('style');
  style.textContent = `
    html, body { margin: 0; height: 100%; background: #0b0f11; overflow: hidden;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: #d6e2e4; }
    canvas { display: block; }
    #ui { position: fixed; top: 0; left: 0; padding: 10px 12px; background: rgba(8,14,16,.86);
      border-right: 1px solid #24343a; border-bottom: 1px solid #24343a; max-width: 260px; }
    #ui label { display: flex; justify-content: space-between; gap: 10px; margin: 5px 0;
      letter-spacing: 1px; color: #9fb2b5; }
    #ui input, #ui select { background: #101a1d; color: #d6e2e4; border: 1px solid #2b3d43;
      font: inherit; width: 116px; }
    #status { position: fixed; left: 0; bottom: 0; padding: 8px 12px; white-space: pre;
      background: rgba(8,14,16,.86); border-top: 1px solid #24343a; letter-spacing: 1px; }
    #atlas { position: fixed; right: 8px; top: 8px; border: 1px solid #24343a;
      image-rendering: pixelated; width: 168px; height: 168px; background: #14201f; }
    a.back { position: fixed; right: 8px; bottom: 8px; color: #6f8285; text-decoration: none;
      letter-spacing: 2px; }`;
  document.head.appendChild(style);

  const ui = document.createElement('div');
  ui.id = 'ui';
  ui.innerHTML = `
    <label>CULTURE <select id="culture"></select></label>
    <label>DENSITY <input id="density" type="range" min="0" max="1" step="0.02" value="0.5"></label>
    <label>SIGIL <input id="sigil" type="range" min="0" max="${MARK_N - 1}" step="1" value="3"></label>
    <label>TIN <input id="tin" type="range" min="0" max="${MARK_PALETTE.length - 1}" step="1" value="1"></label>
    <label>SUN <input id="sun" type="range" min="5" max="85" step="1" value="42"></label>
    <label>PAINT <input id="paint" type="color" value="#e8e2d4"></label>`;
  document.body.appendChild(ui);
  const status = document.createElement('div');
  status.id = 'status';
  document.body.appendChild(status);
  const back = document.createElement('a');
  back.className = 'back'; back.href = '/lab'; back.textContent = 'ALL LABS';
  document.body.appendChild(back);

  const cultureSel = el<HTMLSelectElement>('culture');
  for (const c of MARK_CULTURES) {
    const o = document.createElement('option');
    o.value = c.key; o.textContent = c.key.toUpperCase();
    cultureSel.appendChild(o);
  }

  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight, false);
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2c3f47);
  const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 400);
  camera.position.set(0, 2.4, 15);
  camera.lookAt(0, 2.2, 0);

  const sun = new THREE.DirectionalLight(0xfff2dc, 2.1);
  sun.position.set(6, 9, 7);
  scene.add(sun, new THREE.AmbientLight(0x7d94a0, 1.1));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200),
    new THREE.MeshLambertMaterial({ color: 0x50564a }));
  ground.rotateX(-Math.PI / 2);
  scene.add(ground);

  // THE PRODUCTION MATERIAL. Same construction the game's walls use: a
  // Lambert with the façade shader hung off it.
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xe8e2d4 });
  facade(wallMat);
  const slabs = [
    slab(14, 9, -19, wallMat),   // a tall block
    slab(12, 6.2, -2.5, wallMat), // a terrace
    slab(9, 4.1, 12, wallMat),   // a low shed-ish wall
    slab(7, 3.2, 22, wallMat),   // a garden wall
  ];
  for (const s of slabs) scene.add(s);

  // The atlas, drawn straight from the shared material so what is on the
  // strip is literally what the wall samples.
  const atlasImg = document.createElement('canvas');
  atlasImg.id = 'atlas';
  document.body.appendChild(atlasImg);
  {
    // The texture the wall samples, drawn at size — so "the placement is
    // wrong" and "the artwork is empty" can never be the same picture.
    const src = markAtlas.image as HTMLCanvasElement | null;
    if (src) {
      atlasImg.width = src.width; atlasImg.height = src.height;
      atlasImg.getContext('2d')?.drawImage(src, 0, 0);
    }
  }

  const num = (id: string): number => parseFloat(el<HTMLInputElement>(id).value);
  const apply = (): void => {
    const sigil = Math.round(num('sigil'));
    const tin = Math.round(num('tin'));
    const density = num('density');
    const packed = sigil * 8 + tin + Math.min(0.999, density);
    for (const s of slabs) {
      const a = s.geometry.getAttribute('aMark') as THREE.BufferAttribute;
      (a.array as Float32Array).fill(packed);
      a.needsUpdate = true;
    }
    wallMat.color.set(el<HTMLInputElement>('paint').value);
    const e = num('sun') * Math.PI / 180;
    sun.position.set(Math.cos(e) * 9, Math.sin(e) * 11, 6);
    const look = markLookAt(
      { latLonAt: () => [48.8, 2.3] }, 0, 0,
      [0.05, 0.15, 0.6, 0.15, 0.05], 1);
    status.textContent =
      `SIGIL ${sigil}${sigil >= MARK_SERVICE_FIRST ? ' (SERVICE)' : ''} · TIN ${tin} · DENSITY ${density.toFixed(2)}\n`
      + `packed ${packed.toFixed(3)} — the wall unpacks floor(v/8), mod(v,8), fract(v)\n`
      + `a real settlement here would pick: sigil ${look.sigil} tin ${look.tin} `
      + `density ${look.density.toFixed(2)} (${look.culture.key})`;
  };
  for (const id of ['density', 'sigil', 'tin', 'sun', 'paint', 'culture']) {
    el(id).addEventListener('input', apply);
  }
  apply();

  // Orbit: drag to turn, wheel to close in. A mark is a thing you walk up to.
  let drag: { x: number; y: number } | null = null;
  let yaw = 0, pitch = 0.05, dist = 15;
  const place = (): void => {
    camera.position.set(Math.sin(yaw) * dist, 2.4 + Math.sin(pitch) * dist, Math.cos(yaw) * dist);
    camera.lookAt(0, 2.2, 0);
  };
  renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
  addEventListener('pointerup', () => { drag = null; });
  addEventListener('pointermove', (e) => {
    if (!drag) return;
    yaw -= (e.clientX - drag.x) * 0.006;
    pitch = Math.max(-0.25, Math.min(0.6, pitch + (e.clientY - drag.y) * 0.004));
    drag = { x: e.clientX, y: e.clientY };
    place();
  });
  addEventListener('wheel', (e) => {
    dist = Math.max(3, Math.min(60, dist + Math.sign(e.deltaY) * 1.4));
    place();
  }, { passive: true });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
  });
  place();

  const frame = (): void => {
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
