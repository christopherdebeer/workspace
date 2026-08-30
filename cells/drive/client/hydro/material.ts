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
      field.geometry as unknown as BufferSource, field.width, field.height, THREE.RGBAFormat, THREE.FloatType,
    ), true),
    dynamics: configure(new THREE.DataTexture(
      field.dynamics as unknown as BufferSource, field.width, field.height, THREE.RGBAFormat, THREE.FloatType,
    ), true),
    material: configure(new THREE.DataTexture(
      field.material as unknown as BufferSource, field.width, field.height, THREE.RGBAFormat, THREE.UnsignedByteType,
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
      uHydroGeometry: { value: textures.geometry },
      uHydroDynamics: { value: textures.dynamics },
      uHydroMaterial: { value: textures.material },
      uFieldUv: { value: new THREE.Vector4(centralScale, centralScale, offset, offset) },
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
