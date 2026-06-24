/**
 * @c15r/machine — DyGram's ideas as substrate-native facts.
 *
 * A tier-2 cell that makes the concepts of DyGram (christopherdebeer/machine)
 * first-class in the substrate: a machine is a named subgraph of typed nodes
 * and typed arrows an agent rides as rails. See docs/machine.md for the
 * full design and the DyGram→substrate mapping.
 *
 * Minimal cell contract (mirrors cells/reef-writer): GET /_tools advertises the
 * vocabulary; POST /_tools/<name> dispatches; writes go through the organ path
 * (substrate.write.requested), so the workspace applies them as facts in the
 * owner's slice with this cell as the attested writer. Edges (the 7 arrow rels)
 * and reads are the gateway's job (workspace.link / workspace.query type:machine).
 */
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { App } from './client/app';
import { installBridge } from './client/bridge';
import { seg, ARROW_RELS, railsFrom, validateMachine, projectActions, projectSubscriptions, spawnChildrenWrites, step, specFromYield, parentOf, barrierAdvance, projectStepSubscription } from './engine';
// The shared SERVER-side substrate client (ADR-0017) — read/query/emit/supersede
// over the owner's slice. VENDORED here (not a URL import): the forge bundler
// only bundles relative imports within the cell dir + esm.sh-declared deps; a
// server-side `https://` import HANGS the bundler (the browser kernel's URL is
// browser-fetched, never server-bundled). Canonical source: cells/kernel/static/
// substrate.js — kept in sync until it's published as an npm package (ADR-0017).
import { createSubstrate } from './substrate';

const json = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const readFile = (rel) => readFileSync(join(__dirname, rel), 'utf8');

/** The SPA's first-paint seed from the dispatch-proxied ssr.json reads (run AS
 *  the caller; present only on an authed top-level navigation to `/`). */
function buildBoot(user, ssr) {
  const s = ssr ?? {};
  const machines = ((s.machines && s.machines.entries) || []).filter((e) => !String(e.key).startsWith('_'));
  const runs = (s.runs && s.runs.entries) || [];
  return { session: { user: user ?? null }, machines, runs };
}


/**
 * The cell-required `_renderers/machine` source (a canvas ElementView): adapts a
 * machine fact's value (spread onto the element as el.nodes / el.arrows by the
 * canvas storage seam) into mermaid and renders it via the mermaid CDN — the
 * same engine the viewers cell uses. Backtick-free so it nests cleanly here.
 * Seeded by the `bootstrap` tool — a cell seeding its own required facts, which
 * is categorically distinct from organic knowledge accretion (see docs).
 */
const RENDERER_SRC = `
let M;
function loadMermaid(){
  if(!M){ M = import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs').then(function(m){ m.default.initialize({startOnLoad:false,securityLevel:'strict',theme:'neutral'}); return m.default; }); }
  return M;
}
function sid(s){ return String(s||'n').replace(/[^A-Za-z0-9_]/g,'_'); }
function toMermaid(el){
  var nodes = Array.isArray(el.nodes)?el.nodes:[];
  var arrows = Array.isArray(el.arrows)?el.arrows:[];
  var lines = ['graph TD'];
  for(var i=0;i<nodes.length;i++){ var n=nodes[i]||{}; lines.push('  '+sid(n.name)+'["'+String(n.title||n.name||'').replace(/"/g,"'")+'"]'); }
  for(var j=0;j<arrows.length;j++){ var a=arrows[j]||{}; lines.push('  '+sid(a.from)+' -->|'+String(a.rel||a.arrow||'').replace(/[|"\\n]/g,'')+'| '+sid(a.to)); }
  return lines.join('\\n');
}
var seq=0;
function render(host,el){
  try{
    host.textContent='…';
    var src=toMermaid(el);
    loadMermaid().then(function(m){ return m.render('mm'+(++seq), src); }).then(function(r){ host.innerHTML=r.svg; }).catch(function(e){ host.textContent='machine: '+((e&&e.message)||e); });
  }catch(e){ host.textContent='machine render error'; }
}
function size(el,h){ var s=el.scale||1; if(typeof el.width==='number') h.style.width=(el.width*s)+'px'; if(typeof el.height==='number') h.style.height=(el.height*s)+'px'; }
export const view = {
  mount: function(el){ var h=document.createElement('div'); h.className='content'; size(el,h); render(h,el); return h; },
  update: function(el,dom){ if(!dom) return; size(el,dom); render(dom,el); }
};
`;

