import * as THREE from 'three';
import { createDials } from '../lab-dials';
import type { HydroTileField } from '../hydro/types';
import {
  DRIVE_MATERIAL,
  GROUND_MATERIAL,
  WATER_STATE,
  buildProductionHydroFixture,
  buildSubstrateTile,
  makeCrossingFixture,
  resolveProductionCrossing,
  sampleHydroContactLayers,
  sampleSubstrate,
  VehicleWaterEvidence,
  type CrossingKind,
  type ResolvedSubstrateTile,
  type SubstrateContact,
  type SubstrateTileInput,
  type VehicleWaterEvidenceSnapshot,
  type VehicleWaterWheelSample,
  type WaterRegime,
} from './index';
import { createVehicleWaterEvidenceRenderer } from './vehicle-water-render';

interface FlowParticle {
  x: number;
  y: number;
  z: number;
  flowX: number;
  flowZ: number;
  speed: number;
  energy: number;
  vorticity: number;
  phase: number;
  span: number;
}

interface FlowDisplay {
  points: THREE.Points;
  update(timeS: number): void;
}

interface WakeStamp {
  x: number;
  y: number;
  z: number;
  ageS: number;
  lifeS: number;
  strength: number;
}

const MAX_WAKE_STAMPS = 420;

const clamp = (value: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, value));

const hash = (x: number, z: number): number => {
  const v = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return v - Math.floor(v);
};

const colourTuple = (hex: number): readonly [number, number, number] => {
  const colour = new THREE.Color(hex);
  return [colour.r, colour.g, colour.b];
};

const GROUND_COLOURS = new Map<number, readonly [number, number, number]>([
  [GROUND_MATERIAL.terrain, colourTuple(0x526046)],
  [GROUND_MATERIAL.cut, colourTuple(0x675a45)],
  [GROUND_MATERIAL.fill, colourTuple(0x756448)],
  [GROUND_MATERIAL.riverbed, colourTuple(0x615c4c)],
  [GROUND_MATERIAL.bank, colourTuple(0x6d654d)],
  [GROUND_MATERIAL.shoulder, colourTuple(0x77705c)],
]);

function disposeTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const material = mesh.material;
    if (Array.isArray(material)) for (const item of material) materials.add(item);
    else if (material) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

