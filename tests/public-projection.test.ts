/**
 * ADR-0092 Inc 1+2 — the audience-safe public projection (`_home/embed2d.pub`)
 * and the owner-scoped client seat lookup.
 *
 * Covers the invariant end to end: a key no `_public/` pattern covers can never
 * enter the public artifact (write-time filter, incremental patch, and stream
 * rebuild), the artifact is coords-only (no basis/norm — A2), share/unshare
 * stream events trigger the rebuild (A3), and the client lookup is owner-scoped
 * (A1 — never a flat key strip).
 */
import { DynamoDB } from 'aws-sdk';
import {
  createObservedState,
  createMemoryStateStore,
  MemoryVectorStore,
  HashingEmbedder,
  indexForScope,
  projectionArtifacts,
  projectionFact,
  publicLayout,
  publicPatternCovers,
  LAYOUT_KEY,
  PUB_LAYOUT_KEY,
  layoutShardKey,
  type PublicLayout,
} from '../platform/runtime';
import { createMemoryGrantStore } from '../services/workspace/grants';
import { createSearchCommands } from '../services/workspace/commands-search';
import { createSharingCommands } from '../services/workspace/commands-sharing';
import { publicShareChanges, patchPublicProjection, rebuildPublicProjection } from '../services/vector-indexer/handler';
import { lookupCoord } from '../cells/home/client/graph/seats';
import type { ServiceContext } from '../platform/runtime';

/** A minimal ServiceContext for a caller (mirrors workspace.test.ts). */
function ctxFor(user: string | null, scopes: string[] = ['workspace:write', 'workspace:read']): ServiceContext {
  return {
    identity: user ? { user, scopes } : null,
    config: { tableName: 'unused-in-memory' },
    events: { emit: async () => undefined },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as ServiceContext;
}

describe('publicPatternCovers + publicLayout (the write-time boundary)', () => {
  it('covers whole-slice, prefix, and exact patterns', () => {
    expect(publicPatternCovers('*', 'anything/at/all')).toBe(true);
    expect(publicPatternCovers('docs/*', 'docs/adr/1')).toBe(true);
    expect(publicPatternCovers('docs/*', 'notes/1')).toBe(false);
    expect(publicPatternCovers('doc:x', 'doc:x')).toBe(true);
    expect(publicPatternCovers('doc:x', 'doc:xy')).toBe(false);
  });

  it('filters coords to covered keys ONLY and carries no basis/norm', () => {
    const coords: Record<string, [number, number, number]> = {
      'docs/pub-1': [0.1, 0.2, 0.3],
      'docs/pub-2': [0.4, 0.5, 0.6],
      'medical/private': [0.7, 0.8, 0.9],
    };
    const pub = publicLayout(coords, ['docs/*'], '2026-07-22T00:00:00.000Z');
    expect(Object.keys(pub.coords).sort()).toEqual(['docs/pub-1', 'docs/pub-2']);
    expect(pub.count).toBe(2);
    expect('medical/private' in pub.coords).toBe(false);
    expect((pub as unknown as Record<string, unknown>).basis).toBeUndefined();
    expect((pub as unknown as Record<string, unknown>).norm).toBeUndefined();
  });

  it('no patterns → empty coords (no keys leak through an empty filter)', () => {
    const pub = publicLayout({ k: [0, 0, 0] }, [], 't');
    expect(pub.coords).toEqual({});
    expect(pub.count).toBe(0);
  });
});

describe('project writes the public projection beside the atlas (ADR-0092 Inc 2)', () => {
  it('filters to `_public/` patterns, auto-shares the artifact, and stays coords-only', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    const grants = createMemoryGrantStore();
    const embedder = new HashingEmbedder(16);
    const vstore = new MemoryVectorStore();
    const cmds = createSearchCommands(() => ({ state, grants, vectors: { store: vstore, embedder }, store }));

    // A slice with two public docs and one private fact, already embedded.
    const index = indexForScope('alice', embedder.dimension);
    const texts = ['public doc one about gardens', 'public doc two about gardens', 'private medical note'];
    const keys = ['docs/one', 'docs/two', 'medical/note'];
    const vecs = await embedder.embed(texts);
    await vstore.put(index, keys.map((k, i) => ({ key: k, vector: vecs[i] })));
    // The `_public/` reflection `share {to:"public", key:"docs/*"}` writes.
    await state.put({ scope: 'alice', key: '_public/docs/*', value: { pattern: 'docs/*' }, type: 'public-share' });

    const res = await cmds.project(undefined, ctxFor('alice', ['workspace:admin']));
    expect(res.status).toBe('ok');
    expect(res.publicCount).toBe(2);

    const pub = (await state.get('alice', PUB_LAYOUT_KEY))!.value as PublicLayout;
    expect(Object.keys(pub.coords).sort()).toEqual(['docs/one', 'docs/two']);
    expect('medical/note' in pub.coords).toBe(false);
    expect((pub as unknown as Record<string, unknown>).basis).toBeUndefined(); // A2: coords-only
    expect(pub.patterns).toContain('docs/*');

    // Auto-share: the artifact itself is granted to `public` + reflected.
    const byOwner = await grants.listByOwner('alice');
    expect(byOwner.some((g) => g.grantee === 'public' && g.key === PUB_LAYOUT_KEY && g.mode === 'read')).toBe(true);
    expect(await state.get('alice', `_public/${PUB_LAYOUT_KEY}`)).not.toBeNull();
  });

  it('with no public patterns: writes an empty artifact and grants nothing', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    const grants = createMemoryGrantStore();
    const embedder = new HashingEmbedder(16);
    const vstore = new MemoryVectorStore();
    const cmds = createSearchCommands(() => ({ state, grants, vectors: { store: vstore, embedder }, store }));
    const vecs = await embedder.embed(['a', 'b', 'c']);
    await vstore.put(indexForScope('bob', 16), ['k1', 'k2', 'k3'].map((k, i) => ({ key: k, vector: vecs[i] })));

    const res = await cmds.project(undefined, ctxFor('bob', ['workspace:admin']));
    expect(res.publicCount).toBe(0);
    const pub = (await state.get('bob', PUB_LAYOUT_KEY))!.value as PublicLayout;
    expect(pub.coords).toEqual({});
    expect(await grants.listByOwner('bob')).toEqual([]);
  });
});

