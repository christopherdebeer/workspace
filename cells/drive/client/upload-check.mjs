import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const THREE=require('three'), esbuild=require('esbuild');
const {WebGLAttributes}=await import('three/src/renderers/webgl/WebGLAttributes.js');
const {WebGLObjects}=await import('three/src/renderers/webgl/WebGLObjects.js');
const ctx={module:{exports:{}},exports:{}};
vm.runInNewContext(esbuild.transformSync(fs.readFileSync(new URL('./render-work.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,ctx);
const {uploadPrefix}=ctx.module.exports;
for(const isWebGL2 of [false,true]) {
  const sent=[],deleted=[];
  const gl={ARRAY_BUFFER:1,FLOAT:2,createBuffer:()=>({}),bindBuffer:()=>{},
    bufferData:(kind,array)=>sent.push(array.byteLength),
    bufferSubData:(kind,start,array,offset,count)=>sent.push(count===undefined?array.byteLength:count*4),
    deleteBuffer:buffer=>deleted.push(buffer)};
  const attrs=WebGLAttributes(gl,{isWebGL2});
  const info={render:{frame:0}};
  const objects=WebGLObjects(gl,{get:(o,g)=>g,update:()=>{}},attrs,info);
  const m=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),1024);
  m.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(1024*3),3);
  objects.update(m);assert.deepEqual(sent,[65536,12288]);sent.length=0;
  uploadPrefix(m.instanceMatrix,10);uploadPrefix(m.instanceColor,10);
  info.render.frame++;objects.update(m);assert.deepEqual(sent,[640,120]);sent.length=0;
  uploadPrefix(m.instanceMatrix,0);uploadPrefix(m.instanceColor,0);
  info.render.frame++;objects.update(m);assert.deepEqual(sent,[]);
  uploadPrefix(m.instanceMatrix,30);uploadPrefix(m.instanceMatrix,5);
  info.render.frame++;objects.update(m);assert.deepEqual(sent,[320]);sent.length=0;
  // Mesh growth: release existing GPU buffers while retaining shared geometry.
  const oldGeo=m.geometry,oldMat=m.material;
  m.dispose();assert.equal(deleted.length,2);
  m.instanceMatrix=new THREE.InstancedBufferAttribute(new Float32Array(2048*16),16);
  m.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(2048*3),3);
  info.render.frame++;objects.update(m);
  assert.deepEqual(sent,[131072,24576]);assert.equal(m.geometry,oldGeo);assert.equal(m.material,oldMat);
  m.dispose();assert.equal(deleted.length,4);
}
console.log('PASS: real three r160 WebGLAttributes/WebGLObjects, WebGL1+2 upload byte counts, pending refills, empty populations and buffer disposal/recreation');
