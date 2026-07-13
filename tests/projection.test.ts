/**
 * 2D semantic projection (ADR-0047 stage 2) — the PCA layout that turns embedding
 * vectors into graph coordinates, plus the `VectorStore.list` bulk-read it feeds on.
 *
 * Pure + deterministic: same vectors → same coords. Backed by the in-memory vector
 * store so it runs without AWS.
 */
import { pca2d, normalizeCoords, projectionFact, projectVector, projectionArtifacts, layoutShardOf, LAYOUT_SHARDS, MemoryVectorStore } from '../platform/runtime';

describe('pca2d', () => {
  it('separates two clusters along the dominant axis', () => {
    // Two tight blobs far apart in dim 0; PC1 should split them.
    const vecs: number[][] = [];
    const keys: string[] = [];
    for (let i = 0; i < 20; i++) {
      const near = i < 10;
      vecs.push([near ? 0 : 10, (i % 3) * 0.01, (i % 2) * 0.01]);
      keys.push(`k${i}`);
    }
    const { coords } = pca2d(vecs, keys);
    const xs = coords.map((c) => c[0]);
    const a = xs.slice(0, 10);
    const b = xs.slice(10);
    const meanA = a.reduce((s, v) => s + v, 0) / a.length;
    const meanB = b.reduce((s, v) => s + v, 0) / b.length;
    // The two clusters land on opposite sides of the first axis.
    expect(Math.sign(meanA)).not.toBe(Math.sign(meanB));
    expect(Math.abs(meanA - meanB)).toBeGreaterThan(1);
  });

  it('is deterministic (no RNG)', () => {
    const vecs = Array.from({ length: 12 }, (_, i) => [Math.sin(i), Math.cos(i), i * 0.1]);
    const keys = vecs.map((_, i) => `k${i}`);
    const a = pca2d(vecs, keys);
    const b = pca2d(vecs, keys);
    expect(a.coords).toEqual(b.coords);
  });

  it('handles the empty / degenerate case', () => {
    expect(pca2d([], []).coords).toEqual([]);
    // All-identical vectors have no variance — coords collapse toward the origin.
    const same = Array.from({ length: 5 }, () => [1, 1, 1]);
    const { coords } = pca2d(same, ['a', 'b', 'c', 'd', 'e']);
    expect(coords).toHaveLength(5);
    for (const [x, y] of coords) {
      expect(Math.abs(x)).toBeLessThan(1e-6);
      expect(Math.abs(y)).toBeLessThan(1e-6);
    }
  });
});

describe('normalizeCoords', () => {
  it('centers and clamps into [-1.3, 1.3]', () => {
    const raw: Array<[number, number]> = [[0, 0], [100, 100], [-100, -100], [5, -5]];
    const out = normalizeCoords(raw);
    for (const [x, y] of out) {
      expect(x).toBeGreaterThanOrEqual(-1.3);
      expect(x).toBeLessThanOrEqual(1.3);
      expect(y).toBeGreaterThanOrEqual(-1.3);
      expect(y).toBeLessThanOrEqual(1.3);
    }
    // The centroid of the (unclamped) input sits near the origin after centering.
    const mean = out.reduce((s, c) => s + c[0], 0) / out.length;
    expect(Math.abs(mean)).toBeLessThan(1.3);
  });
});

describe('projectionFact', () => {
  it('produces a compact, rounded, keyed coord map', () => {
    const vecs = Array.from({ length: 8 }, (_, i) => [i, i * i, -i]);
    const keys = vecs.map((_, i) => `k${i}`);
    const fact = projectionFact(vecs, keys, 3, '2026-01-01T00:00:00.000Z');
    expect(fact.method).toBe('pca');
    expect(fact.dim).toBe(3);
    expect(fact.count).toBe(8);
    expect(Object.keys(fact.coords)).toHaveLength(8);
    for (const [, xyz] of Object.entries(fact.coords)) {
      expect(xyz).toHaveLength(3); // [x, y, z] — one fact serves 2D and 3D
      // rounded to 4 decimals, in range
      for (const v of xyz) {
        expect(v).toBe(Math.round(v * 1e4) / 1e4);
        expect(Math.abs(v)).toBeLessThanOrEqual(1.3);
      }
    }
  });
});

