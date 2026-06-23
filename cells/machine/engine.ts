/**
 * @c15r/machine — the pure execution core (functional core / imperative shell).
 *
 * Everything here is PURE: no AWS, no I/O, no `emit`, no React, no env. It is the
 * single source of truth for how a machine maps to substrate vocabulary and how a
 * run advances — `index.ts` is the thin shell that routes HTTP and applies these
 * results via the organ path. Being pure makes this the unit-tested core
 * (`tests/machine-engine.test.ts`); the lost-field / missing-child / barrier bugs
 * that bit in live runs are exactly the class a tested reducer catches.
 *
 * Why a generator rather than an in-memory interpreter (e.g. XState, like canvas'
 * gesture machine): a run's state lives in substrate FACTS and advances via
 * independent, stateless Lambda reactions — there is no durable host to hold an
 * interpreter between events, and a cell can neither read the substrate nor call
 * other cells. So the core PROJECTS the machine to declared actions + `deliver`
 * subscriptions (model invocation and sibling-aggregating barriers must stay
 * substrate-side) and computes the deterministic writes the cell itself emits.
 * See docs/machine-workflow-parallels.md and docs/machine-cell.md.
 */

/** DyGram's relationship arrows → substrate edge relations (faithful to DyGram's
 *  arrow semantics). These are the *relationship* rels — rail *execution* mode is
 *  a separate, substrate-only concept (`railsFrom`). */
export const ARROW_RELS = {
  '->': 'flows-to',
  '-->': 'depends-on',
  '=>': 'causes',
  '<|--': 'inherits',
  '*-->': 'composes',
  'o-->': 'aggregates',
  '<-->': 'relates',
};

/** A safe `_actions/` / key id segment — ids must not contain "/". */
export const seg = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '_');

/**
 * Rails from arrows (when not declared explicitly). This arrow→mode mapping is a
 * substrate-only design choice, NOT a DyGram port: DyGram has no rail-mode enum
 * and infers auto-vs-agent from node-type/out-degree/annotations (its `=>` is
 * causation *styling*). We make mode explicit: `->` auto, `=>` agent, `~>` task,
 * `~>>` work (the last two our own rail arrows). See docs/machine-dygram-contrast.md.
 */
export function railsFrom(arrows, explicit) {
  if (Array.isArray(explicit) && explicit.length) {
    return explicit.map((r) => ({
      from: r.from,
      to: r.to,
      mode: ['agent', 'task', 'work', 'section', 'vote'].includes(r.mode) ? r.mode : 'auto',
      ...(r.condition ? { condition: r.condition } : {}),
      // Progressive disclosure (Agent-Skills Level-1): a one-line "when to use
      // this branch" descriptor surfaced to the decider without the full body.
      ...(r.when ? { when: r.when } : {}),
      // A `work` rail SPAWNS an agent — it carries the brief the spawned
      // @owner/models.agent runs with. (`task` parks a claimable hand-off.)
      ...(r.prompt ? { prompt: r.prompt } : {}),
      ...(r.grants ? { grants: r.grants } : {}),
      ...(typeof r.maxTurns === 'number' ? { maxTurns: r.maxTurns } : {}),
      // The agent's tool allowlist (docs/machine-agent-scopes.md).
      ...(Array.isArray(r.tools) ? { tools: r.tools } : {}),
      ...(r.scope ? { scope: r.scope } : {}),
      // Parallel-branching config: section → `sections` [{to, when?}] then synthesise
      // to `to` (join); vote → `branch` sampled `samples`× then consensus to `to`.
      ...(Array.isArray(r.sections) ? { sections: r.sections } : {}),
      ...(r.branch ? { branch: r.branch } : {}),
      ...(typeof r.samples === 'number' ? { samples: r.samples } : {}),
      // Optional extra instruction for the join agent's synthesis/tally step —
      // e.g. where the branch findings live and how to combine them.
      ...(r.synthesis ? { synthesis: r.synthesis } : {}),
    }));
  }
  const rails = [];
  for (const e of arrows) {
    if (e.arrow === '->') rails.push({ from: e.from, to: e.to, mode: 'auto' });
    else if (e.arrow === '=>') rails.push({ from: e.from, to: e.to, mode: 'agent' });
    else if (e.arrow === '~>') rails.push({ from: e.from, to: e.to, mode: 'task' });
    else if (e.arrow === '~>>') rails.push({ from: e.from, to: e.to, mode: 'work' });
  }
  return rails;
}

