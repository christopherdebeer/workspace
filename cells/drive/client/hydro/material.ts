import * as THREE from 'three';
import { HYDRO_FRAGMENT_SHADER, HYDRO_VERTEX_SHADER } from './shaders';
import type { HydroTileField } from './types';

export interface HydroFrameUniforms {
  uTime: { value: number };
  uWorldOrigin: { value: THREE.Vector3 };
  /** x=wind x, y=wind z, z=speed m/s. */
  uWind: { value: THREE.Vector3 };
  uRain: { value: number };
  uSunDirection: { value: THREE.Vector3 };
  uDebugView: { value: number };
  uWaveAmplitude: { value: number };
  uWaveLength: { value: number };
  uRippleStrength: { value: number };
  uFoamStrength: { value: number };
  uShoreFade: { value: number };
}

export interface HydroTileTextures {
  geometry: THREE.DataTexture;
  dynamics: THREE.DataTexture;
  material: THREE.DataTexture;
}

export interface HydroTileGpuBinding {
  readonly geometryField: THREE.Texture;
  readonly dynamicsField: THREE.Texture;
  readonly materialField: THREE.Texture;
  readonly fieldUv: THREE.Vector4;
  readonly elevationBaseM: number;
}

export function createHydroFrameUniforms(): HydroFrameUniforms {
  return {
    uTime: { value: 0 },
    uWorldOrigin: { value: new THREE.Vector3() },
    uWind: { value: new THREE.Vector3(1, 0, 0) },
    uRain: { value: 0 },
    uSunDirection: { value: new THREE.Vector3(0.45, 0.82, 0.35).normalize() },
    uDebugView: { value: 0 },
    uWaveAmplitude: { value: 1 },
    uWaveLength: { value: 1 },
    uRippleStrength: { value: 1 },
    uFoamStrength: { value: 1 },
    uShoreFade: { value: 1 },
  };
}

/**
 * ── MESH UV TO FIELD UV ──
 *
 * Two corrections in one vector, because they compose and separating them
 * invites one being applied without the other.
 *
 * V RUNS THE OTHER WAY ON THE MESH. The field's rows run with +Z: `zAt` is
 * `minZ + …iz…`, texture row zero is at v=0, `flipY` is false, and
 * `worldToUv` — the CPU binding for the same question — maps v increasing
 * with +Z. `PlaneGeometry` puts uv.y=1 at +Y and the `rotateX(-PI/2)` that
 * lays it flat sends +Y to −Z, so mesh uv.y=1 lands at minZ. Fed straight
 * through, every tile sampled its field mirrored north-south and drew each
 * body up to a tile from where it belongs.
 *
 * AND THE MESH NO LONGER COVERS THE WHOLE TILE. It spans `waterBounds`, so
 * mesh uv 0..1 maps to a sub-rect of the field rather than to all of it.
 *
 * Both are a scale and a bias per axis, which is exactly what this vector is:
 *   field_u = offset + (worldX - minX) / spanX * centralScale
 *   worldX  = rect.minX + u * rectSpanX
 *   worldZ  = rect.maxZ - v * rectSpanZ        (the mesh's V, flipped)
 */
function fieldUvFor(
  field: HydroTileField,
  centralScale: number,
  offset: number,
): THREE.Vector4 {
  const spanX = Math.max(Number.EPSILON, field.bounds.maxX - field.bounds.minX);
  const spanZ = Math.max(Number.EPSILON, field.bounds.maxZ - field.bounds.minZ);
  const rect = field.waterBounds ?? field.bounds;
  const su = ((rect.maxX - rect.minX) / spanX) * centralScale;
  const sv = ((rect.maxZ - rect.minZ) / spanZ) * centralScale;
  return new THREE.Vector4(
    su,
    -sv,
    offset + ((rect.minX - field.bounds.minX) / spanX) * centralScale,
    offset + ((rect.maxZ - field.bounds.minZ) / spanZ) * centralScale,
  );
}

