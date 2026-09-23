/**
 * The pure halves of the source-tree layer: line diffs, tree identity, and
 * patch-set planning. The S3-backed behaviour (snapshots, commits, rollback,
 * pinned deploys) is driven end-to-end in cell-files.test.ts.
 */
import { diffLines, diffText, toLines, unifiedHunks } from '../services/cells/source-diff';
import { planPatch, touchedPaths } from '../services/cells/source-patch';
import type { BaseFile, PatchChange } from '../services/cells/source-patch';
import { treeVersionOf } from '../services/cells/source-tree';
import { contentVersion } from '../services/cells/source-text';

describe('source-diff', () => {
  it('edit scripts reconstruct both sides exactly (fuzzed)', () => {
    let seed = 7;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let t = 0; t < 2000; t++) {
      const a = Array.from({ length: rnd(14) }, () => 'abc'[rnd(3)]);
      const b = Array.from({ length: rnd(14) }, () => 'abc'[rnd(3)]);
      const edits = diffLines(a, b)!;
      const outA: string[] = [];
      const outB: string[] = [];
      for (const e of edits) {
        if (e.op === '=') {
          expect(a[e.a]).toBe(b[e.b]);
          outA.push(a[e.a]);
          outB.push(b[e.b]);
        } else if (e.op === '-') outA.push(a[e.a]);
        else outB.push(b[e.b]);
      }
      expect(outA).toEqual(a);
      expect(outB).toEqual(b);
    }
  });

  it('a one-line edit in a 60,000-line file is found without a quadratic table', () => {
    const a = Array.from({ length: 60000 }, (_, i) => `line ${i}`);
    const b = [...a];
    b[31234] = 'changed';
    const started = Date.now();
    const d = diffText(a.join('\n') + '\n', b.join('\n') + '\n', 1);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(d.stats).toEqual({ added: 1, removed: 1 });
    expect(d.hunks).toBe('@@ -31234,3 +31234,3 @@\n line 31233\n-line 31234\n+changed\n line 31235');
  });

  it('renders unified hunks with standard headers, merging nearby changes', () => {
    const a = toLines('1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n');
    const b = toLines('1\nTWO\n3\n4\n5\n6\n7\n8\nNINE\n10\n');
    expect(unifiedHunks(a, b, diffLines(a, b)!, 1)).toBe('@@ -1,3 +1,3 @@\n 1\n-2\n+TWO\n 3\n@@ -8,3 +8,3 @@\n 8\n-9\n+NINE\n 10');
    expect(unifiedHunks(a, b, diffLines(a, b)!, 3).split('@@ -').length).toBe(2);
    expect(diffText('', 'x\ny\n').hunks).toBe('@@ -0,0 +1,2 @@\n+x\n+y');
  });
});

describe('treeVersion', () => {
  it('is determined by paths and content versions only, in any order', () => {
    const a = treeVersionOf([{ path: 'a.ts', version: 'sha256:1' }, { path: 'b.ts', version: 'sha256:2' }]);
    expect(a).toMatch(/^tree:[0-9a-f]{64}$/);
    expect(treeVersionOf([{ path: 'b.ts', version: 'sha256:2' }, { path: 'a.ts', version: 'sha256:1' }])).toBe(a);
    expect(treeVersionOf([{ path: 'a.ts', version: 'sha256:1' }, { path: 'c.ts', version: 'sha256:2' }])).not.toBe(a);
    expect(treeVersionOf([{ path: 'a.ts', version: 'sha256:1' }])).not.toBe(a);
  });
});

describe('planPatch', () => {
  const text = (s: string): BaseFile => ({ body: Buffer.from(s), contentType: 'text/plain; charset=utf-8', version: contentVersion(s), binary: false });
  const base = (): Map<string, BaseFile | null> =>
    new Map<string, BaseFile | null>([
      ['a.ts', text('const a = 1;\n')],
      ['b.ts', text('const b = 1;\nconst b2 = 1;\n')],
      ['gone.ts', null],
    ]);

  it('plans a coupled edit: replace, create, delete, move — with versions', () => {
    const changes: PatchChange[] = [
      { op: 'replace', path: 'a.ts', old_str: 'a = 1', new_str: 'a = 2', ifVersion: contentVersion('const a = 1;\n') },
      { op: 'write', path: 'new.ts', content: 'export {};\n', ifAbsent: true },
      { op: 'move', from: 'b.ts', to: 'lib/b.ts' },
      { op: 'replace', path: 'lib/b.ts', old_str: 'b2', new_str: 'bb' },
    ];
    const m = base();
    for (const p of touchedPaths(changes)) if (!m.has(p)) m.set(p, null);
    const plan = planPatch(m, changes);
    expect(plan.conflicts).toEqual([]);
    expect(plan.files.map((f) => [f.path, f.status, f.movedFrom])).toEqual([
      ['a.ts', 'M', undefined],
      ['b.ts', 'D', undefined],
      ['lib/b.ts', 'A', 'b.ts'],
      ['new.ts', 'A', undefined],
    ]);
    expect(plan.files[2].next!.body.toString()).toBe('const b = 1;\nconst bb = 1;\n');
    expect(plan.files[0].version).toBe(contentVersion('const a = 2;\n'));
  });

  it('reports EVERY conflict, not just the first, and preconditions read the base tree', () => {
    const plan = planPatch(base(), [
      { op: 'replace', path: 'a.ts', old_str: 'a = 1', new_str: 'a = 2', ifVersion: 'sha256:stale' },
      { op: 'write', path: 'b.ts', content: 'x', ifAbsent: true },
      { op: 'delete', path: 'gone.ts' },
      { op: 'replace', path: 'b.ts', old_str: '= 1', new_str: '= 2' },
      { op: 'append', path: 'gone.ts', content: 'x', ifExists: true },
      { op: 'bogus', path: 'a.ts' } as unknown as PatchChange,
      { op: 'write', path: '../escape', content: 'x' },
    ]);
    expect(plan.conflicts.map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const errors = plan.conflicts.map((c) => c.error);
    expect(errors[0]).toMatch(/^VERSION_CONFLICT on a\.ts: expected sha256:stale/);
    expect(errors[1]).toMatch(/^VERSION_CONFLICT on b\.ts: expected absent/);
    expect(errors[2]).toBe('File not found: gone.ts');
    expect(errors[3]).toMatch(/^old_str occurs 2 times in b\.ts \(expected 1/);
    expect(errors[4]).toBe('File not found: gone.ts (ifExists)');
    expect(errors[5]).toMatch(/^unknown op "bogus"/);
    expect(errors[6]).toMatch(/^invalid path segment "\.\."/);
  });

  it('refuses a move onto an existing file unless overwrite, and drops no-op changes', () => {
    const clash = planPatch(base(), [{ op: 'move', from: 'a.ts', to: 'b.ts' }]);
    expect(clash.conflicts[0].error).toMatch(/move target exists: b\.ts/);
    const ok = planPatch(base(), [{ op: 'move', from: 'a.ts', to: 'b.ts', overwrite: true }]);
    expect(ok.files.map((f) => [f.path, f.status])).toEqual([['a.ts', 'D'], ['b.ts', 'M']]);
    const noop = planPatch(base(), [{ op: 'replace', path: 'a.ts', old_str: '1', new_str: '1' }]);
    expect(noop.files).toEqual([]);
  });
});