const TOOLS = [
  {
    name: 'bootstrap',
    description:
      "Seed this cell's required facts. Idempotent: re-writes _renderers/machine (a canvas ElementView drawing a machine as a mermaid diagram) and _views/machine-runs (the runs dashboard). Cell-required infrastructure — versioned with the cell, distinct from organic knowledge.",
    kind: 'act',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    scope: null,
  },
  {
    name: 'define_machine',
    description:
      'Record a DyGram machine as a fact at machine/<name> (typed nodes + arrows) AND project its rails into invokable, guarded declared actions: a `start`, an auto-rail advance per `->` flow, and a `decide-*` per `=>` agent node. Execution is then invoking those via workspace.invoke; the run fact (machine-run/<run>) advances, its revision history the trajectory. Pass explicit `rails` to override the arrow-derived ones, `project:false` to skip projection, `source` to keep the .dy text.',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Machine slug (becomes key machine/<name>)' },
        title: { type: 'string', description: 'Human title' },
        source: { type: 'string', description: 'Optional original .dy source text' },
        nodes: {
          type: 'array',
          description: 'Nodes: [{ name, kind, title?, attributes? }] (kind = Task/State/Input/Output/Context/Resource/Process/Concept/Implementation/Result/tool/…)',
          items: { type: 'object' },
        },
        arrows: {
          type: 'array',
          description: 'Arrows: [{ from, arrow, to, label? }]. DyGram\'s relationship/rendering arrows are -> --> => <|-- *--> o--> <--> (stored as edge `rel`s; see ARROW_RELS). `~>`/`~>>` are NOT DyGram arrows — they are substrate-only rail syntax we add for task/work rails (see docs/machine.md).',
          items: { type: 'object' },
        },
        rails: {
          type: 'array',
          description: 'Optional explicit rails: [{ from, to, mode: "auto"|"agent"|"task"|"work", condition?(CEL), prompt?, grants?, tools?, scope?, maxTurns? }]. NB: making rail mode explicit data — and the arrow→mode default below — is a substrate-only design choice, NOT a DyGram port: DyGram has no rail-mode enum and infers auto-vs-agent dynamically from node-type/out-degree/annotations (its `=>` is causation *styling*, not an agent marker). Our arrow→mode default: -> ⇒ auto, => ⇒ agent, ~> ⇒ task, ~>> ⇒ work. "work" SPAWNS @owner/models.agent at the node (machine-uses-agent): it runs `prompt` with scoped `grants` ({read,write[]}) and advances the run itself; `tools` is the allowlist of substrate tools it may call (the executor filters to it — docs/machine.md). "task" parks a claimable hand-off for a DRIVING agent instead.',
          items: { type: 'object' },
        },
        dryRun: { type: 'boolean', description: 'Validate + preview the projection (action/subscription ids) WITHOUT writing anything. Replaces the old standalone validate tool.' },
        project: { type: 'boolean', description: 'Project rails into declared actions (default true)' },
        reactive: { description: 'Register subscriptions so runs advance on change (default off — driven only, via the `step` tool). `"step"` (preferred, ADR-0018): ONE step subscription walks the deterministic prefix in-process + runs the join barrier — no per-rail cascade. `true` (legacy): the full per-auto-rail + agentic-join projection.' },
        trigger: { type: 'object', description: 'Optional fact pattern { type?, keyPrefix?, cel?, runId? } that STARTS a run. runId templates the run id from the event (default "${keySuffix}"); use e.g. "${value.at}" so a recurring source like tending gets a fresh run each time.' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['name'],
    },
    scope: null,
  },
  {
    name: 'trigger_run',
    description:
      'Fire a run of a machine by name — the canonical "scheduled routine / API trigger" entry (mirrors Claude Code Routines\' API trigger; see docs/machine.md). Writes machine-trigger/<machine>/<run>; the machine\'s standing internal-trigger subscription starts the run at its entry node, injecting `text` as run context the entry agent sees. Auto-generates `run` if omitted. The machine must have been define_machine\'d with projection on.',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        machine: { type: 'string', description: 'Machine slug (the <name> in machine/<name>)' },
        run: { type: 'string', description: 'Optional run id (auto-generated if omitted)' },
        text: { type: 'string', description: 'Trigger-context body (like a Routine `text` payload) — stored on the run for the entry agent' },
      },
      required: ['machine'],
    },
    scope: null,
  },
  {
    name: 'spawn_children',
    description:
      'Internal (reaction-target) — spawn the child runs of a section/vote fan. The fan rail delivers here when a run reaches the fan node; this emits the parent\'s wait-state AND one child run fact per branch as SEPARATE organ writes (so each reliably re-triggers its work/decide delivery, unlike a single declared action\'s secondary writes — docs/machine.md). Not meant to be called by hand.',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        run: { type: 'string', description: 'Parent run id' },
        machine: { type: 'string', description: 'Machine slug' },
        spec: { type: 'string', description: 'JSON: { node, join, kind:"section"|"vote", branches?[], branch?, samples? }' },
      },
      required: ['run', 'machine', 'spec'],
    },
    scope: null,
  },
  {
    name: 'step',
    description:
      'Advance a machine run STATELESSLY (ADR-0018, the stateless stepper). Reads machine-run/<run> + its machine def, follows deterministic `auto` rails IN-PROCESS (CEL-guarded, no per-hop fact-write), and emits at most ONE advanced run fact. Returns the `yield`: the non-deterministic point where a decision is owed — `{kind:"agent"|"task"|"work"|"section"|"vote", node, choices}` — or null when the run completed. On a section/vote yield it spawns the children; when a child completes it runs the DETERMINISTIC join barrier (reads the siblings, advances the parent once all are done — no model). The driven counterpart to the reactive step subscription; either way determinism never needs a model or a fact-cascade. Idempotent: a run already parked at its yield emits nothing.',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        run: { type: 'string', description: 'Run id → machine-run/<run>' },
      },
      required: ['run'],
    },
    scope: null,
  },
];