/** Number of samples a vote rail fans out (clamped 2..7). */
export const voteCount = (r) => Math.max(2, Math.min(7, r.samples || 3));

/**
 * Static analysis over a machine's rail graph — the DyGram-style structural
 * checks our projection otherwise skips. Pure / no I/O. Errors are breakages (a
 * run can't start, a rail points nowhere); warnings are smells (unreachable,
 * orphan, cycle, no terminal). section/vote SPAWN their branch targets, so those
 * implied edges are followed for reachability.
 */
export function validateMachine(nodes, rails) {
  const names = new Set((nodes || []).map((n) => n && n.name).filter(Boolean));
  const errors = [];
  const warnings = [];

  for (const r of rails) {
    if (r.from && !names.has(r.from)) errors.push({ code: 'dangling-rail', message: `rail "${r.from}" → "${r.to}": no node named "${r.from}"` });
    if (r.to && !names.has(r.to)) errors.push({ code: 'dangling-rail', message: `rail "${r.from}" → "${r.to}": no node named "${r.to}"` });
  }

  const adj = new Map();
  const indeg = new Map();
  for (const n of names) { adj.set(n, []); indeg.set(n, 0); }
  const link = (from, to) => { if (names.has(from) && names.has(to)) { adj.get(from).push(to); indeg.set(to, indeg.get(to) + 1); } };
  for (const r of rails) {
    link(r.from, r.to);
    if (r.mode === 'section') for (const s of r.sections || []) link(r.from, s.to);
    if (r.mode === 'vote' && r.branch) link(r.from, r.branch);
  }
  const entries = [...names].filter((n) => indeg.get(n) === 0);
  const terminals = [...names].filter((n) => adj.get(n).length === 0);

  const seen = new Set();
  const stack = [...entries];
  while (stack.length) { const n = stack.pop(); if (seen.has(n)) continue; seen.add(n); for (const m of adj.get(n)) stack.push(m); }
  for (const n of names) if (!seen.has(n)) warnings.push({ code: 'unreachable', message: `node "${n}" is unreachable from any entry` });

  const touched = new Set();
  for (const r of rails) {
    if (names.has(r.from)) touched.add(r.from);
    if (names.has(r.to)) touched.add(r.to);
    if (r.mode === 'section') for (const s of r.sections || []) if (names.has(s.to)) touched.add(s.to);
    if (r.mode === 'vote' && names.has(r.branch)) touched.add(r.branch);
  }
  for (const n of names) if (!touched.has(n) && names.size > 1) warnings.push({ code: 'orphan', message: `node "${n}" has no rails (unreachable by execution)` });

  const color = new Map();
  const cycles = [];
  const dfs = (n, path) => {
    color.set(n, 1);
    for (const m of adj.get(n)) {
      if (color.get(m) === 1) cycles.push([...path, n, m].join(' → '));
      else if (!color.get(m)) dfs(m, [...path, n]);
    }
    color.set(n, 2);
  };
  for (const n of names) if (!color.get(n)) dfs(n, []);
  for (const c of cycles) warnings.push({ code: 'cycle', message: `transition cycle ${c} — a reactive machine could loop; add a condition/guard` });

  if (names.size && entries.length === 0) errors.push({ code: 'no-entry', message: 'no entry node (every node has an incoming rail) — a run cannot start' });
  if (names.size && terminals.length === 0) warnings.push({ code: 'no-terminal', message: 'no terminal node (every node has an outgoing rail) — a run never reaches done' });

  return { ok: errors.length === 0, errors, warnings, stats: { nodes: names.size, rails: rails.length, entries, terminals, cyclic: cycles.length > 0 } };
}