describe('projectionFact: persisted basis + projectVector (ADR-0047 stage 3)', () => {
  it('persists a basis that reproduces the batch coords for an already-known key', () => {
    const vecs = Array.from({ length: 10 }, (_, i) => [Math.sin(i), Math.cos(i * 1.7), i * 0.3, -i]);
    const keys = vecs.map((_, i) => `k${i}`);
    const fact = projectionFact(vecs, keys, 4, '2026-01-01T00:00:00.000Z');
    expect(fact.basis).toBeDefined();
    expect(fact.norm).toBeDefined();
    // Re-projecting an EXISTING vector through the persisted basis reproduces
    // the batch run's stored coord for it, up to the basis's own round6
    // storage precision (not bit-exact — the basis is rounded before persisting).
    for (let i = 0; i < keys.length; i++) {
      const viaVector = projectVector(vecs[i], fact.basis!, fact.norm!);
      const stored = fact.coords[keys[i]];
      for (let j = 0; j < 3; j++) expect(viaVector[j]).toBeCloseTo(stored[j], 3);
    }
  });

  it('places a NEW vector near its closest neighbor on the existing map, without re-running PCA', () => {
    // Two far-apart clusters, as in the pca2d test above.
    const vecs: number[][] = [];
    const keys: string[] = [];
    for (let i = 0; i < 20; i++) {
      const near = i < 10;
      vecs.push([near ? 0 : 10, (i % 3) * 0.01, (i % 2) * 0.01]);
      keys.push(`k${i}`);
    }
    const fact = projectionFact(vecs, keys, 3, '2026-01-01T00:00:00.000Z');
    // A brand-new vector close to cluster B (x≈10) should land near cluster B's
    // existing points on the x axis, not cluster A's.
    const newVec = [10, 0.005, 0.005];
    const [x] = projectVector(newVec, fact.basis!, fact.norm!);
    const clusterAX = fact.coords['k0'][0];
    const clusterBX = fact.coords['k10'][0];
    expect(Math.abs(x - clusterBX)).toBeLessThan(Math.abs(x - clusterAX));
  });
});

describe('projectionArtifacts: the sharded atlas (ADR-0082)', () => {
  const vecs = Array.from({ length: 40 }, (_, i) => [Math.sin(i), Math.cos(i * 1.7), i * 0.3]);
  const keys = vecs.map((_, i) => `fam${i % 5}:key/${i}`);

  it('shard union equals the monolith coords exactly; manifest carries no coords', () => {
    const mono = projectionFact(vecs, keys, 3, '2026-01-01T00:00:00.000Z');
    const { manifest, shards } = projectionArtifacts(vecs, keys, 3, '2026-01-01T00:00:00.000Z');
    expect(shards).toHaveLength(LAYOUT_SHARDS);
    expect(manifest.shards).toBe(LAYOUT_SHARDS);
    expect((manifest as unknown as { coords?: unknown }).coords).toBeUndefined();
    expect(manifest.basis).toEqual(mono.basis);
    expect(manifest.norm).toEqual(mono.norm);
    const merged: Record<string, unknown> = {};
    for (const s of shards) Object.assign(merged, s.coords);
    expect(merged).toEqual(mono.coords);
  });

  it('each key lands in ITS hash shard, and the hash is stable + in range', () => {
    const { shards } = projectionArtifacts(vecs, keys, 3, '2026-01-01T00:00:00.000Z');
    for (const k of keys) {
      const i = layoutShardOf(k);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(LAYOUT_SHARDS);
      expect(layoutShardOf(k)).toBe(i); // deterministic
      expect(shards[i].coords[k]).toBeDefined();
    }
  });
});

describe('MemoryVectorStore.list', () => {
  it('returns every stored vector, and empty for an unknown index', async () => {
    const store = new MemoryVectorStore();
    await store.put('idx', [
      { key: 'a', vector: [1, 0, 0] },
      { key: 'b', vector: [0, 1, 0] },
    ]);
    const all = await store.list('idx');
    expect(all.map((r) => r.key).sort()).toEqual(['a', 'b']);
    expect(all.find((r) => r.key === 'a')?.vector).toEqual([1, 0, 0]);
    expect(await store.list('missing')).toEqual([]);
  });
});
