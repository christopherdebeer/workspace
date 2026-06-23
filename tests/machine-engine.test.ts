/**
 * Unit tests for the @c15r/machine pure execution core (cells/machine/engine.ts).
 * These lock the behaviour that broke in live runs: section/vote child spawning
 * (the missing-child + lost-field bugs), the key-separator join barrier, auto-rail
 * terminality, decide menus, and graph validation. Pure functions → fast, no I/O.
 */
import {
  railsFrom,
  validateMachine,
  projectActions,
  projectSubscriptions,
  spawnChildrenWrites,
} from '../cells/machine/engine';

describe('railsFrom', () => {
  it('derives modes from arrows (-> auto, => agent, ~> task, ~>> work)', () => {
    const rails = railsFrom(
      [
        { from: 'A', arrow: '->', to: 'B' },
        { from: 'B', arrow: '=>', to: 'C' },
        { from: 'B', arrow: '~>', to: 'D' },
        { from: 'C', arrow: '~>>', to: 'E' },
        { from: 'A', arrow: '*-->', to: 'X' }, // relationship arrow → not a rail
      ],
      undefined,
    );
    expect(rails).toEqual([
      { from: 'A', to: 'B', mode: 'auto' },
      { from: 'B', to: 'C', mode: 'agent' },
      { from: 'B', to: 'D', mode: 'task' },
      { from: 'C', to: 'E', mode: 'work' },
    ]);
  });

  it('passes through explicit rail config (when/sections/branch/samples/tools)', () => {
    const [section, vote] = railsFrom(
      [],
      [
        { from: 'F', to: 'J', mode: 'section', sections: [{ to: 'A', when: 'do a' }, { to: 'B' }] },
        { from: 'G', to: 'K', mode: 'vote', branch: 'V', samples: 5, when: 'sample it' },
      ],
    );
    expect(section.mode).toBe('section');
    expect(section.sections).toEqual([{ to: 'A', when: 'do a' }, { to: 'B' }]);
    expect(vote.mode).toBe('vote');
    expect(vote.branch).toBe('V');
    expect(vote.samples).toBe(5);
    expect(vote.when).toBe('sample it');
  });

  it('falls unknown modes back to auto', () => {
    expect(railsFrom([], [{ from: 'A', to: 'B', mode: 'nonsense' }])[0].mode).toBe('auto');
  });
});

describe('validateMachine', () => {
  const N = (...names: string[]) => names.map((name) => ({ name }));

  it('passes a healthy linear machine', () => {
    const v = validateMachine(N('A', 'B', 'C'), [
      { from: 'A', to: 'B', mode: 'auto' },
      { from: 'B', to: 'C', mode: 'agent' },
    ]);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
    expect(v.stats).toMatchObject({ entries: ['A'], terminals: ['C'], cyclic: false });
  });

  it('flags a dangling rail as an error', () => {
    const v = validateMachine(N('A', 'B'), [{ from: 'A', to: 'Z', mode: 'auto' }]);
    expect(v.ok).toBe(false);
    expect(v.errors.map((e: { code: string }) => e.code)).toContain('dangling-rail');
  });

  it('detects a cycle + no-entry', () => {
    const v = validateMachine(N('A', 'B'), [
      { from: 'A', to: 'B', mode: 'auto' },
      { from: 'B', to: 'A', mode: 'auto' },
    ]);
    expect(v.ok).toBe(false);
    expect(v.errors.map((e: { code: string }) => e.code)).toContain('no-entry');
    expect(v.warnings.map((w: { code: string }) => w.code)).toContain('cycle');
    expect(v.stats.cyclic).toBe(true);
  });

  it('treats section branch targets as reachable (no false unreachable)', () => {
    const v = validateMachine(N('Plan', 'A', 'B', 'Synthesize'), [
      { from: 'Plan', to: 'Synthesize', mode: 'section', sections: [{ to: 'A' }, { to: 'B' }] },
      { from: 'A', to: 'Synthesize', mode: 'auto' },
      { from: 'B', to: 'Synthesize', mode: 'auto' },
    ]);
    const codes = v.warnings.map((w: { code: string }) => w.code);
    expect(codes).not.toContain('unreachable');
    expect(codes).not.toContain('orphan');
  });
});