/**
 * Project a machine's rails into cell-required declared actions over a
 * `machine-run/<run>` fact: `start` (seed a run at the entry, with optional
 * trigger `text`), one auto-rail `<from>-to-<to>` advance per flow, and a
 * `decide-<from>` per agent/task node (records the chosen branch as a claim).
 * Reasoning is spent only at agent rails. Parallel (section/vote) is NOT a
 * declared action — it is a `deliver` to spawn_children (see projectSubscriptions).
 */
export function projectActions(name, nodes, rails) {
  const m = seg(name);
  const runKey = 'machine-run/${params.run}';
  const tags = ['machine', `machine:${name}`];
  const hasOut = (node) => rails.some((r) => r.from === node);
  const hasIn = (node) => rails.some((r) => r.to === node);
  const entry = (nodes.find((n) => !hasIn(n.name)) ?? nodes[0])?.name;
  const actions = [];

  if (entry) {
    actions.push({
      id: `machine.${m}.start`,
      description: `Start a run of "${name}" at ${entry}. Optional \`text\` is the trigger-context body (a Claude-Routine-style payload) stored on the run so the entry node's agent sees it.`,
      params: {
        run: { type: 'string', required: true, description: 'Run id → machine-run/<run>' },
        text: { type: 'string', required: false, description: 'Trigger context body — visible to the entry agent' },
      },
      writes: [{ key: runKey, value: { machine: name, node: entry, status: 'running', startedAt: '${now}', text: '${params.text}' }, type: 'machine-run', tags, ifAbsent: true }],
    });
  }

  for (const r of rails.filter((x) => x.mode === 'auto')) {
    const ifConds = [{ key: runKey, path: 'node', op: 'eq', value: r.from }];
    if (r.condition) ifConds.push({ cel: r.condition, key: runKey });
    actions.push({
      id: `machine.${m}.${seg(r.from)}-to-${seg(r.to)}`,
      description: `Auto rail ${r.from} → ${r.to}${hasOut(r.to) ? '' : ' (terminal)'}.`,
      params: { run: { type: 'string', required: true } },
      if: ifConds,
      writes: [{ key: runKey, value: { machine: name, node: r.to, status: hasOut(r.to) ? 'running' : 'done', at: '${now}', via: `${r.from}->${r.to}` }, type: 'machine-run', tags }],
    });
  }

  const isDecision = (x) => x.mode === 'agent' || x.mode === 'task';
  for (const from of [...new Set(rails.filter(isDecision).map((x) => x.from))]) {
    const branchRails = rails.filter((x) => isDecision(x) && x.from === from);
    const branches = branchRails.map((x) => x.to);
    const menu = branchRails.map((x) => (x.when ? `${x.to} — ${x.when}` : x.to)).join('; ');
    const decisionStatus = branches.every((b) => !hasOut(b)) ? 'done' : 'running';
    actions.push({
      id: `machine.${m}.decide-${seg(from)}`,
      description: `Decision at ${from}: record the chosen branch as a claim and advance. Branches: ${menu}.`,
      params: {
        run: { type: 'string', required: true },
        to: { type: 'string', required: true, enum: branches, description: 'The chosen branch' },
        statement: { type: 'string', description: 'Why this branch — becomes the claim' },
        confidence: { type: 'number', description: 'Calibrated belief 0..1' },
      },
      if: [{ key: runKey, path: 'node', op: 'eq', value: from }],
      writes: [
        { key: 'claims/${params.run}.' + seg(from), value: { statement: '${params.statement}', confidence: '${params.confidence}', machine: name, at: from, chose: '${params.to}' }, type: 'claim', tags: ['claim', 'machine', 'dygram'] },
        { key: runKey, value: { machine: name, node: '${params.to}', status: decisionStatus, at: '${now}', via: `${from}=>decision` }, type: 'machine-run', tags },
      ],
    });
  }
  return actions;
}

/**
 * Subscriptions that make a machine reactive:
 *  - one per AUTO rail: invoke the transition action (its `if` fires only the
 *    rail whose `from` = the run's node), so the deterministic prefix advances.
 *  - one per AGENT/TASK node: deliver the run to @owner/models.decide (or park a
 *    claimable task) — reasoning is spent only here.
 *  - one per WORK node: deliver to @owner/models.agent (the spawned tool-loop).
 *  - section/vote: a fan `deliver` to @owner/machine.spawn_children (emits each
 *    child as its own organ write — reliable, unlike a single action's multi-
 *    write) + an agentic, eventually-consistent join barrier matched by the
 *    child's KEY separator (the child's advance overwrites its value, dropping
 *    kind/parent — only the key is stable).
 */