async function emit(detail) {
  const client = new EventBridgeClient({});
  await client.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: process.env.EVENT_BUS_NAME,
          Source: process.env.SERVICE_NAME,
          DetailType: 'substrate.write.requested',
          Detail: JSON.stringify(detail),
        },
      ],
    }),
  );
}

/** Emit one cell-required declared action through the organ path. */
async function emitAction(def, name) {
  await emit({ key: `_actions/${def.id}`, value: def, type: 'action', tags: ['machine', `machine:${name}`], via: 'machine.project' });
}

/** Emit one cell-required reaction subscription through the organ path. */
async function emitSubscription(def, name) {
  await emit({ key: `_subscriptions/${def.id}`, value: def, type: 'subscription', tags: ['machine', `machine:${name}`], via: 'machine.project' });
}

/** The owner whose slice this cell serves — used to address sibling cells. */
const OWNER = process.env.CELL_OWNER ?? 'c15r';

/**
 * Drive one run forward (ADR-0018). Reads the run + its machine def via the
 * shared substrate client, runs the pure `step`, and applies the result:
 *  - emits the advanced run (only when it actually changed — idempotent, so a
 *    reactive deliver to this tool on a parked run is a cheap no-op, no loop);
 *  - on a section/vote yield, spawns the children (reliable per-child writes);
 *  - on a completed run, runs the deterministic join barrier against its parent.
 * Pure decisions live in engine.ts; this is the thin I/O shell around them.
 */
async function stepRun(runId) {
  const sub = createSubstrate({ owner: OWNER, via: 'machine.step' });
  const now = new Date().toISOString();
  const runFact = await sub.read(`machine-run/${runId}`);
  if (!runFact) return { error: `no run machine-run/${runId}` };
  const runValue = runFact.value || {};
  const machineName = runValue.machine;
  const def = machineName ? await sub.read(`machine/${machineName}`) : null;
  if (!def) return { error: `no machine machine/${machineName}` };

  const result = step(runValue, def.value, now);

  // A section/vote yield spawns children; the spawn writes include the parent's
  // wait-state (which supersedes the plain advance), so don't also emit `result.run`.
  if (result.yield && (result.yield.kind === 'section' || result.yield.kind === 'vote')) {
    const spec = specFromYield(result.yield);
    const writes = spawnChildrenWrites(runId, machineName, spec, now);
    await sub.emit(writes);
    return { run: runId, node: result.yield.node, yield: result.yield, spawned: writes.slice(1).map((w) => w.key) };
  }

  // Emit the advance only if the meaningful state changed (idempotent).
  const changed = result.run.node !== runValue.node || result.run.status !== runValue.status;
  if (changed) {
    await sub.emit([{ key: `machine-run/${runId}`, value: result.run, type: 'machine-run', tags: ['machine', `machine:${machineName}`] }]);
  }

  // On completion, run the deterministic join barrier against the parent (if any).
  let barrier;
  if (result.run.status === 'done') {
    barrier = await advanceParentBarrier(sub, runId, result.run, def.value, now);
  }

  return {
    run: runId,
    node: result.run.node,
    status: result.run.status,
    changed,
    yield: result.yield ?? null,
    path: result.path,
    ...(barrier ? { barrier } : {}),
  };
}