function configure(texture: THREE.DataTexture, linear: boolean): THREE.DataTexture {
  texture.minFilter = texture.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

export function createHydroTextures(field: HydroTileField): HydroTileTextures {
  return {
    geometry: configure(new THREE.DataTexture(
      field.geometry, field.width, field.height, THREE.RGBAFormat, THREE.FloatType,
    ), true),
    dynamics: configure(new THREE.DataTexture(
      field.dynamics, field.width, field.height, THREE.RGBAFormat, THREE.FloatType,
    ), true),
    material: configure(new THREE.DataTexture(
      field.material, field.width, field.height, THREE.RGBAFormat, THREE.UnsignedByteType,
    ), false),
  };
}

export function createHydroMaterial(
  field: HydroTileField,
  textures: HydroTileTextures,
  frame: HydroFrameUniforms,
): THREE.ShaderMaterial {
  const centralScale = field.resolution / field.width;
  const offset = field.gutter / field.width;
  return new THREE.ShaderMaterial({
    name: `hydro:${field.key}`,
    vertexShader: HYDRO_VERTEX_SHADER,
    fragmentShader: HYDRO_FRAGMENT_SHADER,
    uniforms: {
      // ── FOG UNIFORMS, OR THE FIRST RENDERED TILE THROWS ──
      //
      // The shaders already carry all four fog chunks, so the GLSL declares
      // `fogColor`, `fogNear` and `fogFar` and expects them filled. But a
      // ShaderMaterial does NOT inherit UniformsLib the way the built-in
      // materials do — merging it is the caller's job — so with `fog: true`
      // and a scene that has fog, three's refreshFogUniforms reached for
      // `uniforms.fogColor.value` on a key that was not there and threw
      // `Cannot read properties of undefined (reading 'value')` inside
      // setProgram, on the first hydro tile ever drawn. The DOM panel still
      // rendered, so the lab looked like it was up and merely showing nothing.
      //
      // Cloned, not shared: three writes into these per material, and the
      // frame uniforms below are deliberately shared BY REFERENCE so one
      // update reaches every tile. Mixing the two lifetimes in one object is
      // how that sharing would quietly stop working.
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uHydroGeometry: { value: textures.geometry },
      uHydroDynamics: { value: textures.dynamics },
      uHydroMaterial: { value: textures.material },
      // Both the V flip and the water-rect sub-mapping live in one place —
      // see `fieldUvFor`.
      uFieldUv: { value: fieldUvFor(field, centralScale, offset) },
      // Private field metrics let the shader derive shore normals, river
      // grade and flow curvature without expanding the integration API.
      uHydroTexel: { value: new THREE.Vector2(1 / field.width, 1 / field.height) },
      uFieldMeters: { value: new THREE.Vector2(
        (field.bounds.maxX - field.bounds.minX) / field.resolution,
        (field.bounds.maxZ - field.bounds.minZ) / field.resolution,
      ) },
      uElevationBase: { value: field.elevationBaseM },
      uTime: frame.uTime,
      uWorldOrigin: frame.uWorldOrigin,
      uWind: frame.uWind,
      uRain: frame.uRain,
      uSunDirection: frame.uSunDirection,
      uDebugView: frame.uDebugView,
      uWaveAmplitude: frame.uWaveAmplitude,
      uWaveLength: frame.uWaveLength,
      uRippleStrength: frame.uRippleStrength,
      uFoamStrength: frame.uFoamStrength,
      uShoreFade: frame.uShoreFade,
    },
    side: THREE.FrontSide,
    transparent: false,
    depthTest: true,
    depthWrite: true,
    fog: true,
    toneMapped: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -3,
  });
}

export function hydroBinding(
  field: HydroTileField,
  textures: HydroTileTextures,
): HydroTileGpuBinding {
  const centralScale = field.resolution / field.width;
  const offset = field.gutter / field.width;
  return {
    geometryField: textures.geometry,
    dynamicsField: textures.dynamics,
    materialField: textures.material,
    fieldUv: new THREE.Vector4(centralScale, centralScale, offset, offset),
    elevationBaseM: field.elevationBaseM,
  };
}

export function disposeHydroTextures(textures: HydroTileTextures): void {
  textures.geometry.dispose();
  textures.dynamics.dispose();
  textures.material.dispose();
}
