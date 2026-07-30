/**
 * SkyBackdrop — the atmosphere dome + a scattering of decorative stars,
 * rendered behind the landing page. No data loading, no interaction, just the
 * night sky that the full graph eventually owns. On transition the landing
 * fades away and the full graph mounts seamlessly over this same visual.
 *
 * The shader and palette are identical to graph.tsx's sky dome (extracted from
 * the same constants) so the visual handoff is imperceptible.
 */
import * as React from 'react';
import { ink } from './ink';
import { loadThree, makeStarTexture, SKY_VERT, SKY_FRAG, makeBlackTexture } from './graph/scene';
import { TUNE } from './graph/tune';

const { useEffect, useRef } = React;

export function SkyBackdrop({ heroHeight }: { heroHeight?: string }): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let raf = 0;

    (async () => {
      const THREE = await loadThree();
      if (disposed || !THREE) return;

      const W = el.clientWidth || window.innerWidth;
      const H = el.clientHeight || window.innerHeight;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(ink.sceneBg);

      // ── Sky dome (SKY_VERT/SKY_FRAG — the one shader, shared with graph.tsx) ──
      // Reduced atmosphere (the hero painting provides the warm horizon glow);
      // the deep-sky nebulae run at half strength behind the painting, and the
      // data-driven cluster clouds stay off — the decorative dome has no data.
      const skyUniforms = {
        uAtmo: { value: TUNE.atmosphere * 0.5 },
        uNebula: { value: TUNE.nebula * 0.5 },
        uBase: { value: new THREE.Color(ink.sceneBg) },
        uCloud: { value: makeBlackTexture(THREE) },
        uCloudAmt: { value: 0 },
      };
      const skyMat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
        uniforms: skyUniforms,
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
      });
      const skyDome = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 24), skyMat);
      skyDome.frustumCulled = false;
      skyDome.renderOrder = -1;
      scene.add(skyDome);

      // ── Decorative stars (a small random scatter on the shell) ──
      const STAR_COUNT = 400;
      const SHELL = 420;
      const positions = new Float32Array(STAR_COUNT * 3);
      const sizes = new Float32Array(STAR_COUNT);
      for (let i = 0; i < STAR_COUNT; i++) {
        const theta = Math.random() * Math.PI * 2;
        // Bias toward upper hemisphere (stars are more visible against the dark zenith)
        const u = Math.random();
        const phi = Math.acos(1 - u * 1.4); // concentrates ~70% above horizon
        const r = SHELL * (0.95 + Math.random() * 0.1);
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.cos(phi); // y is up
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
        sizes[i] = 1.2 + Math.random() * 2.2;
      }
      const starGeo = new THREE.BufferGeometry();
      starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      starGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
      const starTex = makeStarTexture(THREE, TUNE.starSpike, TUNE.starHalo);
      const starMat = new THREE.PointsMaterial({
        map: starTex,
        size: 2.8,
        sizeAttenuation: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        color: new THREE.Color('#f5ecd0'),
        opacity: 0.8,
      });
      const stars = new THREE.Points(starGeo, starMat);
      scene.add(stars);

      // ── Camera: pitched upward so the starfield dominates (the painted
      //    hero provides the horizon glow; the dome only needs to fill the sky). ──
      const camera = new THREE.PerspectiveCamera(60, W / H, 1, 8000);
      camera.position.set(0, 0, 0);
      camera.lookAt(0, SHELL * 0.5, -SHELL);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(W, H);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = TUNE.exposure;
      renderer.domElement.style.cssText = 'display:block;width:100%;height:100%';
      el.innerHTML = '';
      el.appendChild(renderer.domElement);

      // Gentle slow rotation for life
      let yaw = 0;
      const tick = (): void => {
        if (disposed) return;
        yaw += 0.00012;
        camera.position.set(0, 0, 0);
        camera.lookAt(Math.sin(yaw) * SHELL, SHELL * 0.5, -Math.cos(yaw) * SHELL);
        renderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      // Resize
      const ro = new ResizeObserver(() => {
        const w = el.clientWidth || window.innerWidth;
        const h = el.clientHeight || window.innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      });
      ro.observe(el);
    })();

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={host}
      // Hero-height on the landing (matches SkyGradient + the authed graph) so
      // the content below sits on solid ground; full-viewport if unconstrained.
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: heroHeight ? 'auto' : 0, height: heroHeight ?? '100%', background: ink.sceneBg, zIndex: 0 }}
    />
  );
}