/**
 * The deterministic join barrier shell: if `childRunId` is a section/vote child,
 * read the parent + all siblings and let the pure `barrierAdvance` decide whether
 * to advance the parent. The parent's machine def may differ in principle, but a
 * child shares its parent's machine, so reuse `def`.
 */
async function advanceParentBarrier(sub, childRunId, childRun, def, now) {
  const rel = parentOf(childRunId);
  if (!rel) return null;
  const parent = await sub.read(`machine-run/${rel.parent}`);
  if (!parent) return null;
  const siblings = await sub.query({ prefix: `machine-run/${rel.parent}${rel.sep}` });
  // Organ writes are async: the child-done write that triggered this step may not
  // have applied yet, so the just-completed child can read back stale. Overlay its
  // fresh value (and ensure it's present) so the barrier counts it — the read-lag
  // is the one place the deterministic count would otherwise miss its trigger.
  const childKey = `machine-run/${childRunId}`;
  let sawChild = false;
  const merged = siblings.map((s) => {
    if (s.key === childKey || s.key === childRunId) { sawChild = true; return { ...s, value: childRun }; }
    return s;
  });
  if (!sawChild) merged.push({ key: childKey, value: childRun });
  const decision = barrierAdvance(rel.parent, parent.value, merged, def, now);
  if (!decision.advance) return { parent: rel.parent, waiting: true, done: decision.done, expected: decision.expected, reason: decision.reason };
  await sub.emit([decision.advance]);
  return { parent: rel.parent, advanced: true, node: decision.advance.value.node, done: decision.done, expected: decision.expected };
}


