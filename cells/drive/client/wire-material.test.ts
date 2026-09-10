import { strict as assert } from 'node:assert';
import * as THREE from 'three';
import { createWireMaterialPolicy } from './wire-material';
const policy = createWireMaterialPolicy();
const material = new THREE.MeshLambertMaterial({ flatShading: true, vertexColors: true });
const hook = material.onBeforeCompile;
policy.apply(material, true);
assert(material.wireframe);
assert.equal(material.flatShading, false);
assert.equal(material.onBeforeCompile, hook);
assert(material.vertexColors);
const version = material.version;
policy.apply(material, true);
assert.equal(material.version, version);
policy.apply(material, false);
assert.equal(material.wireframe, false);
assert(material.flatShading);
for (const protectedMaterial of [
  new THREE.ShaderMaterial(),
  new THREE.MeshLambertMaterial({ transparent: true }),
  new THREE.MeshLambertMaterial({ alphaTest: 0.5 }),
]) {
  policy.apply(protectedMaterial, true);
  assert.equal(protectedMaterial.wireframe, false);
  protectedMaterial.dispose();
}
policy.apply(material, true);
policy.apply(material, true, true);
assert.equal(material.wireframe, false);
assert(material.flatShading);
material.wireframe = true;
policy.apply(material, true);
policy.apply(material, false);
assert(material.wireframe);
material.dispose();
console.log('wire material policy: protection and restoration pass');
