import * as THREE from 'three';
import type { RoofTex } from './culture';

/**
 * ── THE ROOF IS COURSES, AND THE COURSES RUN WITH THE SLOPE ──
 *
 * A pitched roof used to be a plane wearing a canvas mapped by WORLD PLAN
 * coordinates (roofGeo's uv is x, z off the ground plan): the pantile
 * canvas's rows ran along world z whatever way the ridge ran, so half the
 * roofs in a town had their courses running UP the slope, the canvas's row
 * was 0.78 m against a real course of 0.3, and at the survey's twelve pixels
 * to the metre the whole thing mip-filtered into a flat tone with a faint
 * grid in it. That is the "blocky texture" the critique named, on the
 * surface that is most of a house from the street.
 *
 * The courses are computed here, per fragment, from the plane's own normal:
 * the down-slope direction is gravity projected into the plane, the
 * along-eave direction is across it, and a fragment's (across, down) is a
 * coordinate in metres on the roof surface in which a course is a row, a
 * tile is a cell, and the broken bond is half a tile's offset on alternate
 * rows. The canvas is sampled in the SAME frame — so its moss and rust sit
 * on the courses rather than across them — and carries tone only; the units,
 * the laps and the joints are drawn here with the hard edges the composite's
 * quantiser keeps. Per fragment, because that is the cheap resource: a roof
 * is still two quads.
 *
 * WHICH ROOF is a uniform per material, read off `userData.roofKind` when the
 * program compiles (the lab swaps the map and recompiles; main.ts sets it at
 * construction): pantile is barrels — a light and a dark half per tile, the
 * whole read at distance; slate is wide thin units with a fine lap; shingle
 * small units; corrugated is ribs DOWN the slope with sheet laps across it,
 * the one roof whose units run the other way; flat keeps the felt in plan.
 * A cap (normal near vertical) and a gable wall (near horizontal) are left
 * alone — the flat felt in plan, and the wall's own shader.
 *
 * THE EAVE is where the roof meets the wall's top, which rides in as aTop
 * beside aBase (flushBuildings packs it for every piece); the last course
 * sits in the gutter's shadow. There is no ridge line yet: a fragment cannot
 * know where its plane ends, and the ridge height would be a fifth
 * attribute. Chained, never assigned: the roof materials carry no other hook
 * today, and the day one does this must not be the hook that clobbers it.
 */
const ROOF_KIND: Record<RoofTex, number> = { pantile: 0, slate: 1, shingle: 2, corrugated: 3, flat: 4 };

export function roofFx(mat: THREE.MeshLambertMaterial, kind?: RoofTex): void {
  if (kind) mat.userData.roofKind = kind;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    const k = ROOF_KIND[(mat.userData.roofKind as RoofTex | undefined) ?? 'flat'] ?? 4;
    sh.uniforms.uRfKind = { value: k };
    // Shared by reference with the texture's own repeat, so the canvas keeps
    // the metres-per-tile its recipe stated.
    sh.uniforms.uRfRep = { value: mat.map?.repeat ?? new THREE.Vector2(1 / 7, 1 / 7) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTop;\nvarying vec3 vRfW; varying vec3 vRfN; varying float vRfEave;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 rfW = modelMatrix * vec4(transformed, 1.0);
        vRfW = rfW.xyz;
        vRfN = mat3(modelMatrix) * objectNormal;
        vRfEave = aTop;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vRfW; varying vec3 vRfN; varying float vRfEave;
        uniform float uRfKind; uniform vec2 uRfRep;
        float rfh(vec2 p){ p = fract(p * vec2(233.71, 119.3)); p += dot(p, p + 37.17); return fract(p.x * p.y); }`)
      .replace('#include <map_fragment>', `
      #ifdef USE_MAP
      {
        vec3 rn = normalize(vRfN);
        float ny = abs(rn.y);
        // A pitched plane: not a cap, not a wall, and not felt. The cap is
        // EXACTLY level (an extrusion's top), so the gate can sit at three
        // degrees and still let a Cape skillion at eight carry its ribs —
        // the first cut's fourteen drew that roof as felt.
        bool pitched = ny > 0.25 && ny < 0.9986 && uRfKind < 3.5;
        vec2 muv = vMapUv;
        float rfTone = 1.0;
        if (pitched) {
          // Down the slope is gravity projected into the plane; across is the
          // eave's direction. Both are the same whichever face is seen (the
          // products of two signs), so a soffit reads its courses too.
          vec3 dn = normalize(vec3(rn.x * rn.y, rn.y * rn.y - 1.0, rn.z * rn.y));
          vec3 ac = normalize(cross(rn, dn));
          float c = dot(vRfW, dn), a = dot(vRfW, ac);
          muv = vec2(a, c) * uRfRep;
          if (uRfKind > 2.5) {
            // Corrugated: ribs down the slope, a lap across every sheet.
            rfTone = 0.86 + 0.26 * step(0.5, fract(a / 0.15));
            rfTone *= 1.0 - 0.28 * step(0.93, fract(c / 1.8));
          } else {
            float courseM = 0.34, tileM = 0.28, lap = 0.28, jit = 0.07;
            if (uRfKind > 0.5 && uRfKind < 1.5) { courseM = 0.30; tileM = 0.50; lap = 0.20; jit = 0.09; }
            if (uRfKind > 1.5) { courseM = 0.25; tileM = 0.22; lap = 0.22; jit = 0.10; }
            float row = floor(c / courseM);
            float bond = 0.5 * mod(row, 2.0);
            vec2 tid = vec2(floor(a / tileM + bond), row);
            float ta = fract(a / tileM + bond), tc = fract(c / courseM);
            // Every unit its own tone — a roof is never one colour — then
            // the barrel on a pantile, the lap along the course's lower
            // edge, and the joint between units on slate and shingle.
            rfTone = 1.0 + jit * (rfh(tid) * 2.0 - 1.0);
            if (uRfKind < 0.5) rfTone *= 0.9 + 0.2 * step(0.5, ta);
            rfTone *= 1.0 - lap * step(0.8, tc);
            rfTone *= 1.0 - 0.12 * step(0.9, ta) * step(0.5, uRfKind);
          }
          // The eave: the last course in the gutter's shadow.
          rfTone *= 1.0 - 0.3 * step(vRfW.y - vRfEave, 0.16);
        }
        vec4 sampledDiffuseColor = texture2D(map, muv);
        diffuseColor *= sampledDiffuseColor;
        diffuseColor.rgb *= rfTone;
      }
      #endif`);
  };
  mat.needsUpdate = true;
}
