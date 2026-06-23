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
import { seg, ARROW_RELS, railsFrom, validateMachine, projectActions, projectSubscriptions, spawnChildrenWrites, disclose } from './engine';

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
        project: { type: 'boolean', description: 'Project rails into declared actions (default true)' },
        reactive: { type: 'boolean', description: 'Also register subscriptions so auto rails advance themselves on run changes (default false — driven only)' },
        trigger: { type: 'object', description: 'Optional fact pattern { type?, keyPrefix?, cel?, runId? } that STARTS a run. runId templates the run id from the event (default "${keySuffix}"); use e.g. "${value.at}" so a recurring source like tending gets a fresh run each time.' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['name'],
    },
    scope: null,
  },
  {
    name: 'validate_machine',
    description:
      'Static graph analysis over a machine (the DyGram validators we dropped when we stopped porting the language — see docs/machine.md). Pure, no write: reports dangling rails + missing entry (errors) and unreachable nodes, orphans, transition cycles, missing terminal (warnings). Pass { nodes, arrows?, rails? } — same shape as define_machine; rails default-derived from arrows. define_machine runs this itself and returns the result.',
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        nodes: { type: 'array', items: { type: 'object' }, description: 'Nodes: [{ name, kind?, title? }]' },
        arrows: { type: 'array', items: { type: 'object' }, description: 'Arrows (rails derived from these if `rails` omitted)' },
        rails: { type: 'array', items: { type: 'object' }, description: 'Explicit rails: [{ from, to, mode }]' },
      },
      required: ['nodes'],
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
    name: 'disclose',
    description:
      'Progressive-disclosure view of a machine (Agent-Skills tiering — see docs/machine.md). Pure/no-write over an inline { nodes, rails } (the def a driving agent already read). Level-1 (default): each node as a one-line descriptor + the rails leaving it as { to, mode, when } — the branch menu without bodies. Level-2: pass `node` to get that one node\'s full body + its outgoing rails. Keeps an agent\'s context small as a machine grows.',
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        nodes: { type: 'array', items: { type: 'object' } },
        arrows: { type: 'array', items: { type: 'object' } },
        rails: { type: 'array', items: { type: 'object' } },
        node: { type: 'string', description: 'If set, return Level-2 (this node\'s full body + outgoing rails)' },
      },
      required: ['nodes'],
    },
    scope: null,
  },
  {
    name: 'record_idea',
    description:
      'Record a DyGram idea as a first-class fact: a concept (an explanatory note) or a claim ({statement, confidence 0..1, support[]}). Makes the *ideas*, not just machines, addressable, salience-ranked, and linkable.',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Idea slug' },
        kind: { type: 'string', enum: ['concept', 'claim'], description: 'concept = note; claim = a confidence-bearing assertion' },
        statement: { type: 'string', description: 'The concept text or the claim statement' },
        confidence: { type: 'number', description: 'For a claim: calibrated belief in [0,1]' },
        support: { type: 'array', items: { type: 'string' }, description: 'For a claim: fact keys of the evidence' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['id', 'kind', 'statement'],
    },
    scope: null,
  },
  {
    name: 'register_meta_tool',
    description:
      'v4 — persist a tool constructed mid-run as a meta-tool fact (strategy: agent_backed | code_generation | composition), so the vocabulary grows during use, audited by provenance. If it carries a declared `action` ({id, writes[], if?, params?}), that action is also projected as cell-required vocabulary — instantly invocable.',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tool name (becomes key meta-tool/<name>)' },
        strategy: { type: 'string', enum: ['agent_backed', 'code_generation', 'composition'] },
        implementation: { type: 'string', description: 'How the tool is realised (prose, code, or a composition spec)' },
        action: { type: 'object', description: 'Optional declared action to project: { id, writes[], if?, enabled?, params? }' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['name', 'strategy'],
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

  if (method === 'POST' && path === '/_tools/validate_machine') {
    const a = event.body ? JSON.parse(event.body) : {};
    const nodes = Array.isArray(a.nodes) ? a.nodes : [];
    const rails = railsFrom(Array.isArray(a.arrows) ? a.arrows : [], a.rails);
    return json(200, validateMachine(nodes, rails));
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

  if (method === 'POST' && path === '/_tools/disclose') {
    const a = event.body ? JSON.parse(event.body) : {};
    const nodes = Array.isArray(a.nodes) ? a.nodes : [];
    const rails = railsFrom(Array.isArray(a.arrows) ? a.arrows : [], a.rails);
    const out = disclose(nodes, rails, a.node);
    return json(out.error ? 404 : 200, out);
  }

  if (method === 'POST' && path === '/_tools/define_machine') {
    const a = event.body ? JSON.parse(event.body) : {};
    if (!a.name) return json(400, { error: 'name is required' });
    const nodes = Array.isArray(a.nodes) ? a.nodes : [];
    const arrows = Array.isArray(a.arrows) ? a.arrows : [];
    const rails = railsFrom(arrows, a.rails);
    const validation = validateMachine(nodes, rails);
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
      // Opt-in reactivity: subscribe each auto rail to this machine's runs, so
      // the deterministic prefix advances itself. Without `reactive`, the same
      // actions remain drivable by hand via workspace.invoke.
      if (a.reactive) {
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

  if (method === 'POST' && path === '/_tools/record_idea') {
    const a = event.body ? JSON.parse(event.body) : {};
    if (!a.id || !a.kind || !a.statement) return json(400, { error: 'id, kind, and statement are required' });
    const key = a.kind === 'claim' ? `claims/${a.id}` : `concept/${a.id}`;
    const value =
      a.kind === 'claim'
        ? { statement: a.statement, ...(a.confidence != null ? { confidence: a.confidence } : {}), ...(Array.isArray(a.support) ? { support: a.support } : {}) }
        : { content: a.statement };
    await emit({
      key,
      value,
      type: a.kind,
      tags: [...new Set([a.kind, 'dygram', 'machine', ...(Array.isArray(a.tags) ? a.tags : [])])],
      via: 'machine.record_idea',
    });
    return json(200, { recorded: true, key });
  }

  if (method === 'POST' && path === '/_tools/register_meta_tool') {
    // v4 — meta-tools as registered substrate tools: a tool constructed during
    // a run persists as a `meta-tool` fact, and (when it carries a declared
    // `action`) is projected as a cell-required declared action, so the
    // vocabulary grows during use, audited by provenance.
    const a = event.body ? JSON.parse(event.body) : {};
    if (!a.name || !a.strategy) return json(400, { error: 'name and strategy are required' });
    await emit({
      key: `meta-tool/${seg(a.name)}`,
      value: { name: a.name, strategy: a.strategy, ...(a.implementation ? { implementation: a.implementation } : {}) },
      type: 'meta-tool',
      tags: [...new Set(['meta-tool', 'dygram', 'machine', ...(Array.isArray(a.tags) ? a.tags : [])])],
      via: 'machine.register_meta_tool',
    });
    let action;
    if (a.action && a.action.id && Array.isArray(a.action.writes)) {
      action = a.action.id;
      await emitAction(a.action, a.name);
    }
    return json(200, { registered: true, key: `meta-tool/${seg(a.name)}`, ...(action ? { action } : {}) });
  }

  return json(404, { error: `no route for ${method} ${path}` });
};