function makeGround(tile: ResolvedSubstrateTile, wireframe: boolean): THREE.Mesh {
  const n = tile.resolution;
  const count = n * n;
  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const spanX = tile.bounds.maxX - tile.bounds.minX;
  const spanZ = tile.bounds.maxZ - tile.bounds.minZ;
  for (let iz = 0; iz < n; iz++) {
    const z = tile.bounds.minZ + iz / (n - 1) * spanZ;
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      const x = tile.bounds.minX + ix / (n - 1) * spanX;
      positions[i * 3] = x;
      positions[i * 3 + 1] = tile.groundY[i];
      positions[i * 3 + 2] = z;
      const base = GROUND_COLOURS.get(tile.groundMaterial[i])
        ?? GROUND_COLOURS.get(GROUND_MATERIAL.terrain)!;
      const variation = .9 + hash(ix, iz) * .16;
      colours[i * 3] = base[0] * variation;
      colours[i * 3 + 1] = base[1] * variation;
      colours[i * 3 + 2] = base[2] * variation;
    }
  }
  const indices = new Uint32Array((n - 1) * (n - 1) * 6);
  let p = 0;
  for (let iz = 0; iz < n - 1; iz++) {
    for (let ix = 0; ix < n - 1; ix++) {
      const a = iz * n + ix;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices[p++] = a; indices[p++] = c; indices[p++] = b;
      indices[p++] = b; indices[p++] = c; indices[p++] = d;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: .98,
    metalness: 0,
    wireframe,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'resolved-ground';
  mesh.receiveShadow = true;
  return mesh;
}

function makeLayerGeometry(
  tile: ResolvedSubstrateTile,
  heights: Float32Array<ArrayBuffer>,
  includeCell: (indices: readonly [number, number, number, number]) => boolean,
  colourAt: (index: number) => readonly [number, number, number],
  yOffset: number,
): THREE.BufferGeometry {
  const n = tile.resolution;
  const spanX = tile.bounds.maxX - tile.bounds.minX;
  const spanZ = tile.bounds.maxZ - tile.bounds.minZ;
  const positions: number[] = [];
  const colours: number[] = [];
  const append = (index: number): void => {
    const ix = index % n;
    const iz = Math.floor(index / n);
    positions.push(
      tile.bounds.minX + ix / (n - 1) * spanX,
      heights[index] + yOffset,
      tile.bounds.minZ + iz / (n - 1) * spanZ,
    );
    const colour = colourAt(index);
    colours.push(colour[0], colour[1], colour[2]);
  };
  for (let iz = 0; iz < n - 1; iz++) {
    for (let ix = 0; ix < n - 1; ix++) {
      const a = iz * n + ix;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      const cell = [a, b, c, d] as const;
      if (!includeCell(cell) || cell.some((i) => !Number.isFinite(heights[i]))) continue;
      append(a); append(c); append(b);
      append(b); append(c); append(d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function driveColour(tile: ResolvedSubstrateTile, index: number): readonly [number, number, number] {
  if (tile.driveMaterial[index] === DRIVE_MATERIAL.ford) return colourTuple(0x7c7768);
  if (tile.driveMaterial[index] === DRIVE_MATERIAL.gravel) return colourTuple(0x777166);
  return colourTuple(0x343b3d);
}

function makeDrive(tile: ResolvedSubstrateTile, wireframe: boolean): THREE.Mesh {
  const geometry = makeLayerGeometry(
    tile,
    tile.driveY,
    (cell) => cell.every((i) => Number.isFinite(tile.driveY[i])),
    (index) => driveColour(tile, index),
    .035,
  );
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: tile.crossing.kind === 'ford' ? .88 : .76,
    metalness: 0,
    wireframe,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'resolved-drive';
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.renderOrder = 3;
  return mesh;
}

function waterColour(tile: ResolvedSubstrateTile, index: number): readonly [number, number, number] {
  const depth = clamp(tile.waterDepthM[index] / 2.4, 0, 1);
  const energy = tile.waterEnergy[index];
  const shallow = new THREE.Color(0x83a697);
  const deep = new THREE.Color(0x245b65);
  shallow.lerp(deep, depth);
  shallow.lerp(new THREE.Color(0xb6d5cc), energy * .22);
  return [shallow.r, shallow.g, shallow.b];
}

function makeWater(
  tile: ResolvedSubstrateTile,
  state: number,
  wireframe: boolean,
): THREE.Mesh {
  const geometry = makeLayerGeometry(
    tile,
    tile.waterY,
    (cell) => cell.every((i) => tile.waterState[i] === state),
    (index) => state === WATER_STATE.hidden ? colourTuple(0x55c9de) : waterColour(tile, index),
    state === WATER_STATE.hidden ? .02 : .055,
  );
  const material = state === WATER_STATE.hidden
    ? new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: .35,
      wireframe: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    : new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      opacity: .7,
      roughness: .18,
      metalness: .04,
      wireframe,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = state === WATER_STATE.hidden ? 'hidden-water' : 'exposed-water';
  mesh.renderOrder = state === WATER_STATE.hidden ? 6 : 5;
  return mesh;
}

function makeProductionHydro(field: HydroTileField): THREE.Mesh {
  const positions: number[] = [];
  const spanX = field.bounds.maxX - field.bounds.minX;
  const spanZ = field.bounds.maxZ - field.bounds.minZ;
  const index = (ix: number, iz: number): number =>
    ((iz + field.gutter) * field.width + ix + field.gutter) * 4;
  const append = (ix: number, iz: number): void => {
    const i = index(ix, iz);
    positions.push(
      field.bounds.minX + (ix + .5) / field.resolution * spanX,
      field.elevationBaseM + field.geometry[i + 2] + .08,
      field.bounds.minZ + (iz + .5) / field.resolution * spanZ,
    );
  };
  for (let iz = 0; iz < field.resolution - 1; iz++) {
    for (let ix = 0; ix < field.resolution - 1; ix++) {
      const a = index(ix, iz);
      const b = index(ix + 1, iz);
      const c = index(ix, iz + 1);
      const d = index(ix + 1, iz + 1);
      if (
        field.geometry[a] < .5
        || field.geometry[b] < .5
        || field.geometry[c] < .5
        || field.geometry[d] < .5
      ) continue;
      append(ix, iz); append(ix, iz + 1); append(ix + 1, iz);
      append(ix + 1, iz); append(ix, iz + 1); append(ix + 1, iz + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.MeshBasicMaterial({
    color: 0xf08ad6,
    transparent: true,
    opacity: .62,
    wireframe: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'production-hydro-shadow';
  mesh.renderOrder = 8;
  return mesh;
}

function makePebbles(tile: ResolvedSubstrateTile, density: number): THREE.Object3D {
  const candidates: Array<{
    x: number;
    y: number;
    z: number;
    scale: number;
    rotation: number;
    colour: THREE.Color;
  }> = [];
  const n = tile.resolution;
  const step = Math.max(2, Math.round(6 - density * 4));
  const spanX = tile.bounds.maxX - tile.bounds.minX;
  const spanZ = tile.bounds.maxZ - tile.bounds.minZ;
  for (let iz = 1; iz < n - 1; iz += step) {
    for (let ix = 1; ix < n - 1; ix += step) {
      const i = iz * n + ix;
      const zone = tile.groundMaterial[i];
      if (zone !== GROUND_MATERIAL.riverbed && zone !== GROUND_MATERIAL.bank) continue;
      const seed = hash(ix * 1.7, iz * 2.3);
      const zoneWeight = zone === GROUND_MATERIAL.riverbed ? 1 : .48;
      if (seed > density * zoneWeight) continue;
      const cellX = spanX / (n - 1);
      const cellZ = spanZ / (n - 1);
      const x = tile.bounds.minX + ix / (n - 1) * spanX + (hash(ix, iz + 9) - .5) * cellX * 2;
      const z = tile.bounds.minZ + iz / (n - 1) * spanZ + (hash(ix + 7, iz) - .5) * cellZ * 2;
      const scale = .13 + hash(ix + 3, iz + 5) * (
        tile.bedMaterial === 'rock' ? .72 : tile.bedMaterial === 'pebble' ? .34 : .2
      );
      candidates.push({
        x,
        y: tile.groundY[i] + scale * .22,
        z,
        scale,
        rotation: seed * Math.PI * 2,
        colour: new THREE.Color(zone === GROUND_MATERIAL.bank ? 0x82775f : 0x6d6b5d)
          .offsetHSL((seed - .5) * .035, 0, (seed - .5) * .11),
      });
    }
  }
  const group = new THREE.Group();
  group.name = 'material-pebbles';
  if (!candidates.length) return group;
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const material = new THREE.MeshStandardMaterial({
    roughness: 1,
    metalness: 0,
    flatShading: true,
    vertexColors: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, candidates.length);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    position.set(item.x, item.y, item.z);
    rotation.setFromEuler(new THREE.Euler(0, item.rotation, (hash(i, 4) - .5) * .3));
    scale.set(item.scale * 1.45, item.scale * .58, item.scale);
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, item.colour);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  group.add(mesh);
  return group;
}

function makeRocks(tile: ResolvedSubstrateTile, rockiness: number): THREE.Object3D {
  const candidates: Array<{ index: number; size: number; seed: number }> = [];
  const n = tile.resolution;
  for (let iz = 5; iz < n - 5; iz += 7) {
    for (let ix = 5; ix < n - 5; ix += 7) {
      const i = iz * n + ix;
      if (tile.waterState[i] !== WATER_STATE.exposed || tile.crossingId[i]) continue;
      const seed = hash(ix + 19, iz - 7);
      const energetic = .28 + tile.waterEnergy[i] * .5;
      if (seed > rockiness * energetic) continue;
      candidates.push({ index: i, size: .45 + hash(ix - 4, iz + 13) * 1.05, seed });
    }
  }
  const group = new THREE.Group();
  group.name = 'channel-rocks';
  if (!candidates.length) return group;
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0x5f625a,
    roughness: .98,
    metalness: 0,
    flatShading: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, candidates.length);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const spanX = tile.bounds.maxX - tile.bounds.minX;
  const spanZ = tile.bounds.maxZ - tile.bounds.minZ;
  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    const ix = item.index % n;
    const iz = Math.floor(item.index / n);
    position.set(
      tile.bounds.minX + ix / (n - 1) * spanX,
      tile.groundY[item.index] + item.size * .42,
      tile.bounds.minZ + iz / (n - 1) * spanZ,
    );
    rotation.setFromEuler(new THREE.Euler(item.seed * .18, item.seed * 6.2, item.seed * .24));
    scale.set(item.size * 1.1, item.size * .72, item.size * .9);
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

function makeFlow(tile: ResolvedSubstrateTile, density: number): FlowDisplay {
  const particles: FlowParticle[] = [];
  const n = tile.resolution;
  const spanX = tile.bounds.maxX - tile.bounds.minX;
  const spanZ = tile.bounds.maxZ - tile.bounds.minZ;
  const step = Math.max(3, Math.round(8 - density * 4));
  for (let iz = 2; iz < n - 2; iz += step) {
    for (let ix = 2; ix < n - 2; ix += step) {
      const i = iz * n + ix;
      if (tile.waterState[i] !== WATER_STATE.exposed) continue;
      const seed = hash(ix * 3.1, iz * 1.9);
      if (seed > .28 + density * .62) continue;
      const energy = tile.waterEnergy[i];
      particles.push({
        x: tile.bounds.minX + ix / (n - 1) * spanX,
        y: tile.waterY[i] + .11,
        z: tile.bounds.minZ + iz / (n - 1) * spanZ,
        flowX: tile.waterFlowX[i],
        flowZ: tile.waterFlowZ[i],
        speed: Math.max(.08, tile.waterSpeedMps[i]),
        energy,
        vorticity: tile.waterVorticity[i],
        phase: seed * 9,
        span: 2.5 + energy * 6,
      });
    }
  }
  const positions = new Float32Array(particles.length * 3);
  const colours = new Float32Array(particles.length * 3);
  for (let i = 0; i < particles.length; i++) {
    const colour = new THREE.Color(0xabc9c2).lerp(new THREE.Color(0xf4eee0), particles[i].energy);
    colours[i * 3] = colour.r;
    colours[i * 3 + 1] = colour.g;
    colours[i * 3 + 2] = colour.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const material = new THREE.PointsMaterial({
    size: .22 + density * .2,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: .82,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'flow-energy-vorticity';
  points.renderOrder = 7;
  return {
    points,
    update(timeS: number): void {
      const attribute = geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < particles.length; i++) {
        const particle = particles[i];
        const travel = ((timeS * particle.speed + particle.phase) % particle.span)
          - particle.span * .5;
        const swirl = Math.sin(timeS * (1.4 + particle.energy * 2.6) + particle.phase)
          * particle.vorticity * 2.2;
        attribute.setXYZ(
          i,
          particle.x + particle.flowX * travel - particle.flowZ * swirl,
          particle.y + Math.sin(timeS * 3 + particle.phase) * .025 * particle.energy,
          particle.z + particle.flowZ * travel + particle.flowX * swirl,
        );
      }
      attribute.needsUpdate = true;
    },
  };
}

function placeAlong(
  group: THREE.Object3D,
  x: number,
  z: number,
  tangent: readonly [number, number],
): void {
  group.position.x = x;
  group.position.z = z;
  group.rotation.y = -Math.atan2(tangent[1], tangent[0]);
}

function makeStructures(
  tile: ResolvedSubstrateTile,
  input: SubstrateTileInput,
  showHidden: boolean,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'resolved-structure';
  const crossing = tile.crossing;
  if (crossing.kind === 'bridge') {
    const local = new THREE.Group();
    placeAlong(local, crossing.x, crossing.z, crossing.roadTangent);
    const width = input.road.halfWidthM * 2 + .8;
    const deckMaterial = new THREE.MeshStandardMaterial({
      color: 0x565d5e,
      roughness: .78,
      metalness: .03,
    });
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(crossing.spanRoadM, .72, width),
      deckMaterial,
    );
    deck.position.y = crossing.roadDeckM - .36;
    deck.castShadow = deck.receiveShadow = true;
    local.add(deck);
    const railMaterial = new THREE.MeshStandardMaterial({
      color: 0x858e8e,
      roughness: .55,
      metalness: .18,
    });
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(crossing.spanRoadM, .12, .12),
        railMaterial,
      );
      rail.position.set(0, crossing.roadDeckM + .48, side * width * .5);
      local.add(rail);
    }
    group.add(local);
  } else if (crossing.kind === 'culvert') {
    const radius = clamp(input.water.depthM * .48, .42, 1.15);
    const length = crossing.spanWaterM + 3.5;
    const direction = new THREE.Vector3(
      crossing.waterTangent[0],
      0,
      crossing.waterTangent[1],
    ).normalize();
    const centreY = crossing.waterBedM + radius * .86;
    const pipeMaterial = new THREE.MeshStandardMaterial({
      color: 0x657174,
      roughness: .64,
      metalness: .18,
      transparent: !showHidden,
      opacity: showHidden ? .82 : .18,
      wireframe: showHidden,
    });
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, length, 24, 1, true),
      pipeMaterial,
    );
    pipe.position.set(crossing.x, centreY, crossing.z);
    pipe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    group.add(pipe);
    const ringGeometry = new THREE.TorusGeometry(radius, .13, 8, 24);
    const ringMaterial = new THREE.MeshStandardMaterial({
      color: 0x899392,
      roughness: .72,
      metalness: .12,
    });
    const ringRotation = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      direction,
    );
    for (const end of [-1, 1]) {
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.position.set(
        crossing.x + direction.x * length * .5 * end,
        centreY,
        crossing.z + direction.z * length * .5 * end,
      );
      ring.quaternion.copy(ringRotation);
      group.add(ring);
    }
  } else if (crossing.kind === 'causeway') {
    const local = new THREE.Group();
    placeAlong(local, crossing.x, crossing.z, crossing.roadTangent);
    const width = input.road.halfWidthM * 2 + input.road.shoulderM * 1.2;
    const height = Math.max(.5, crossing.roadDeckM - crossing.waterBedM);
    const material = new THREE.MeshStandardMaterial({
      color: 0x716852,
      roughness: .98,
      metalness: 0,
    });
    for (const side of [-1, 1]) {
      const face = new THREE.Mesh(
        new THREE.BoxGeometry(crossing.spanRoadM, height * .72, .45),
        material,
      );
      face.position.set(0, crossing.waterBedM + height * .36, side * width * .5);
      face.castShadow = face.receiveShadow = true;
      local.add(face);
    }
    group.add(local);
  }
  return group;
}

function makeVehicle(): THREE.Group {
  const vehicle = new THREE.Group();
  vehicle.name = 'contact-probe-vehicle';
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xc8753f,
    roughness: .64,
    metalness: .03,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x202527,
    roughness: .88,
    metalness: .02,
  });
  vehicle.userData.wheelMaterial = darkMaterial;
  vehicle.userData.wheelDryColour = darkMaterial.color.clone();
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.6, .72, 1.9), bodyMaterial);
  body.position.y = .75;
  body.castShadow = true;
  vehicle.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.55, .75, 1.65), bodyMaterial);
  cab.position.set(.5, 1.45, 0);
  cab.castShadow = true;
  vehicle.add(cab);
  const wheelGeometry = new THREE.CylinderGeometry(.42, .42, .3, 16);
  for (const x of [-1.15, 1.15]) {
    for (const z of [-1, 1]) {
      const wheel = new THREE.Mesh(wheelGeometry, darkMaterial);
      wheel.position.set(x, .42, z * .9);
      wheel.rotation.x = Math.PI * .5;
      wheel.castShadow = true;
      vehicle.add(wheel);
    }
  }
  return vehicle;
}

