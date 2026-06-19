/**
 * @c15r/machine — DyGram's ideas as substrate-native facts.
 *
 * A tier-2 cell that makes the concepts of DyGram (christopherdebeer/machine)
 * first-class in the substrate: a machine is a named subgraph of typed nodes
 * and typed arrows an agent rides as rails. See docs/machine-cell.md for the
 * full design and the DyGram→substrate mapping.
 *
 * Minimal cell contract (mirrors cells/reef-writer): GET /_tools advertises the
 * vocabulary; POST /_tools/<name> dispatches; writes go through the organ path
 * (substrate.write.requested), so the workspace applies them as facts in the
 * owner's slice with this cell as the attested writer. Edges (the 7 arrow rels)
 * and reads are the gateway's job (workspace.link / workspace.query type:machine).
 */
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const json = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** DyGram's seven arrows → substrate edge relations (see docs/machine-cell.md). */
const ARROW_RELS = {
  '->': 'flows-to',
  '-->': 'depends-on',
  '=>': 'causes',
  '<|--': 'inherits',
  '*-->': 'composes',
  'o-->': 'aggregates',
  '<-->': 'relates',
};

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
          description: 'Arrows: [{ from, arrow, to, label? }] where arrow is one of -> --> => <|-- *--> o--> <-->',
          items: { type: 'object' },
        },
        rails: {
          type: 'array',
          description: 'Optional explicit rails: [{ from, to, mode: "auto"|"agent", condition?(CEL) }]. Default: derived from arrows (-> auto, => agent).',
          items: { type: 'object' },
        },
        project: { type: 'boolean', description: 'Project rails into declared actions (default true)' },
        reactive: { type: 'boolean', description: 'Also register subscriptions so auto rails advance themselves on run changes (default false — driven only)' },
        trigger: { type: 'object', description: 'Optional fact pattern { type?, keyPrefix?, cel? } that STARTS a run (run id = the matched key suffix)' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['name'],
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

/** A safe `_actions/` id segment — declared-action ids must not contain "/". */
const seg = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '_');

/**
 * Rails from arrows (when not declared explicitly): a plain flow (`->`) is a
 * deterministic (auto) transition; a causation arrow (`=>`) is an agent-decision
 * rail — the doc's "escalate when reasoning needed". Other arrows (`-->`, `*-->`,
 * …) are structure, not transitions, so they don't become rails.
 */
function railsFrom(arrows, explicit) {
  if (Array.isArray(explicit) && explicit.length) {
    return explicit.map((r) => ({
      from: r.from,
      to: r.to,
      mode: r.mode === 'agent' ? 'agent' : 'auto',
      ...(r.condition ? { condition: r.condition } : {}),
    }));
  }
  const rails = [];
  for (const e of arrows) {
    if (e.arrow === '->') rails.push({ from: e.from, to: e.to, mode: 'auto' });
    else if (e.arrow === '=>') rails.push({ from: e.from, to: e.to, mode: 'agent' });
  }
  return rails;
}

/**
 * Project a machine's rails into cell-required declared actions in the owner's
 * slice (now permitted on the organ path). Each rail becomes an invokable,
 * guarded transition over a `machine-run/<run>` fact — execution IS invoking
 * these via the gateway, and the run fact's revision history is the trajectory
 * (effects-as-data). Spend reasoning only at agent rails:
 *   - start              seed a run at the entry node (no incoming rail)
 *   - <from>-to-<to>      auto rail: advance when the run is at `from`, no LLM
 *   - decide-<from>       agent rail: record the chosen branch as a `claim`,
 *                         then advance — the only place a model is invoked
 */