export const handler = async (event) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';

  // ── the SSR React SPA (the user frontend) ──────────────────────────────
  if (method === 'GET' && path === '/app.js') {
    return { statusCode: 200, headers: { 'content-type': 'application/javascript; charset=utf-8', 'access-control-allow-origin': '*' }, body: readFile('app.js') };
  }
  if ((method === 'GET' || method === 'HEAD') && (path === '/' || path === '')) {
    try {
      const caller = event.headers && event.headers['x-cell-caller'];
      const authed = !!caller && caller !== 'anonymous';
      const boot = buildBoot(authed ? caller : null, event.ssrData);
      // SSR'd cross-cell links must match the client's; a host-aware stub keeps
      // hydration clean (only cellUrl is used during render).
      installBridge({ cellUrl: (o, n, rest = '') => `/@${o}/${n}${rest}` });
      const inner = renderToString(createElement(App, { initial: boot }));
      const state = JSON.stringify(boot).replace(/</g, '\\u003c');
      const shell = readFile('static/index.html')
        .replace('<div id="root"></div>', `<div id="root" data-ssr="1">${inner}</div>`)
        .replace('<script type="module"', `<script id="machine-state" type="application/json">${state}</script>\n  <script type="module"`);
      return { statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: shell };
    } catch (err) {
      // SSR is best-effort — fall back to the cold-mount shell, never a 500.
      try { return { statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: readFile('static/index.html') }; } catch { /* fall through */ }
    }
  }

  if (method === 'GET' && path === '/_tools') {
    return json(200, { tools: TOOLS });
  }

  if (method === 'POST' && path === '/_tools/bootstrap') {
    await emit({
      key: '_renderers/machine',
      value: { type: 'machine', source: RENDERER_SRC },
      type: 'renderer',
      tags: ['_renderers', 'machine-cell', 'cell-required'],
      via: 'machine.bootstrap',
    });
    // A cell-required VIEW over runs — the executor's dashboard. Cells seed
    // their own actions/views now, the same as their renderers.
    await emit({
      key: '_views/machine-runs',
      value: { id: 'machine-runs', description: 'Machine runs — active and completed', query: { type: 'machine-run', rankBy: 'recency', limit: 50 }, render: { type: 'fields' } },
      via: 'machine.bootstrap',
    });
    // Generic claimable-task vocabulary (not machine-specific): an atomic,
    // lease-bound claim — sync's canonical hand-off — so one agent works a task
    // at a time, plus the queue of runs awaiting a decision/work.
    await emit({
      key: '_actions/task.claim',
      value: {
        id: 'task.claim',
        description: 'Atomically claim an awaiting task (a machine run in awaiting-decision) with a 5-minute lease, so only one agent works it. Fails if a live claim already exists; the lease auto-expires so a crashed claimant releases it.',
        params: { run: { type: 'string', required: true, description: 'the run id (task) to claim' }, by: { type: 'string', required: true, description: 'who is claiming' } },
        writes: [{ key: 'task-claim/${params.run}', ifAbsent: true, value: { by: '${params.by}', at: '${now}' }, type: 'task-claim', timer: { ms: 300000, effect: 'delete' } }],
      },
      type: 'action',
      tags: ['cell-required', 'machine', 'tasks'],
      via: 'machine.bootstrap',
    });
    await emit({
      key: '_views/open-tasks',
      value: { id: 'open-tasks', description: 'Runs awaiting a decision or work — the claimable task queue', query: { tag: 'awaiting', rankBy: 'recency', limit: 50 }, render: { type: 'fields' } },
      via: 'machine.bootstrap',
    });
    return json(200, { bootstrapped: true, renderer: '_renderers/machine', views: ['_views/machine-runs', '_views/open-tasks'], actions: ['task.claim'] });
  }

  if (method === 'POST' && path === '/_tools/trigger_run') {
    const a = event.body ? JSON.parse(event.body) : {};
    if (!a.machine) return json(400, { error: 'machine is required' });
    const run = a.run || `${a.machine}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await emit({
      key: `machine-trigger/${a.machine}/${run}`,
      value: { at: new Date().toISOString(), ...(a.text ? { text: a.text } : {}) },
      type: 'machine-trigger',
      tags: ['machine', `machine:${a.machine}`, 'trigger'],
      via: 'machine.trigger_run',
    });
    return json(200, { triggered: true, machine: a.machine, run, key: `machine-trigger/${a.machine}/${run}` });
  }

  if (method === 'POST' && path === '/_tools/spawn_children') {
    const a = event.body ? JSON.parse(event.body) : {};
    if (!a.run || !a.machine || !a.spec) return json(400, { error: 'run, machine, and spec are required' });
    let spec;
    try { spec = typeof a.spec === 'string' ? JSON.parse(a.spec) : a.spec; } catch { return json(400, { error: 'spec is not valid JSON' }); }
    // The pure core computes the writes (parent wait-state + one child per branch);
    // the shell emits each as its OWN organ write (reliable downstream delivery).
    const writes = spawnChildrenWrites(a.run, a.machine, spec, new Date().toISOString());
    for (const w of writes) await emit({ ...w, via: 'machine.spawn_children' });
    return json(200, { spawned: true, run: a.run, kind: spec.kind, children: writes.slice(1).map((w) => w.key) });
  }

  if (method === 'POST' && path === '/_tools/step') {
    const a = event.body ? JSON.parse(event.body) : {};
    if (!a.run) return json(400, { error: 'run is required' });
    try {
      const out = await stepRun(a.run);
      return json(out.error ? 404 : 200, out);
    } catch (err) {
      return json(500, { error: (err && err.message) || String(err) });
    }
  }


  if (method === 'POST' && path === '/_tools/define_machine') {
    const a = event.body ? JSON.parse(event.body) : {};
    if (!a.name) return json(400, { error: 'name is required' });
    const nodes = Array.isArray(a.nodes) ? a.nodes : [];
    const arrows = Array.isArray(a.arrows) ? a.arrows : [];
    const rails = railsFrom(arrows, a.rails);
    const validation = validateMachine(nodes, rails);
    // dryRun: validate + preview the projection without writing anything
    // (the old standalone validate_machine tool, folded into define).
    if (a.dryRun) {
      const preview = a.project !== false && rails.length ? projectActions(a.name, nodes, rails) : [];
      return json(200, { dryRun: true, validation, rails: rails.length, actions: preview.map((d) => d.id) });
    }
    const value = {
      title: a.title ?? a.name,
      ...(a.source ? { source: a.source } : {}),
      nodes,
      arrows: arrows.map((e) => ({ ...e, rel: ARROW_RELS[e.arrow] ?? 'flows-to' })),
      rails,
      // Substrate keys a decision at an agent rail should read for context
      // (e.g. a tending machine points at `tending/latest`). models.decide
      // includes their current values in the prompt.
      ...(Array.isArray(a.context) ? { context: a.context } : {}),
      nodeCount: nodes.length,
      arrowCount: arrows.length,
    };
    await emit({
      key: `machine/${a.name}`,
      value,
      type: 'machine',
      tags: [...new Set(['machine', 'dygram', ...(Array.isArray(a.tags) ? a.tags : [])])],
      via: 'machine.define_machine',
    });
    // Project the rails into invokable, guarded declared actions (v2 → v3).
    // The run advances by invoking these; agent rails surface as `decide-*`.
    let projected = [];
    const subscriptions = [];
    if (a.project !== false && rails.length) {
      projected = projectActions(a.name, nodes, rails);
      for (const def of projected) await emitAction(def, a.name);
      // Opt-in reactivity. Two modes:
      //  - `reactive: "step"` (ADR-0018, preferred): ONE subscription delivers
      //    every run change to machine.step, which walks the deterministic prefix
      //    in-process (no per-auto-rail cascade) and runs the join barrier itself.
      //    The agent/task/work model deliveries still stand; the auto/fan/join
      //    subs are gone (step subsumes them).
      //  - `reactive: true` (legacy): the full per-auto-rail invoke + agentic-join
      //    projection. Kept so existing machines don't break; migrate to "step".
      if (a.reactive === 'step') {
        const stepSub = projectStepSubscription(a.name, OWNER);
        await emitSubscription(stepSub, a.name);
        subscriptions.push(stepSub.id);
        for (const s of projectSubscriptions(a.name, rails, OWNER)) {
          if (s.deliver && s.deliver.includes('/models.') && !s.id.includes('.join-')) {
            await emitSubscription(s, a.name);
            subscriptions.push(s.id);
          }
        }
      } else if (a.reactive) {
        for (const s of projectSubscriptions(a.name, rails, OWNER)) {
          await emitSubscription(s, a.name);
          subscriptions.push(s.id);
        }
      }
      // Internal trigger (always, when projecting): writing one fact
      // `machine-trigger/<name>/<run>` starts a run — the substrate-native API
      // trigger the `trigger_run` tool (and any scheduled Claude Routine) targets.
      // `text` carries the trigger-context body onto the run. Registered even on
      // non-reactive machines so they are always externally fireable.
      const itrig = {
        id: `machine.${seg(a.name)}.itrigger`,
        match: { keyPrefix: `machine-trigger/${a.name}/` },
        invoke: `machine.${seg(a.name)}.start`,
        params: { run: '${keySuffix}', text: '${value.text}' },
      };
      await emitSubscription(itrig, a.name);
      subscriptions.push(itrig.id);
      // Optional trigger: a fact pattern that STARTS a run (e.g. a new capture,
      // or a tending audit). `runId` templates the run id from the event so each
      // occurrence gets its own run (default `${keySuffix}`); point it at a
      // unique field (e.g. `${value.at}`) for a recurring source like tending.
      if (a.trigger && typeof a.trigger === 'object') {
        const { runId, ...match } = a.trigger;
        const trig = { id: `machine.${seg(a.name)}.trigger`, match, invoke: `machine.${seg(a.name)}.start`, params: { run: typeof runId === 'string' ? runId : '${keySuffix}' } };
        await emitSubscription(trig, a.name);
        subscriptions.push(trig.id);
      }
    }
    return json(200, {
      defined: true,
      key: `machine/${a.name}`,
      nodes: nodes.length,
      arrows: arrows.length,
      rails: rails.length,
      actions: projected.map((d) => d.id),
      reactive: !!a.reactive,
      subscriptions,
      validation,
    });
  }

  return json(404, { error: `no route for ${method} ${path}` });
};