function makeWakePoints(): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(MAX_WAKE_STAMPS * 3), 3),
  );
  geometry.setAttribute(
    'color',
    new THREE.BufferAttribute(new Float32Array(MAX_WAKE_STAMPS * 3), 3),
  );
  geometry.setDrawRange(0, 0);
  const material = new THREE.PointsMaterial({
    size: .54,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: .9,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'wake-evidence';
  points.renderOrder = 9;
  return points;
}

function paintWake(points: THREE.Points, stamps: readonly WakeStamp[]): void {
  const positions = points.geometry.getAttribute('position') as THREE.BufferAttribute;
  const colours = points.geometry.getAttribute('color') as THREE.BufferAttribute;
  let count = 0;
  for (const stamp of stamps) {
    if (count >= MAX_WAKE_STAMPS) continue;
    const life = 1 - clamp(stamp.ageS / stamp.lifeS, 0, 1);
    positions.setXYZ(count, stamp.x, stamp.y, stamp.z);
    const colour = new THREE.Color(0xe8f0e9).lerp(new THREE.Color(0x6caaa4), 1 - life);
    colours.setXYZ(
      count,
      colour.r * (.35 + life * .65) * stamp.strength,
      colour.g * (.35 + life * .65) * stamp.strength,
      colour.b * (.35 + life * .65) * stamp.strength,
    );
    count++;
  }
  positions.needsUpdate = true;
  colours.needsUpdate = true;
  points.geometry.setDrawRange(0, count);
}

const RELATION_NOTE: Record<CrossingKind, string> = {
  bridge: 'deck support + open channel below; water exists, vehicle fluid contact does not',
  culvert: 'road fill + hidden continuous flow; the conduit mouths expose the hydraulic opening',
  ford: 'drive support and exposed water occupy the same x/z; wake and tyre carry are emitted',
  causeway: 'fill is explicit and the unresolved centre flow is marked blocked, not silently erased',
};

export async function startSubstrateLab(): Promise<void> {
  document.title = 'DRIVE · SUBSTRATE LAB';
  const style = document.createElement('style');
  style.textContent = `
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0a1112;color:#d7e3df;
      font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
    #substrate-canvas{position:fixed;inset:0;width:100%;height:100%;touch-action:none}
    .substrate-head{position:fixed;left:calc(var(--dials-w,272px) + 14px);top:14px;z-index:10;
      padding:8px 11px;background:#081012d9;border-left:3px solid #6cb7aa;pointer-events:none}
    .substrate-head b{color:#efc66b;letter-spacing:2px}.substrate-head span{display:block;color:#78908c;margin-top:2px}
    .substrate-back{position:fixed;right:12px;top:12px;z-index:10;color:#8ba19e;text-decoration:none;
      letter-spacing:2px;background:#081012d9;border:1px solid #263b3e;padding:6px 8px}
    #substrate-status{position:fixed;left:calc(var(--dials-w,272px) + 14px);bottom:14px;z-index:10;
      max-width:min(700px,calc(100vw - var(--dials-w,272px) - 42px));white-space:pre-wrap;
      padding:8px 11px;background:#081012df;border-left:3px solid #6cb7aa;color:#aebfbb}
    .substrate-legend{position:fixed;right:12px;bottom:12px;z-index:10;text-align:right;color:#718985;
      background:#081012c9;padding:7px 9px;pointer-events:none}
    @media(max-width:720px){.substrate-head{display:none}#substrate-status{font-size:9px;right:10px;
      max-width:none}.substrate-legend{display:none}}`;
  document.head.appendChild(style);

  const canvas = document.createElement('canvas');
  canvas.id = 'substrate-canvas';
  document.body.appendChild(canvas);
  const head = document.createElement('div');
  head.className = 'substrate-head';
  head.innerHTML = '<b>RESOLVED SUBSTRATE</b><span>one ground · drive · water · structure revision</span>';
  document.body.appendChild(head);
  const back = document.createElement('a');
  back.className = 'substrate-back';
  back.href = '../lab';
  back.textContent = 'ALL LABS';
  document.body.appendChild(back);
  const status = document.createElement('div');
  status.id = 'substrate-status';
  document.body.appendChild(status);
  const legend = document.createElement('div');
  legend.className = 'substrate-legend';
  legend.textContent = 'drag orbit · shift-drag pan · wheel zoom · H folds controls\n'
    + 'moving flecks = resolved flow energy / vorticity';
  document.body.appendChild(legend);

  const dials = createDials({
    slug: 'substrate',
    spec: [
      { id: 'sRelation', label: 'RELATION', kind: 'section', open: true },
      {
        id: 'crossing',
        label: 'CROSSING',
        kind: 'select',
        options: ['bridge', 'culvert', 'ford', 'causeway'],
        value: 'ford',
      },
      { id: 'roadWidth', label: 'ROAD WIDTH m', kind: 'range', min: 4, max: 15, step: .2, value: 8.4 },
      { id: 'riverWidth', label: 'RIVER WIDTH m', kind: 'range', min: 6, max: 30, step: .5, value: 16 },
      { id: 'bankWidth', label: 'BANK WIDTH m', kind: 'range', min: 2, max: 16, step: .5, value: 8 },
      { id: 'waterDepth', label: 'WATER DEPTH m', kind: 'range', min: .25, max: 2.8, step: .05, value: 1.15 },
      { id: 'clearance', label: 'BRIDGE CLEAR m', kind: 'range', min: .4, max: 5, step: .05, value: 2.35 },
      { id: 'approach', label: 'APPROACH m', kind: 'range', min: 5, max: 45, step: 1, value: 22 },
      { id: 'sAuthority', label: 'AUTHORITY / PARITY', kind: 'section', open: true },
      {
        id: 'authorityCase',
        label: 'PRODUCTION EVIDENCE',
        kind: 'select',
        options: ['matching', 'missing', 'procedural', 'unresolved'],
        value: 'matching',
      },
      { id: 'sWater', label: 'WATER / BED', kind: 'section', open: true },
      { id: 'flowSpeed', label: 'FLOW m/s', kind: 'range', min: .1, max: 5, step: .05, value: 1.25 },
      { id: 'roughness', label: 'ROUGHNESS', kind: 'range', min: 0, max: 1, step: .01, value: .58 },
      {
        id: 'regime',
        label: 'REGIME',
        kind: 'select',
        options: ['pool', 'run', 'riffle', 'rapid'],
        value: 'riffle',
      },
      {
        id: 'bedMaterial',
        label: 'BED',
        kind: 'select',
        options: ['silt', 'sand', 'gravel', 'pebble', 'rock'],
        value: 'pebble',
      },
      {
        id: 'bankMaterial',
        label: 'BANK',
        kind: 'select',
        options: ['soil', 'mud', 'gravel', 'rock'],
        value: 'gravel',
      },
      { id: 'sDisplay', label: 'DISPLAY', kind: 'section', open: true },
      { id: 'pebbles', label: 'PEBBLES', kind: 'range', min: 0, max: 1, step: .05, value: .72 },
      { id: 'rocks', label: 'ROCKS', kind: 'range', min: 0, max: 1, step: .05, value: .55 },
      { id: 'flowDetail', label: 'FLOW DETAIL', kind: 'range', min: 0, max: 1, step: .05, value: .75 },
      { id: 'compareHydro', label: 'PROD HYDRO', kind: 'toggle', value: true },
      { id: 'hidden', label: 'SHOW HIDDEN', kind: 'toggle', value: false },
      { id: 'wireframe', label: 'WIREFRAME', kind: 'toggle', value: false },
      { id: 'sVehicle', label: 'VEHICLE / EVIDENCE', kind: 'section', open: true },
      { id: 'drive', label: 'AUTO DRIVE', kind: 'toggle', value: true },
      { id: 'vehicleSpeed', label: 'SPEED m/s', kind: 'range', min: 1, max: 14, step: .25, value: 6 },
      { id: 'vehiclePosition', label: 'POSITION m', kind: 'range', min: -58, max: 58, step: .25, value: -45 },
      { id: 'evidence', label: 'LEAVE EVIDENCE', kind: 'toggle', value: true },
    ],
    source: (values) => [
      '// tuned in /lab/substrate',
      'makeCrossingFixture(' + JSON.stringify(values.crossing) + ', {',
      `  roadWidthM: ${values.roadWidth}, riverWidthM: ${values.riverWidth},`,
      `  bankWidthM: ${values.bankWidth}, waterDepthM: ${values.waterDepth},`,
      `  bridgeClearanceM: ${values.clearance}, approachM: ${values.approach},`,
      `  flowSpeedMps: ${values.flowSpeed}, roughness: ${values.roughness},`,
      `  regime: ${JSON.stringify(values.regime)},`,
      `  bedMaterial: ${JSON.stringify(values.bedMaterial)},`,
      `  bankMaterial: ${JSON.stringify(values.bankMaterial)},`,
      '});',
    ].join('\n'),
  });

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10191a);
  scene.fog = new THREE.FogExp2(0x10191a, .0075);
  const camera = new THREE.PerspectiveCamera(46, 1, .1, 600);
  const ambient = new THREE.HemisphereLight(0xc9ded6, 0x29302b, 2.1);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffe2ad, 3.2);
  sun.position.set(-52, 78, -38);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -90;
  sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90;
  sun.shadow.camera.bottom = -90;
  scene.add(sun);

  const target = new THREE.Vector3(0, 0, 0);
  let azimuth = -.72;
  let polar = .94;
  let distance = 108;
  const updateCamera = (): void => {
    const horizontal = Math.sin(polar) * distance;
    camera.position.set(
      target.x + Math.cos(azimuth) * horizontal,
      target.y + Math.cos(polar) * distance,
      target.z + Math.sin(azimuth) * horizontal,
    );
    camera.lookAt(target);
  };
  updateCamera();

  let pointer: { x: number; y: number; pan: boolean } | undefined;
  canvas.addEventListener('pointerdown', (event) => {
    pointer = { x: event.clientX, y: event.clientY, pan: event.shiftKey };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!pointer) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (pointer.pan) {
      const scale = distance * .0018;
      target.x += (Math.sin(azimuth) * dx - Math.cos(azimuth) * dy) * scale;
      target.z += (-Math.cos(azimuth) * dx - Math.sin(azimuth) * dy) * scale;
    } else {
      azimuth -= dx * .006;
      polar = clamp(polar + dy * .005, .22, 1.48);
    }
    updateCamera();
  });
  canvas.addEventListener('pointerup', () => { pointer = undefined; });
  canvas.addEventListener('pointercancel', () => { pointer = undefined; });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    distance = clamp(distance * Math.exp(event.deltaY * .001), 22, 240);
    updateCamera();
  }, { passive: false });
  canvas.addEventListener('dblclick', () => {
    target.set(0, 0, 0);
    azimuth = -.72;
    polar = .94;
    distance = 108;
    updateCamera();
  });

  const resize = (): void => {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();

  let tile: ResolvedSubstrateTile;
  let input: SubstrateTileInput;
  let productionHydroField: HydroTileField | undefined;
  let resolvedRoot = new THREE.Group();
  let flow: FlowDisplay;
  const vehicle = makeVehicle();
  scene.add(vehicle);
  const wakePoints = makeWakePoints();
  scene.add(wakePoints);
  const vehicleWater = new VehicleWaterEvidence(4);
  let vehicleWaterState: VehicleWaterEvidenceSnapshot = vehicleWater.snapshot();
  const vehicleWaterMarks = createVehicleWaterEvidenceRenderer();
  scene.add(vehicleWaterMarks.object3d);
  const wake: WakeStamp[] = [];
  let vehicleX = dials.num('vehiclePosition');
  let lastWakeX = vehicleX;
  let lastDrive = dials.bool('drive');
  let lastBuildSignature = '';

  const clearEvidence = (): void => {
    wake.length = 0;
    vehicleWater.reset();
    vehicleWaterState = vehicleWater.snapshot();
    lastWakeX = vehicleX;
    paintWake(wakePoints, wake);
    vehicleWaterMarks.update([], performance.now() * .001);
  };

  const buildSignature = (): string => JSON.stringify([
    dials.str('crossing'),
    dials.num('roadWidth'),
    dials.num('riverWidth'),
    dials.num('bankWidth'),
    dials.num('waterDepth'),
    dials.num('clearance'),
    dials.num('approach'),
    dials.num('flowSpeed'),
    dials.num('roughness'),
    dials.str('regime'),
    dials.str('bedMaterial'),
    dials.str('bankMaterial'),
    dials.num('pebbles'),
    dials.num('rocks'),
    dials.num('flowDetail'),
    dials.bool('compareHydro'),
    dials.bool('hidden'),
    dials.bool('wireframe'),
  ]);

  const rebuild = (): void => {
    const kind = dials.str('crossing') as CrossingKind;
    input = makeCrossingFixture(kind, {
      roadWidthM: dials.num('roadWidth'),
      riverWidthM: dials.num('riverWidth'),
      bankWidthM: dials.num('bankWidth'),
      waterDepthM: dials.num('waterDepth'),
      bridgeClearanceM: dials.num('clearance'),
      approachM: dials.num('approach'),
      flowSpeedMps: dials.num('flowSpeed'),
      roughness: dials.num('roughness'),
      regime: dials.str('regime') as WaterRegime,
      bedMaterial: dials.str('bedMaterial') as SubstrateTileInput['water']['bedMaterial'],
      bankMaterial: dials.str('bankMaterial') as SubstrateTileInput['water']['bankMaterial'],
    });
    tile = buildSubstrateTile(input);
    productionHydroField = dials.bool('compareHydro')
      ? buildProductionHydroFixture(input)
      : undefined;
    scene.remove(resolvedRoot);
    disposeTree(resolvedRoot);
    resolvedRoot = new THREE.Group();
    resolvedRoot.name = `substrate:${kind}`;
    resolvedRoot.add(makeGround(tile, dials.bool('wireframe')));
    resolvedRoot.add(makePebbles(tile, dials.num('pebbles')));
    resolvedRoot.add(makeRocks(tile, dials.num('rocks')));
    resolvedRoot.add(makeDrive(tile, dials.bool('wireframe')));
    resolvedRoot.add(makeStructures(tile, input, dials.bool('hidden')));
    resolvedRoot.add(makeWater(tile, WATER_STATE.exposed, dials.bool('wireframe')));
    if (productionHydroField) {
      resolvedRoot.add(makeProductionHydro(productionHydroField));
    }
    if (dials.bool('hidden')) {
      resolvedRoot.add(makeWater(tile, WATER_STATE.hidden, true));
    }
    flow = makeFlow(tile, dials.num('flowDetail'));
    resolvedRoot.add(flow.points);
    scene.add(resolvedRoot);
    target.y = tile.crossing.kind === 'bridge' ? 1.1 : .2;
    clearEvidence();
    lastBuildSignature = buildSignature();
  };

  let rebuildQueued = false;
  const queueRebuild = (): void => {
    if (rebuildQueued) return;
    rebuildQueued = true;
    requestAnimationFrame(() => {
      rebuildQueued = false;
      if (buildSignature() !== lastBuildSignature) rebuild();
    });
  };
  dials.onChange(queueRebuild);
  rebuild();

  const describe = (contact: SubstrateContact): string => {
    const kind = tile.crossing.kind;
    const authorityCase = dials.str('authorityCase');
    const matchingOutcome = kind === 'bridge' ? 'bridge-deck'
      : kind === 'culvert' ? 'culvert-built'
        : kind === 'ford' ? 'ford-fallback' : 'none';
    const explicitRoadTags: Readonly<Record<string, string>> | undefined =
      kind === 'bridge' ? { bridge: 'yes' }
      : kind === 'ford' ? { ford: 'yes' }
        : kind === 'causeway' ? { embankment: 'yes' } : undefined;
    const explicitWaterTags: Readonly<Record<string, string>> | undefined =
      kind === 'culvert' ? { tunnel: 'culvert' } : undefined;
    const productionCrossing = resolveProductionCrossing({
      roadId: input.road.id,
      waterId: input.water.id,
      x: tile.crossing.x,
      z: tile.crossing.z,
      radiusM: Math.max(tile.crossing.spanRoadM, tile.crossing.spanWaterM) * .5,
      roadTangent: tile.crossing.roadTangent,
      waterTangent: tile.crossing.waterTangent,
      roadHalfWidthM: input.road.halfWidthM,
      waterHalfWidthM: input.water.halfWidthM,
      roadLayer: authorityCase === 'matching' || authorityCase === 'missing'
        ? kind === 'bridge' ? 1 : 0
        : 0,
      roadTags: authorityCase === 'matching' || authorityCase === 'missing'
        ? explicitRoadTags
        : undefined,
      waterTags: authorityCase === 'matching' || authorityCase === 'missing'
        ? explicitWaterTags
        : undefined,
      deckY: tile.crossing.roadDeckM,
      waterBedY: tile.crossing.waterBedM,
      waterSurfaceY: tile.crossing.waterSurfaceM,
      availableClearanceM: tile.crossing.roadDeckM - tile.crossing.waterBedM,
      structureOutcome: authorityCase === 'matching'
        ? matchingOutcome
        : authorityCase === 'procedural'
          ? kind === 'culvert' ? 'culvert-built'
            : kind === 'ford' ? 'ford-fallback' : 'none'
          : 'none',
    });
    const water = contact.water
      ? `${contact.water.exposed ? 'EXPOSED' : 'HIDDEN'} ${contact.water.depthM.toFixed(2)}m`
        + ` · ${contact.water.speedMps === null ? 'speed ?' : `${contact.water.speedMps.toFixed(2)}m/s`}`
        + ` · E ${contact.water.energy === null ? '?' : contact.water.energy.toFixed(2)}`
      : contact.blockedWater ? 'BLOCKED' : 'NONE';
    const fluid = contact.fluid
      ? `${contact.fluid.depthAboveSupportM.toFixed(2)}m ABOVE SUPPORT`
      : 'NONE';
    const structure = contact.structure?.kind.toUpperCase() ?? 'NONE';
    const production = productionHydroField
      ? sampleHydroContactLayers(
        productionHydroField,
        contact.x,
        contact.z,
        contact.support,
      )
      : undefined;
    const canonicalVisibility = contact.blockedWater
      ? 'BLOCKED'
      : contact.water?.exposed ? 'EXPOSED' : contact.water ? 'HIDDEN' : 'NONE';
    const productionVisibility = production ? 'EXPOSED' : 'NONE';
    const levelDelta = production && contact.water
      ? `${(production.water.yM - contact.water.yM).toFixed(2)}m LEVEL Δ`
      : 'LEVEL Δ —';
    const productionFluid = production?.fluid
      ? `${production.fluid.depthAboveSupportM.toFixed(2)}m`
      : 'NONE';
    const productionLine = productionHydroField
      ? `\nPROD HYDRO ${productionVisibility} · CANON ${canonicalVisibility}`
        + ` · ${levelDelta} · SPEED ? · FLUID ${productionFluid}`
        + ' · MAGENTA WIREFRAME'
      : '';
    const earthwork = productionCrossing.kind === 'unresolved'
      ? 'WITHHELD · CONSERVATIVE ROAD PLUG'
      : productionCrossing.implementation === 'missing'
        ? 'WITHHELD · MISSING IMPLEMENTATION'
        : productionCrossing.kind === 'bridge'
          ? 'OPEN CHANNEL · NO ROAD FILL'
          : productionCrossing.kind === 'culvert'
            ? 'OPEN CHANNEL · ROAD EARTHWORK'
            : productionCrossing.kind === 'ford'
              ? 'OPEN CHANNEL · FORD SUPPORT'
              : 'SOLID FILL · CHANNEL BLOCKED';
    return `${tile.crossing.kind.toUpperCase()} · ${RELATION_NOTE[tile.crossing.kind]}\n`
      + `GROUND ${contact.ground.yM.toFixed(2)}m ${contact.ground.material.toUpperCase()}`
      + ` · DRIVE ${contact.drive ? `${contact.drive.yM.toFixed(2)}m ${contact.drive.material.toUpperCase()}` : 'NONE'}`
      + ` · WATER ${water}\n`
      + `SUPPORT ${contact.support.kind.toUpperCase()} ${contact.support.yM.toFixed(2)}m`
      + ` · FLUID CONTACT ${fluid} · STRUCTURE ${structure}`
      + ` · EVIDENCE W${wake.length} T${vehicleWaterState.activeTracks} D${vehicleWaterState.activeDrips}`
      + ` · TYRES ${(Math.max(...vehicleWaterState.tyreWetness) * 100).toFixed(0)}%`
      + ` · HULL ${(vehicleWaterState.hullWetness * 100).toFixed(0)}%`
      + `\nAUTH ${productionCrossing.kind.toUpperCase()} · ${productionCrossing.authority.toUpperCase()}`
      + ` · ${productionCrossing.implementation.toUpperCase()}`
      + ` · ${productionCrossing.evidence.join(' · ') || 'NO EVIDENCE'}`
      + `\nEARTHWORK ${earthwork}`
      + '\nPACKETS TERRAIN@BUILD · ROAD/DETAIL@REDRAPE · STRUCTURE@BUILD'
      + ' · SOURCE MESHES RETIRED AFTER COMMIT'
      + '\nATTRIBUTES TYPED + NORMALIZED · INTERLEAVED LAYOUTS PACKED LOSSLESSLY'
      + ' · STALE REVISIONS REFUSE WITHOUT DISCARD'
      + '\nCUTOVER GATES WET Δ <0.1% · DEPTH P95 ≤0.10m / MAX ≤0.25m'
      + ' · SUPPORT P95 ≤0.03m · SPEED + CROSSINGS RESOLVED'
      + productionLine;
  };

  let previousTime = performance.now() * .001;
  const tick = (timeMs: number): void => {
    const timeS = timeMs * .001;
    const dt = clamp(timeS - previousTime, 0, .05);
    previousTime = timeS;
    flow.update(timeS);

    const driving = dials.bool('drive');
    if (driving && !lastDrive) vehicleX = dials.num('vehiclePosition');
    if (driving) {
      vehicleX += dials.num('vehicleSpeed') * dt;
      if (vehicleX > 58) {
        vehicleX = -58;
        clearEvidence();
      }
    } else {
      vehicleX = dials.num('vehiclePosition');
    }
    lastDrive = driving;

    const contact = sampleSubstrate(tile, vehicleX, 0) ?? sampleSubstrate(tile, 0, 0)!;
    vehicle.position.set(vehicleX, contact.support.yM + .03, 0);
    const behind = sampleSubstrate(tile, clamp(vehicleX - 1.4, -70, 70), 0);
    const ahead = sampleSubstrate(tile, clamp(vehicleX + 1.4, -70, 70), 0);
    if (behind && ahead) {
      vehicle.rotation.z = Math.atan2(ahead.support.yM - behind.support.yM, 2.8);
    }

    if (!dials.bool('evidence')) {
      clearEvidence();
    } else {
      const wheelSamples: VehicleWaterWheelSample[] = [];
      for (const xOffset of [-1.15, 1.15]) {
        for (const z of [-.9, .9]) {
          const wheelContact = sampleSubstrate(tile, vehicleX + xOffset, z) ?? contact;
          wheelSamples.push({
            x: vehicleX + xOffset,
            z,
            yM: wheelContact.support.yM + .02,
            wet: !!wheelContact.fluid,
          });
        }
      }
      vehicleWaterState = vehicleWater.step({
        dt,
        timeSeconds: timeS,
        x: vehicleX,
        z: 0,
        vx: driving ? dials.num('vehicleSpeed') : 0,
        vz: 0,
        heading: Math.PI * .5,
        depthM: contact.fluid?.depthAboveSupportM ?? 0,
        inWater: !!contact.fluid,
        authority: 'substrate',
        wheels: wheelSamples,
      });
      if (driving && contact.fluid && Math.abs(vehicleX - lastWakeX) >= .58) {
        const wakeY = contact.fluid.yM + .1;
        for (const side of [-1, 0, 1]) {
          wake.push({
            x: vehicleX - 1.6 - hash(vehicleX, side) * 1.5,
            y: wakeY,
            z: side * .68 + (hash(side, vehicleX) - .5) * .38,
            ageS: 0,
            lifeS: 3.2 + hash(vehicleX + side, 2) * 2.3,
            strength: .45 + vehicleWaterState.wakeStrength * .55,
          });
        }
        lastWakeX = vehicleX;
      }
    }
    for (const stamp of wake) stamp.ageS += dt;
    for (let i = wake.length - 1; i >= 0; i--) {
      if (wake[i].ageS >= wake[i].lifeS) wake.splice(i, 1);
    }
    if (wake.length > MAX_WAKE_STAMPS) wake.splice(0, wake.length - MAX_WAKE_STAMPS);
    paintWake(wakePoints, wake);
    vehicleWaterMarks.update(vehicleWater.activeStamps(timeS), timeS);
    const wheelMaterial = vehicle.userData.wheelMaterial as THREE.MeshStandardMaterial;
    const dryColour = vehicle.userData.wheelDryColour as THREE.Color;
    const tyreWetness = Math.max(...vehicleWaterState.tyreWetness);
    wheelMaterial.color.copy(dryColour).lerp(new THREE.Color(0x05090b), tyreWetness * .8);
    status.textContent = describe(contact);

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