describe('projectActions', () => {
  it('start carries an optional text param and writes ifAbsent', () => {
    const actions = projectActions('m', [{ name: 'A' }, { name: 'B' }], [{ from: 'A', to: 'B', mode: 'auto' }]);
    const start = actions.find((a: { id: string }) => a.id === 'machine.m.start');
    expect(start.params.text).toBeDefined();
    expect(start.writes[0].ifAbsent).toBe(true);
    expect(start.writes[0].value.text).toBe('${params.text}');
  });

  it('an auto rail to a terminal node writes status done', () => {
    const actions = projectActions('m', [{ name: 'A' }, { name: 'B' }], [{ from: 'A', to: 'B', mode: 'auto' }]);
    const rail = actions.find((a: { id: string }) => a.id === 'machine.m.A-to-B');
    expect(rail.writes[0].value.status).toBe('done'); // B is terminal
  });

  it('decide surfaces each branch with its when descriptor', () => {
    const actions = projectActions(
      'm',
      [{ name: 'D' }, { name: 'X' }, { name: 'Y' }],
      [
        { from: 'D', to: 'X', mode: 'agent', when: 'needs fix' },
        { from: 'D', to: 'Y', mode: 'agent', when: 'all good' },
      ],
    );
    const decide = actions.find((a: { id: string }) => a.id === 'machine.m.decide-D');
    expect(decide.description).toContain('X — needs fix');
    expect(decide.description).toContain('Y — all good');
    expect(decide.params.to.enum).toEqual(['X', 'Y']);
  });
});

describe('projectSubscriptions', () => {
  const rails = railsFrom([], [
    { from: 'Plan', to: 'Synthesize', mode: 'section', sections: [{ to: 'A' }, { to: 'B' }] },
    { from: 'A', to: 'ADone', mode: 'work', prompt: 'do A' },
  ]);
  const subs = projectSubscriptions('demo', rails, 'c15r');

  it('projects the fan as a deliver to spawn_children with the static spec', () => {
    const fan = subs.find((s: { id: string }) => s.id === 'machine.demo.fan-Plan');
    expect(fan.deliver).toBe('@c15r/machine.spawn_children');
    expect(JSON.parse(fan.params.spec)).toEqual({ node: 'Plan', join: 'Synthesize', kind: 'section', branches: ['A', 'B'] });
  });

  it('matches the join barrier by the key separator, not a value field', () => {
    const join = subs.find((s: { id: string }) => s.id === 'machine.demo.join-Plan');
    expect(join.deliver).toBe('@c15r/models.agent');
    // The child advance overwrites its value (dropping kind), so the barrier must
    // key off the stable "§" in the key.
    expect(join.match.cel).toContain('key.contains("§")');
    expect(join.match.cel).not.toContain('value.kind');
  });

  it('projects a work rail as a deliver to models.agent with an advance prompt', () => {
    const work = subs.find((s: { id: string }) => s.id === 'machine.demo.work-A');
    expect(work.deliver).toBe('@c15r/models.agent');
    expect(work.params.prompt).toContain('do A');
    expect(work.params.prompt).toContain('"node":"ADone"');
  });

  it('threads a section rail `synthesis` instruction into the join prompt', () => {
    const r2 = railsFrom([], [{ from: 'F', to: 'J', mode: 'section', sections: [{ to: 'A' }], synthesis: 'combine survey/<parent>§* findings' }]);
    const join = projectSubscriptions('m2', r2, 'c15r').find((s: { id: string }) => s.id === 'machine.m2.join-F');
    expect(join.params.prompt).toContain('combine survey/<parent>§* findings');
  });
});

describe('spawnChildrenWrites (the multi-write reliability fix)', () => {
  it('emits the parent wait-state + one child per section, each keeping kind/parent', () => {
    const writes = spawnChildrenWrites('run1', 'demo', { node: 'Plan', join: 'Synthesize', kind: 'section', branches: ['A', 'B'] }, 'T');
    expect(writes).toHaveLength(3); // parent + 2 children — the missing-child regression guard
    expect(writes[0]).toMatchObject({ key: 'machine-run/run1', value: { node: 'Plan', status: 'sectioning', join: 'Synthesize' } });
    expect(writes[1]).toMatchObject({ key: 'machine-run/run1§A', value: { node: 'A', parent: 'run1', kind: 'section', status: 'running' } });
    expect(writes[2].key).toBe('machine-run/run1§B');
    expect(writes[1].tags).toContain('parallel-child');
  });

  it('emits k samples for a vote, keyed with "#"', () => {
    const writes = spawnChildrenWrites('run2', 'demo', { node: 'G', join: 'K', kind: 'vote', branch: 'V', samples: 3 }, 'T');
    expect(writes).toHaveLength(4); // parent + 3 samples
    expect(writes[0].value.status).toBe('voting');
    expect(writes.slice(1).map((w: { key: string }) => w.key)).toEqual(['machine-run/run2#0', 'machine-run/run2#1', 'machine-run/run2#2']);
    expect(writes.slice(1).every((w: { value: { node: string } }) => w.value.node === 'V')).toBe(true);
  });

  it('clamps vote samples to 2..7', () => {
    expect(spawnChildrenWrites('r', 'd', { kind: 'vote', branch: 'V', samples: 99 }, 'T')).toHaveLength(1 + 7);
    expect(spawnChildrenWrites('r', 'd', { kind: 'vote', branch: 'V', samples: 1 }, 'T')).toHaveLength(1 + 2);
  });
});