describe('vector-indexer public-projection lanes (ADR-0092 A3)', () => {
  const M = (obj: Record<string, unknown>) => DynamoDB.Converter.marshall(obj);

  it('publicShareChanges: detects `_public/` writes, supersedes, and removes — and nothing else', () => {
    const scopes = publicShareChanges({
      Records: [
        { eventName: 'INSERT', dynamodb: { NewImage: M({ sk: 'KEY#_public/docs/*', scope: 'alice', key: '_public/docs/*', value: { pattern: 'docs/*' } }) } },
        // unshare = supersede of the reflection
        { eventName: 'MODIFY', dynamodb: { NewImage: M({ sk: 'KEY#_public/notes/*', scope: 'bob', key: '_public/notes/*', superseded: true }), OldImage: M({ sk: 'KEY#_public/notes/*', scope: 'bob', key: '_public/notes/*' }) } },
        // an ordinary fact — not a share change
        { eventName: 'INSERT', dynamodb: { NewImage: M({ sk: 'KEY#docs/x', scope: 'carol', key: 'docs/x', value: 'hi' }) } },
      ],
    });
    expect([...scopes].sort()).toEqual(['alice', 'bob']);
  });

  /** Seed a sharded atlas + `_public/` reflections into a memory store. */
  async function seedAtlas(patterns: string[]) {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    const vecs = Array.from({ length: 8 }, (_, i) => [Math.sin(i), Math.cos(i * 1.7), i * 0.3]);
    const keys = ['docs/a', 'docs/b', 'docs/c', 'notes/d', 'notes/e', 'medical/f', 'medical/g', 'plan/h'];
    const { manifest, shards } = projectionArtifacts(vecs, keys, 3, '2026-07-22T00:00:00.000Z');
    await Promise.all(shards.map((s, i) => state.put({ scope: 'alice', key: layoutShardKey(i), value: s, type: 'graph-layout-shard' })));
    await state.put({ scope: 'alice', key: LAYOUT_KEY, value: manifest, type: 'graph-layout' });
    for (const p of patterns) await state.put({ scope: 'alice', key: `_public/${p}`, value: { pattern: p }, type: 'public-share' });
    return { store, state, manifest };
  }

  it('rebuildPublicProjection: merges the shard atlas, filters by CURRENT patterns, coords-only', async () => {
    const { store, state } = await seedAtlas(['docs/*', 'plan/h']);
    await rebuildPublicProjection(store, 'alice');
    const pub = (await state.get('alice', PUB_LAYOUT_KEY))!.value as PublicLayout;
    expect(Object.keys(pub.coords).sort()).toEqual(['docs/a', 'docs/b', 'docs/c', 'plan/h']);
    expect(pub.patterns.sort()).toEqual(['docs/*', 'plan/h']);
    expect((pub as unknown as Record<string, unknown>).basis).toBeUndefined();
  });

  it('rebuildPublicProjection: an unshare (superseded reflection) drops the retracted keys', async () => {
    const { store, state } = await seedAtlas(['docs/*', 'notes/*']);
    await rebuildPublicProjection(store, 'alice');
    await state.supersede('alice', '_public/notes/*', null, undefined, {});
    await rebuildPublicProjection(store, 'alice');
    const pub = (await state.get('alice', PUB_LAYOUT_KEY))!.value as PublicLayout;
    expect(Object.keys(pub.coords).sort()).toEqual(['docs/a', 'docs/b', 'docs/c']);
    expect(pub.patterns).toEqual(['docs/*']);
  });

  it('patchPublicProjection: a covered put enters, an uncovered one NEVER does, a remove drops', async () => {
    const { store, state } = await seedAtlas(['docs/*']);
    await rebuildPublicProjection(store, 'alice');
    await patchPublicProjection(
      store,
      'alice',
      [
        { key: 'docs/new', vector: [0.5, 0.5, 0.5] },
        { key: 'medical/new', vector: [0.6, 0.6, 0.6] }, // not covered — the boundary
      ],
      ['docs/a'],
    );
    const pub = (await state.get('alice', PUB_LAYOUT_KEY))!.value as PublicLayout;
    expect('docs/new' in pub.coords).toBe(true);
    expect('medical/new' in pub.coords).toBe(false);
    expect('docs/a' in pub.coords).toBe(false);
    expect(pub.count).toBe(Object.keys(pub.coords).length);
  });

  it('patchPublicProjection: silent no-op when no `.pub` exists yet (project()/rebuild creates it)', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    const fact = projectionFact([[1, 0, 0], [0, 1, 0], [0, 0, 1]], ['a', 'b', 'c'], 3, 't');
    await state.put({ scope: 'alice', key: LAYOUT_KEY, value: fact, type: 'graph-layout' });
    await expect(patchPublicProjection(store, 'alice', [{ key: 'a', vector: [1, 0, 0] }], [])).resolves.toBeUndefined();
    expect(await store.get('alice', PUB_LAYOUT_KEY)).toBeNull();
  });
});