export function projectSubscriptions(name, rails, owner) {
  const m = seg(name);
  const subs = [];
  for (const r of rails.filter((x) => x.mode === 'auto')) {
    const id = `machine.${m}.${seg(r.from)}-to-${seg(r.to)}`;
    subs.push({
      id,
      match: { keyPrefix: 'machine-run/', cel: `value.machine == ${JSON.stringify(name)}` },
      invoke: id,
      params: { run: '${keySuffix}' },
    });
  }
  const agentNodes = new Set(rails.filter((x) => x.mode === 'agent').map((x) => x.from));
  const taskNodes = new Set(rails.filter((x) => x.mode === 'task').map((x) => x.from));
  for (const from of new Set([...agentNodes, ...taskNodes])) {
    const defer = taskNodes.has(from) && !agentNodes.has(from);
    subs.push({
      id: `machine.${m}.decide-${seg(from)}`,
      match: { keyPrefix: 'machine-run/', cel: `value.machine == ${JSON.stringify(name)} && value.node == ${JSON.stringify(from)} && value.status != "awaiting-decision"` },
      deliver: `@${owner}/models.decide`,
      params: defer ? { run: '${keySuffix}', defer: 'true' } : { run: '${keySuffix}' },
    });
  }
  for (const r of rails.filter((x) => x.mode === 'work')) {
    const advance = `When the work is complete, advance the run by writing fact "machine-run/\${keySuffix}" = {"machine":${JSON.stringify(name)},"node":${JSON.stringify(r.to)},"status":"done","via":${JSON.stringify(`${r.from}~>>work`)}} (type machine-run, tags ["machine",${JSON.stringify(`machine:${name}`)}]).`;
    const prompt = (r.prompt ? `${r.prompt}\n\n` : `Do the work for node "${r.from}" of machine "${name}", run \${keySuffix}.\n\n`) + advance;
    subs.push({
      id: `machine.${m}.work-${seg(r.from)}`,
      match: { keyPrefix: 'machine-run/', cel: `value.machine == ${JSON.stringify(name)} && value.node == ${JSON.stringify(r.from)} && value.status == "running"` },
      deliver: `@${owner}/models.agent`,
      params: {
        prompt,
        grants: r.grants ?? { read: true, write: ['machine-run/'] },
        ...(Array.isArray(r.tools) ? { tools: r.tools } : {}),
        ...(typeof r.maxTurns === 'number' ? { maxTurns: r.maxTurns } : {}),
        factKey: `machine-work/${m}.\${keySuffix}`,
        tags: ['machine', `machine:${name}`, 'work'],
      },
    });
  }
  for (const r of rails.filter((x) => x.mode === 'section' || x.mode === 'vote')) {
    const F = r.from;
    const J = r.to;
    const isVote = r.mode === 'vote';
    const childKind = isVote ? 'vote' : 'section';
    const sep = isVote ? '#' : '§';
    const count = isVote ? voteCount(r) : (r.sections || []).length;
    const jTerminal = !rails.some((x) => x.from === J);
    const spec = JSON.stringify(
      isVote
        ? { node: F, join: J, kind: 'vote', branch: r.branch, samples: count }
        : { node: F, join: J, kind: 'section', branches: (r.sections || []).map((s) => s.to) },
    );
    subs.push({
      id: `machine.${m}.fan-${seg(F)}`,
      match: { keyPrefix: 'machine-run/', cel: `value.machine == ${JSON.stringify(name)} && value.node == ${JSON.stringify(F)} && value.status == "running"` },
      deliver: `@${owner}/machine.spawn_children`,
      params: { run: '${keySuffix}', machine: name, spec },
    });
    const how = r.synthesis ? ` ${r.synthesis}` : '';
    const synthAdvance = `STEP 2 (only once all ${count} are status=="done"): ${isVote ? 'tally the consensus across the sample claims' : 'synthesize the section results'}.${how} Record it as a claim — write "claims/<parent>.${seg(F)}" = {"statement":"<your ${isVote ? 'consensus' : 'synthesis'}>","confidence":<0..1>,"machine":${JSON.stringify(name)},"at":${JSON.stringify(F)},"mode":${JSON.stringify(r.mode)}} (type claim, tags ["claim","machine","dygram"]). Then advance the parent — write "machine-run/<parent>" = {"machine":${JSON.stringify(name)},"node":${JSON.stringify(J)},"status":${JSON.stringify(jTerminal ? 'done' : 'running')},"via":${JSON.stringify(`${F}~${childKind}-join`)}} (type machine-run, tags ["machine",${JSON.stringify(`machine:${name}`)}]).`;
    const prompt =
      `You are the ${isVote ? 'VOTE TALLY' : 'SECTION SYNTHESIS'} agent for machine ${JSON.stringify(name)}, fan node "${F}". A ${childKind} child run just completed: "\${keySuffix}". Derive the PARENT run id = everything before the first "${sep}" in that id. There are ${count} ${childKind} children keyed "machine-run/<parent>${sep}…".\n\n` +
      `STEP 1: Read them — query with prefix "machine-run/<parent>${sep}". If FEWER than ${count} are status=="done", STOP and write nothing (you'll be re-invoked when the next child finishes).\n\n` +
      synthAdvance;
    subs.push({
      id: `machine.${m}.join-${seg(F)}`,
      match: { keyPrefix: 'machine-run/', cel: `value.machine == ${JSON.stringify(name)} && value.status == "done" && key.contains(${JSON.stringify(sep)})` },
      deliver: `@${owner}/models.agent`,
      params: {
        prompt,
        grants: { read: true, write: ['machine-run/', 'claims/'] },
        maxTurns: 8,
        factKey: `machine-join/${m}.\${keySuffix}`,
        tags: ['machine', `machine:${name}`, 'join'],
      },
    });
  }
  return subs;
}

