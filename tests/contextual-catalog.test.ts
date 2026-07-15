/**
 * ADR-0049 — contextual capabilities: `$catalog {for}` / `{forType}` returns
 * just what can act on a fact, INFERRED from its type signals (declared type →
 * key prefix → tag prefixes) via each matched type's manager cell.
 */
import { buildContextualCatalog } from '../services/gateway/service';

type Entry = Parameters<typeof buildContextualCatalog>[0][number];

const cap = (target: string, kind: 'read' | 'act', description = `${target} does things. More detail.`): Entry => ({
  target,
  kind,
  description,
  inputSchema: { type: 'object' },
  scope: null,
});

const CAPS: Entry[] = [
  cap('workspace.peek', 'read', 'One fact, whole. Extra.'),
  cap('workspace.neighbors', 'read'),
  cap('workspace.remember', 'act'),
  cap('workspace.query', 'read'), // not a core fact verb — must NOT ride along
  cap('@c15r/machine.step', 'act'),
  cap('@c15r/machine.run', 'act'),
  cap('@c15r/lit.save', 'act'),
  cap('cells.list', 'read'),
];

const TYPES = {
  machine: { icon: '⚙', manager: '@c15r/machine', handlers: { open: [{ path: '?m=${match}' }] } },
  doc: { icon: '📄', manager: 'c15r/lit', label: 'value.title' },
};

describe('contextual capabilities (ADR-0049)', () => {
  it('a declared type pulls its manager cell tools (with schemas) + core workspace verbs', () => {
    const r = buildContextualCatalog(CAPS, TYPES, { key: 'machine/tending', meta: { type: 'machine' } });
    expect(r.signals).toContain('machine');
    expect(r.capabilities.map((c) => c.target).sort()).toEqual(['@c15r/machine.run', '@c15r/machine.step']);
    expect(r.capabilities[0].inputSchema).toBeDefined(); // the escalation tier keeps schemas
    const ws = r.workspace.map((w) => w.target);
    expect(ws).toEqual(expect.arrayContaining(['workspace.peek', 'workspace.remember']));
    expect(ws).not.toContain('workspace.query'); // only the acts-on-a-fact floor
    expect((r.types.machine as { manager: string }).manager).toBe('@c15r/machine');
  });

  it('type is inferred from the key prefix when _meta.type is absent', () => {
    const r = buildContextualCatalog(CAPS, TYPES, { key: 'doc:field-notes' });
    expect(r.signals).toContain('doc');
    expect(r.capabilities.map((c) => c.target)).toEqual(['@c15r/lit.save']); // manager normalised c15r/lit → @c15r/lit
  });

  it('grouped-menu summaries are capped to a one-liner (long first sentences are truncated)', () => {
    // A core verb whose first sentence runs long (parentheticals before the
    // first period) — the skim summary must be capped, not the whole sentence.
    const longDesc =
      'Write a fact to your workspace at `key` (ADR-0033 progressive disclosure), replacing any prior value wholesale and bumping its revision, emitting fact.written so subscriptions and the derived views all reconcile against the new head.';
    const r = buildContextualCatalog([cap('workspace.remember', 'act', longDesc)], TYPES, { key: 'zzz:nope' });
    const remember = r.workspace.find((w) => w.target === 'workspace.remember')!;
    expect(remember.summary.length).toBeLessThanOrEqual(121); // 120 + the ellipsis
    expect(remember.summary.endsWith('…')).toBe(true);
    // A short description passes through untouched (no spurious ellipsis).
    const short = buildContextualCatalog([cap('workspace.peek', 'read', 'One fact, whole.')], TYPES, { key: 'zzz:nope' });
    expect(short.workspace.find((w) => w.target === 'workspace.peek')!.summary).toBe('One fact, whole.');
  });

  it('forType asks about a type directly; unknown types degrade to the workspace floor', () => {
    const byType = buildContextualCatalog(CAPS, TYPES, { type: 'machine' });
    expect(byType.capabilities.length).toBe(2);
    const unknown = buildContextualCatalog(CAPS, TYPES, { key: 'zzz:nope' });
    expect(unknown.capabilities).toEqual([]);
    expect(unknown.workspace.length).toBeGreaterThan(0); // never an empty answer
  });
});