function projectionActions(name, nodes, rails) {
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
      description: `Start a run of "${name}" at ${entry}.`,
      params: { run: { type: 'string', required: true, description: 'Run id → machine-run/<run>' } },
      writes: [{ key: runKey, value: { machine: name, node: entry, status: 'running', startedAt: '${now}' }, type: 'machine-run', tags, ifAbsent: true }],
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

  for (const from of [...new Set(rails.filter((x) => x.mode === 'agent').map((x) => x.from))]) {
    const branches = rails.filter((x) => x.mode === 'agent' && x.from === from).map((x) => x.to);
    actions.push({
      id: `machine.${m}.decide-${seg(from)}`,
      description: `Agent rail at ${from}: record the chosen branch as a claim and advance. Branches: ${branches.join(', ')}.`,
      params: {
        run: { type: 'string', required: true },
        to: { type: 'string', required: true, enum: branches, description: 'The chosen branch' },
        statement: { type: 'string', description: 'Why this branch — becomes the claim' },
        confidence: { type: 'number', description: 'Calibrated belief 0..1' },
      },
      if: [{ key: runKey, path: 'node', op: 'eq', value: from }],
      writes: [
        { key: 'claims/${params.run}.' + seg(from), value: { statement: '${params.statement}', confidence: '${params.confidence}', machine: name, at: from, chose: '${params.to}' }, type: 'claim', tags: ['claim', 'machine', 'dygram'] },
        { key: runKey, value: { machine: name, node: '${params.to}', status: 'running', at: '${now}', via: `${from}=>decision` }, type: 'machine-run', tags },
      ],
    });
  }
  return actions;
}

/** Emit one cell-required declared action through the organ path. */
async function emitAction(def, name) {
  await emit({ key: `_actions/${def.id}`, value: def, type: 'action', tags: ['machine', `machine:${name}`], via: 'machine.project' });
}

/** Emit one cell-required reaction subscription through the organ path. */
async function emitSubscription(def, name) {
  await emit({ key: `_subscriptions/${def.id}`, value: def, type: 'subscription', tags: ['machine', `machine:${name}`], via: 'machine.project' });
}

/**
 * Subscriptions that make a machine reactive: one per AUTO rail, tying its
 * transition action to changes of this machine's runs. The generic reactor
 * invokes the action; the action's own `if` guard fires only the rail whose
 * `from` = the run's current node, so the deterministic prefix advances itself.
 * Agent rails get NO subscription — a run pauses there for a decision.
 */
function projectionSubscriptions(name, rails) {
  const m = seg(name);
  return rails
    .filter((x) => x.mode === 'auto')
    .map((r) => {
      const id = `machine.${m}.${seg(r.from)}-to-${seg(r.to)}`;
      return {
        id,
        match: { keyPrefix: 'machine-run/', cel: `value.machine == ${JSON.stringify(name)}` },
        invoke: id,
        params: { run: '${keySuffix}' },
      };
    });
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';

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
    return json(200, { bootstrapped: true, renderer: '_renderers/machine', view: '_views/machine-runs' });
  }

  if (method === 'POST' && path === '/_tools/define_machine') {
    const a = event.body ? JSON.parse(event.body) : {};
    if (!a.name) return json(400, { error: 'name is required' });
    const nodes = Array.isArray(a.nodes) ? a.nodes : [];
    const arrows = Array.isArray(a.arrows) ? a.arrows : [];
    const rails = railsFrom(arrows, a.rails);
    const value = {
      title: a.title ?? a.name,
      ...(a.source ? { source: a.source } : {}),
      nodes,
      arrows: arrows.map((e) => ({ ...e, rel: ARROW_RELS[e.arrow] ?? 'flows-to' })),
      rails,
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
      projected = projectionActions(a.name, nodes, rails);
      for (const def of projected) await emitAction(def, a.name);
      // Opt-in reactivity: subscribe each auto rail to this machine's runs, so
      // the deterministic prefix advances itself. Without `reactive`, the same
      // actions remain drivable by hand via workspace.invoke.
      if (a.reactive) {
        for (const s of projectionSubscriptions(a.name, rails)) {
          await emitSubscription(s, a.name);
          subscriptions.push(s.id);
        }
      }
      // Optional trigger: a fact pattern that STARTS a run (e.g. a new capture).
      if (a.trigger && typeof a.trigger === 'object') {
        const trig = { id: `machine.${seg(a.name)}.trigger`, match: a.trigger, invoke: `machine.${seg(a.name)}.start`, params: { run: '${keySuffix}' } };
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
