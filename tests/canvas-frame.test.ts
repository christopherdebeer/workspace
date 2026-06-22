import { regionBBox, fitRegion, frameCamera, matchesRegionQuery, type Placed } from '../cells/canvas/shared/frame';

/**
 * Frame viewport resolver (ADR-0015): region → bbox → camera, screen-independent.
 */
const els: Placed[] = [
  { key: 'el:a', type: 'text', tags: ['cluster:arch'], x: 0, y: 0, width: 100, height: 100 },
  { key: 'el:b', type: 'text', tags: ['cluster:arch'], x: 400, y: 0, width: 100, height: 100 },
  { key: 'el:c', type: 'img', tags: ['gallery'], x: 2000, y: 2000, width: 200, height: 200, scale: 2 },
];

describe('regionBBox', () => {
  it('anchored bbox passes through', () => {
    expect(regionBBox({ kind: 'bbox', minX: 1, minY: 2, maxX: 3, maxY: 4 }, els)).toEqual({ minX: 1, minY: 2, maxX: 3, maxY: 4 });
  });

  it('members region = bbox of the named elements (x,y are centres)', () => {
    // el:a centre (0,0) 100×100 → [-50,-50,50,50]; el:b centre (400,0) → [350,-50,450,50]
    expect(regionBBox({ kind: 'members', members: ['el:a', 'el:b'] }, els)).toEqual({ minX: -50, minY: -50, maxX: 450, maxY: 50 });
  });

  it('members region honours per-element scale in the half-extents', () => {
    // el:c centre (2000,2000) 200×200 scale 2 → half-extent 200 → [1800,1800,2200,2200]
    expect(regionBBox({ kind: 'members', members: ['el:c'] }, els)).toEqual({ minX: 1800, minY: 1800, maxX: 2200, maxY: 2200 });
  });

  it('query region = bbox of matching elements (intensional, follows content)', () => {
    expect(regionBBox({ kind: 'query', query: { tag: 'cluster:arch' } }, els)).toEqual({ minX: -50, minY: -50, maxX: 450, maxY: 50 });
    expect(regionBBox({ kind: 'query', query: { type: 'img' } }, els)).toEqual({ minX: 1800, minY: 1800, maxX: 2200, maxY: 2200 });
  });

  it('derived region matching nothing → null (caller fits-all)', () => {
    expect(regionBBox({ kind: 'members', members: ['el:missing'] }, els)).toBeNull();
    expect(regionBBox({ kind: 'query', query: { type: 'nope' } }, els)).toBeNull();
  });
});

describe('fitRegion (screen-independent camera)', () => {
  it('centres the region and the SAME region yields a bigger scale on a bigger screen', () => {
    const bbox = { minX: -50, minY: -50, maxX: 450, maxY: 50 };
    const phone = fitRegion(bbox, 390, 800, 0); // no padding for exact math
    const wall = fitRegion(bbox, 2000, 1200, 0);
    // region centre is (200, 0) → camera keeps it at screen centre
    expect(phone.tx).toBeCloseTo(390 / 2 - phone.scale * 200, 5);
    expect(phone.ty).toBeCloseTo(800 / 2 - phone.scale * 0, 5);
    // a bigger screen frames the same region at a larger scale (device-independence)
    expect(wall.scale).toBeGreaterThan(phone.scale);
  });

  it('caps zoom-in on a tiny region (maxScale)', () => {
    const tiny = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(fitRegion(tiny, 1000, 1000, 0, 2).scale).toBe(2);
  });

  it('frameCamera runs the whole pipeline and is null on empty', () => {
    const cam = frameCamera({ kind: 'query', query: { tag: 'gallery' } }, els, 1000, 800);
    expect(cam && cam.scale).toBeGreaterThan(0);
    expect(frameCamera({ kind: 'members', members: ['nope'] }, els, 1000, 800)).toBeNull();
  });
});

describe('matchesRegionQuery', () => {
  it('ANDs type/tag/prefix', () => {
    const e = els[0];
    expect(matchesRegionQuery(e, { type: 'text', tag: 'cluster:arch' })).toBe(true);
    expect(matchesRegionQuery(e, { type: 'img' })).toBe(false);
    expect(matchesRegionQuery(e, { prefix: 'el:' })).toBe(true);
  });
});