/**
 * The deterministic writes a section/vote fan emits — the parent's wait-state
 * plus ONE child run per branch (each its own organ write, so each reliably
 * re-triggers its work/decide delivery). Pure: the shell passes `at` and emits
 * each returned write through the organ path.
 */
export function spawnChildrenWrites(run, machine, spec, at) {
  const tags = ['machine', `machine:${machine}`];
  const isVote = spec.kind === 'vote';
  const parent = {
    key: `machine-run/${run}`,
    value: { machine, node: spec.node, status: isVote ? 'voting' : 'sectioning', join: spec.join, via: `${spec.node}~fan`, at },
    type: 'machine-run',
    tags,
  };
  const children = [];
  if (isVote) {
    const k = Math.max(2, Math.min(7, spec.samples || 3));
    for (let i = 0; i < k; i++) {
      children.push({
        key: `machine-run/${run}#${i}`,
        value: { machine, node: spec.branch, parent: run, kind: 'vote', status: 'running', at },
        type: 'machine-run',
        tags: [...tags, 'parallel-child'],
      });
    }
  } else {
    for (const t of spec.branches || []) {
      children.push({
        key: `machine-run/${run}§${seg(t)}`,
        value: { machine, node: t, parent: run, kind: 'section', status: 'running', at },
        type: 'machine-run',
        tags: [...tags, 'parallel-child'],
      });
    }
  }
  return [parent, ...children];
}

/** Progressive-disclosure view of a machine (Agent-Skills tiering). Pure. */
export function disclose(nodes, rails, node) {
  const out = (n) => rails.filter((r) => r.from === n).map((r) => ({ to: r.to, mode: r.mode, ...(r.when ? { when: r.when } : {}) }));
  if (node) {
    const n = nodes.find((x) => x.name === node);
    if (!n) return { error: `no node "${node}"` };
    return { level: 2, node: n, rails: out(node) };
  }
  const entry = nodes.find((n) => !rails.some((r) => r.to === n.name)) ?? nodes[0];
  return {
    level: 1,
    entry: entry?.name,
    nodes: nodes.map((n) => ({ name: n.name, kind: n.kind, summary: n.title ?? '', rails: out(n.name) })),
  };
}