describe('shared.receiving is the APPLICABLE grant set (owner discovery for the client)', () => {
  it('a viewer holding only `public` grants still learns the granting owners', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    const grants = createMemoryGrantStore();
    const cmds = createSharingCommands(() => ({ state, grants }));
    await cmds.share({ to: 'public', key: 'docs/*' }, ctxFor('alice'));
    // `guest` has no direct grants — only the public fold applies.
    const view = await cmds.shared(undefined, ctxFor('guest'));
    expect(view.receiving.some((g) => g.owner === 'alice' && g.grantee === 'public' && g.key === 'docs/*')).toBe(true);
  });
});

describe('lookupCoord (ADR-0092 Inc 1 — owner-scoped, never a flat strip)', () => {
  const own = { 'file/docs/x.md': [1, 0, 0], 'note/1': [0, 1, 0] };
  const pub = { c15r: { 'file/docs/x.md': [0, 0, 1], 'doc:y': [0.5, 0.5, 0] } };

  it('own keys resolve exactly, even when they contain slashes', () => {
    expect(lookupCoord('file/docs/x.md', own, pub)).toEqual([1, 0, 0]);
  });

  it('a folded owner/key seats from THAT owner map under the bare key', () => {
    expect(lookupCoord('c15r/file/docs/x.md', own, pub)).toEqual([0, 0, 1]);
    expect(lookupCoord('c15r/doc:y', own, pub)).toEqual([0.5, 0.5, 0]);
  });

  it('an unknown owner segment falls through to undefined (golden-spiral fallback), never a strip', () => {
    // `file/…` looks owner-shaped but `file` holds no public map — a flat strip
    // would have mis-seated this from someone else's basis (A1).
    expect(lookupCoord('file/other.md', own, pub)).toBeUndefined();
    expect(lookupCoord('unknown/doc:y', own, pub)).toBeUndefined();
    expect(lookupCoord('doc:y', own, pub)).toBeUndefined(); // bare key never reads a pub map
  });

  it('tolerates null maps', () => {
    expect(lookupCoord('a/b', null, null)).toBeUndefined();
    expect(lookupCoord('c15r/doc:y', null, pub)).toEqual([0.5, 0.5, 0]);
  });
});
