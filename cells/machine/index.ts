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
import { seg, railsFrom, validateMachine, projectActions, projectSubscriptions, spawnChildrenWrites, step, specFromYield, parentOf, barrierAdvance, mkey, assembleMachine, decomposeWrites, contextBindsOf, machineRails } from './engine';
// The shared SERVER-side substrate client (ADR-0017) — read/query/emit/supersede
// over the owner's slice. Vendored (not a URL import): the forge bundler
// only bundles relative imports within the cell dir + esm.sh-declared deps; a
// server-side `https://` import HANGS the bundler (the browser kernel's URL is
// browser-fetched, never server-bundled). Canonical source: cells/kernel/static/
// substrate.js — materialized at push by the cell-sync vendor overlay
// (ADR-0076), which retired this cell's manual keep-in-sync copy.
// eslint-disable-next-line import/no-unresolved
import { createSubstrate } from './vendor/substrate.js';

const json = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const readFile = (rel) => readFileSync(join(__dirname, rel), 'utf8');

/** The SPA's first-paint seed from the dispatch-proxied ssr.json reads (run AS
 *  the caller). Present on any authed top-level navigation the cell's ssr.json
 *  scopes — `/` (list), `/m/<slug>` (a machine), `/r/<runKey>` (a run). `path` is
 *  the cell-relative route the client hydrates against; `owner` localizes links. */
function buildBoot(user, ssr, path) {
  const s = ssr ?? {};
  const ent = (k) => (s[k] && s[k].entries) || [];
  // Identities only (bare `machine/<name>`); node/rail/run facts are separate types.
  const machines = ent('machines').filter((e) => String(e.key).startsWith('machine/') && String(e.key).slice('machine/'.length).indexOf('/') < 0);
  // A `/r/<key>` deep link seeds the single run fact via a `run` peek (Entry|null);
  // fold it into runs so RunView paints from the boot.
  const runs = ent('runs').slice();
  const runFact = s.run && typeof s.run === 'object' && s.run.key ? s.run : null;
  if (runFact && !runs.some((r) => r.key === runFact.key)) runs.push(runFact);
  return { session: { user: user ?? null }, machines, nodes: ent('nodes'), rails: ent('rails'), runs, path: path ?? '/', owner: OWNER };
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

/**
 * ADR-0039 — the machine cell's CONVERSATIONAL renderer for `machine-run` facts,
 * served at `/renderers/machine-run.js` and declared on the type as
 * `handlers.render[].renderer = ui://@c15r/machine/renderers/machine-run.js`. The
 * parc.land card (the conversation surface) fetches this over the host proxy and
 * runs it. This is the SAME trace→mermaid diagram that used to be hardcoded in the
 * gateway card; it now lives with the type it renders, so changing it is a cell
 * deploy, not a platform cdk deploy. A self-registering classic script (no module/
 * eval — the card's sandbox forbids those): it adds itself to `window.__parcRender`
 * under its type name. Backtick-free so it nests in this template literal.
 */
const MACHINE_RUN_RENDERER_SRC = `
(function(){
  // VALIDATION SENTINEL (ADR-0039): bump BUILD + cells.deploy ONLY (no cdk deploy)
  // to prove the renderer changed via the cell plane. The footer badge below is
  // emitted ONLY by this cell-served renderer — the old hardcoded card path
  // mounted the bare SVG with no badge — so its presence in claude.ai is
  // conclusive proof the federated ui:// renderer ran (not a cached card, not the
  // fields-hint fallback).
  var BUILD = 'v3';
  var reg = (window.__parcRender = window.__parcRender || {});
  var M;
  function loadMermaid(){
    if(!M){ M = import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs').then(function(m){ m.default.initialize({startOnLoad:false,securityLevel:'strict',theme:'neutral'}); return m.default; }); }
    return M;
  }
  function e(s){ return String(s==null?'':s).replace(/["\\n|]/g,' '); }
  function toMermaid(v){
    var trace = Array.isArray(v.trace) ? v.trace : [];
    if(!trace.length && v.node) trace = [{node: v.node}];
    var lines = ['flowchart TD'];
    for(var i=0;i<trace.length;i++){
      var lbl = e(trace[i].node || '?');
      if(i>0){ var via = trace[i].via ? '|'+e(trace[i].via)+'|' : ''; lines.push('  n'+(i-1)+' -->'+via+' n'+i+'["'+lbl+'"]'); }
      else lines.push('  n0["'+lbl+'"]');
    }
    var cur=-1; for(var j=trace.length-1;j>=0;j--){ if(trace[j].node===v.node){ cur=j; break; } }
    if(cur<0) cur=trace.length-1;
    if(cur>=0){ lines.push('  classDef cur fill:#6d5ef0,color:#fff,stroke:#6d5ef0;'); lines.push('  class n'+cur+' cur;'); }
    return lines.join('\\n');
  }
  function badge(){
    return '<div style="font:11px ui-monospace,SFMono-Regular,Menlo,monospace;opacity:.7;margin-top:6px;padding-top:5px;border-top:1px solid rgba(127,127,127,.25)">▶ rendered by @c15r/machine · federated ui:// renderer · '+BUILD+'</div>';
  }
  function h(s){ return String(s==null?'':s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]; }); }
  function ex(s,n){ s=String(s==null?'':s); return s.length>n ? s.slice(0,n)+'…' : s; }
  var COLORS = { running:'#6d5ef0', done:'#2a8a2a', failed:'#c33', waiting:'#d98800', sectioning:'#0886c8', voting:'#0886c8' };
  function chip(txt, color){ return '<span style="display:inline-block;padding:1px 7px;border-radius:9px;font:11px ui-monospace,monospace;color:#fff;background:'+(color||'#888')+'">'+h(txt)+'</span>'; }
  function header(v){
    var bits = ['<span style="font-weight:650">'+h(v.machine||'run')+'</span>', chip(v.status||'?', COLORS[v.status]), '<span>at <b>'+h(v.node||'?')+'</b></span>'];
    if(v.mode) bits.push(chip(v.mode, v.mode==='driven' ? '#333' : '#888'));
    if(typeof v.failures==='number' && v.failures>0) bits.push(chip(v.failures+' failure'+(v.failures>1?'s':''), '#c33'));
    if(v.waitUntil) bits.push('<span style="opacity:.75">until '+h(v.waitUntil)+'</span>');
    return '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px">'+bits.join(' ')+'</div>';
  }
  function claimRows(entries){
    if(!entries.length) return '';
    var rows = entries.map(function(f){
      var c = f.value||{};
      var conf = (typeof c.confidence==='number') ? ' <span style="opacity:.7">('+c.confidence+')</span>' : '';
      return '<li><b>'+h(c.at||'?')+'</b> → '+h(c.chose||'?')+conf+(c.statement?'<div style="opacity:.85;margin:1px 0 4px">'+h(ex(c.statement,280))+'</div>':'')+'</li>';
    }).join('');
    return '<details open style="margin-top:6px"><summary style="cursor:pointer">claims — the reasoning trail ('+entries.length+')</summary><ul style="margin:4px 0 2px;padding-left:18px">'+rows+'</ul></details>';
  }
  var seq=0;
  reg['machine-run'] = function(host, value, api){
    try{
      host.textContent='…';
      var v = value || {};
      var src = toMermaid(v);
      var claims = (api && api.key && typeof api.call==='function')
        ? api.call('read','workspace.query',{ prefix: api.key + '/claim/', limit: 50 }).then(function(r){ return (r && r.entries) || []; }).catch(function(){ return []; })
        : Promise.resolve([]);
      Promise.all([loadMermaid().then(function(m){ return m.render('mr'+(++seq), src); }), claims])
        .then(function(res){ host.innerHTML = header(v) + res[0].svg + claimRows(res[1]) + (v.text?'<details><summary style="cursor:pointer">trigger context</summary><div style="opacity:.85;margin:3px 0">'+h(ex(v.text,600))+'</div></details>':'') + badge(); })
        .catch(function(err){ host.innerHTML = header(v) + '<div class="hint">machine-run: '+e((err&&err.message)||err)+'</div>' + badge(); });
    }catch(err){ host.innerHTML = '<div class="hint">machine-run render error</div>' + badge(); }
  };
})();
`;

/**
 * ADR-0039 — the machine cell's CONVERSATIONAL renderer for the `machine` DEFINITION
 * (the identity fact `machine/<name>`), served at `/renderers/machine.js` and declared
 * on the type. Unlike machine-run, the identity fact carries no graph — the nodes/rails
 * are separate `machine-node`/`machine-rail` facts nested under the key — so this
 * renderer is INTERACTIVE: it fetches its children over the host-proxied `api.call`
 * (`api.key` → `workspace.query` by prefix) and assembles the node/rail graph. That
 * exercises the federated renderer's read path (host proxy under enforceScope), not
 * just static rendering. Backtick-free so it nests in this template literal.
 */
const MACHINE_DEF_RENDERER_SRC = `
(function(){
  var BUILD = 'v3';
  var reg = (window.__parcRender = window.__parcRender || {});
  var M;
  function loadMermaid(){
    if(!M){ M = import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs').then(function(m){ m.default.initialize({startOnLoad:false,securityLevel:'strict',theme:'neutral'}); return m.default; }); }
    return M;
  }
  function e(s){ return String(s==null?'':s).replace(/["\\n|]/g,' '); }
  function sid(s){ return String(s==null?'n':s).replace(/[^A-Za-z0-9_]/g,'_'); }
  function entriesOf(r){ return (r && Array.isArray(r.entries)) ? r.entries : []; }
  function h(s){ return String(s==null?'':s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]; }); }
  function ex(s,n){ s=String(s==null?'':s); return s.length>n ? s.slice(0,n)+'…' : s; }
  var MODE_STROKE = { agent:'#6d5ef0', work:'#0a8f7a', 'work-code':'#0a8f7a', task:'#b48ead', section:'#0886c8', vote:'#0886c8', 'catch':'#c33', wait:'#d98800' };
  function toMermaid(nodes, rails, entry){
    var lines = ['flowchart TD'];
    for(var i=0;i<nodes.length;i++){
      var v=nodes[i].value||{};
      // A node that carries a brief or context binds is marked so the diagram
      // shows where the DETAIL lives (the list below carries the detail itself).
      var mark = (v.prompt?'✎':'') + ((v.context&&v.context.length)?'⛁':'');
      lines.push('  '+sid(v.name)+'["'+e(v.title||v.name)+(mark?' '+mark:'')+'"]');
    }
    var styles=[];
    for(var j=0;j<rails.length;j++){
      var r=rails[j].value||{};
      var lbl=e(r.mode||'') + (r.when?': '+e(ex(r.when,28)):(r.condition?': ⟨'+e(ex(r.condition,24))+'⟩':''));
      lines.push('  '+sid(r.from)+' -->'+(lbl?'|'+lbl+'|':'')+' '+sid(r.to));
      var stroke = MODE_STROKE[r.mode];
      if(stroke) styles.push('  linkStyle '+j+' stroke:'+stroke+',stroke-width:2px'+((r.mode==='catch'||r.mode==='wait')?',stroke-dasharray:4 3':'')+';');
    }
    lines = lines.concat(styles);
    if(entry){ lines.push('  classDef entry fill:#6d5ef0,color:#fff,stroke:#6d5ef0;'); lines.push('  class '+sid(entry)+' entry;'); }
    return lines.join('\\n');
  }
  function railRow(r){
    var facets=[];
    if(r.when) facets.push('<i>when</i> '+h(r.when));
    if(r.condition) facets.push('<i>if</i> <code>'+h(r.condition)+'</code>');
    if(r.for!==undefined) facets.push('<i>wait</i> '+h(r.for));
    if(Array.isArray(r.tools)&&r.tools.length) facets.push('<i>tools</i> '+h(r.tools.join(', ')));
    if(r.grants) facets.push('<i>grants</i> <code>'+h(ex(JSON.stringify(r.grants),90))+'</code>');
    if(r.scope) facets.push('<i>scope</i> <code>'+h(ex(JSON.stringify(r.scope),90))+'</code>');
    if(typeof r.maxTurns==='number') facets.push('<i>maxTurns</i> '+r.maxTurns);
    if(typeof r.samples==='number') facets.push('<i>samples</i> '+r.samples);
    if(r.branch) facets.push('<i>branch</i> '+h(r.branch));
    if(Array.isArray(r.sections)) facets.push('<i>sections</i> '+h(r.sections.map(function(s){return s.to;}).join(', ')));
    var head = '<b>'+h(r.from)+'</b> →'+' <b>'+h(r.to)+'</b> <span style="color:'+(MODE_STROKE[r.mode]||'#888')+';font:11px ui-monospace,monospace">['+h(r.mode||'auto')+']</span>';
    var body = facets.length ? '<div style="opacity:.85;margin:1px 0 2px">'+facets.join(' · ')+'</div>' : '';
    var prompt = r.prompt ? '<details style="margin:1px 0 3px"><summary style="cursor:pointer;opacity:.8">prompt ('+r.prompt.length+' chars)</summary><div style="white-space:pre-wrap;opacity:.9;font-size:12px">'+h(r.prompt)+'</div></details>' : '';
    return '<li style="margin-bottom:3px">'+head+body+prompt+'</li>';
  }
  function nodeRow(v){
    if(!v.prompt && !(v.context&&v.context.length) && !v.kind) return '';
    var bits=['<b>'+h(v.name)+'</b>'];
    if(v.kind) bits.push('<span style="opacity:.7">['+h(v.kind)+']</span>');
    if(v.context&&v.context.length) bits.push('<i>context</i> '+h(v.context.map(function(c){return typeof c==='string'?c:(c&&c.bind)||'';}).join(', ')));
    var prompt = v.prompt ? '<details style="margin:1px 0 3px"><summary style="cursor:pointer;opacity:.8">brief ('+v.prompt.length+' chars)</summary><div style="white-space:pre-wrap;opacity:.9;font-size:12px">'+h(v.prompt)+'</div></details>' : '';
    return '<li style="margin-bottom:3px">'+bits.join(' ')+prompt+'</li>';
  }
  function detail(idv, nodes, rails){
    var hd=[];
    if(idv&&idv.entry) hd.push('<i>entry</i> <b>'+h(idv.entry)+'</b>');
    if(idv&&idv.reactive===false) hd.push('<i>driven-only</i>');
    if(idv&&Array.isArray(idv.context)&&idv.context.length) hd.push('<i>context</i> '+h(idv.context.join(', ')));
    var out = hd.length ? '<div style="margin:5px 0 2px;opacity:.9">'+hd.join(' · ')+'</div>' : '';
    var nrows = nodes.map(function(f){ return nodeRow(f.value||{}); }).filter(Boolean).join('');
    if(nrows) out += '<details style="margin-top:4px"><summary style="cursor:pointer">nodes — briefs + context binds</summary><ul style="margin:4px 0;padding-left:18px">'+nrows+'</ul></details>';
    var rrows = rails.map(function(f){ return railRow(f.value||{}); }).join('');
    if(rrows) out += '<details open style="margin-top:4px"><summary style="cursor:pointer">rails — the mechanics ('+rails.length+')</summary><ul style="margin:4px 0;padding-left:18px;list-style:none">'+rrows+'</ul></details>';
    return out;
  }
  function badge(n, m){
    return '<div style="font:11px ui-monospace,SFMono-Regular,Menlo,monospace;opacity:.7;margin-top:6px;padding-top:5px;border-top:1px solid rgba(127,127,127,.25)">▶ machine definition · '+n+' nodes · '+m+' rails · federated ui:// renderer · '+BUILD+'</div>';
  }
  var seq=0;
  reg['machine'] = function(host, value, api){
    var key = (api && api.key) || '';
    if(!key || !api || typeof api.call !== 'function'){ host.innerHTML = '<div class="hint">machine: no key/host context</div>'; return; }
    host.textContent = 'assembling machine…';
    Promise.all([
      api.call('read','workspace.query',{ prefix: key + '/node/', limit: 300 }),
      api.call('read','workspace.query',{ prefix: key + '/rail/', limit: 300 })
    ]).then(function(res){
      var nodes = entriesOf(res[0]), rails = entriesOf(res[1]);
      if(!nodes.length && !rails.length){ host.innerHTML = '<div class="hint">'+e((value&&value.title)||key)+' — no nodes/rails found</div>' + badge(0,0); return; }
      var src = toMermaid(nodes, rails, value && value.entry);
      return loadMermaid().then(function(m){ return m.render('md'+(++seq), src); }).then(function(r){ host.innerHTML = r.svg + detail(value, nodes, rails) + badge(nodes.length, rails.length); });
    }).catch(function(err){ host.innerHTML = '<div class="hint">machine: '+e((err&&err.message)||err)+'</div>' + badge(0,0); });
  };
})();
`;

/**
 * ADR-0039 Inc 2 — a TOOL-result renderer: the conversational card for
 * `define_machine`'s result (a plan/preview structure, not a fact). Declared on the
 * tool descriptor (`ui`) rather than on a type; the gateway stamps it onto the result
 * as `_render` and the card runs it through the same `window.__parcRender` consumer
 * — keyed by `as` ("machine.define_machine") rather than a fact type. Renders the
 * validation + the fan of facts/actions/subscriptions a define would write (and what
 * it would supersede). Backtick-free so it nests in this template literal.
 */
const MACHINE_DEFINE_RENDERER_SRC = `
(function(){
  var BUILD = 'v1';
  var reg = (window.__parcRender = window.__parcRender || {});
  function e(s){ return String(s==null?'':s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]; }); }
  function li(a){ return '<ul style="margin:4px 0 6px;padding-left:18px">'+(a||[]).map(function(x){ return '<li>'+e(typeof x==='string'?x:JSON.stringify(x))+'</li>'; }).join('')+'</ul>'; }
  function badge(){ return '<div style="font:11px ui-monospace,SFMono-Regular,Menlo,monospace;opacity:.7;margin-top:6px;padding-top:5px;border-top:1px solid rgba(127,127,127,.25)">▶ rendered by @c15r/machine · TOOL renderer (define_machine) · '+BUILD+'</div>'; }
  reg['machine.define_machine'] = function(host, value){
    var v = value || {};
    var val = v.validation || {};
    var facts = v.facts || [], actions = v.actions || [], subs = v.subscriptions || [], sup = v.wouldSupersede || v.superseded || [];
    var st = val.stats || {};
    var ok = val.ok !== false;
    var errs = (val.errors || []).map(function(x){ return x && x.message ? x.message : String(x); });
    var h = '';
    h += '<div style="font-size:14px;font-weight:650;margin-bottom:2px">'+(v.dryRun?'⊘ Plan (dry run)':'✓ Defined')+': '+e(v.name||v.machine||'machine')+'</div>';
    h += '<div style="margin:2px 0">'+(ok?'<span style="color:#3a3">✓ valid</span>':'<span style="color:#c33">✗ '+e(errs.join('; '))+'</span>')+'</div>';
    h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0;font-variant-numeric:tabular-nums">';
    h += '<span>'+(st.nodes!=null?st.nodes:'?')+' nodes</span><span>·</span><span>'+(st.rails!=null?st.rails:'?')+' rails</span>'+(st.cyclic?'<span>·</span><span>cyclic</span>':'');
    h += '</div>';
    h += '<div style="opacity:.85">'+facts.length+' facts · '+actions.length+' actions · '+subs.length+' subscriptions'+(sup.length?(' · '+sup.length+' superseded'):'')+'</div>';
    if(facts.length) h += '<details style="margin-top:4px"><summary>facts ('+facts.length+')</summary>'+li(facts)+'</details>';
    if(sup.length) h += '<details><summary>would supersede ('+sup.length+')</summary>'+li(sup)+'</details>';
    host.innerHTML = h + badge();
  };
})();
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
      'Define a DyGram machine in DECOMPOSED form — like a canvas board or doc, the machine is an identity fact `machine/<name>` plus one `machine-node/*` fact per node and one `machine-rail/*` fact per rail (all nested under `machine/<name>/`). The rail facts carry mode/condition/prompt and their keys derive node→node graph edges (so neighbors/$graph/canvas render the machine for free). Also projects the run vocabulary: a `start` action + a `decide-*` per agent/task node, the single `step` subscription (the stateless stepper walks deterministic rails + runs the join barrier), and model deliveries for agent/work rails. Pass explicit `rails` to override arrow-derived ones, `project:false` to skip the run vocabulary, `reactive:false` for driven-only (drive with the `step` tool), `dryRun` to preview.',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Machine slug (becomes key machine/<name>)' },
        title: { type: 'string', description: 'Human title' },
        entry: { type: 'string', description: 'Explicit start node — needed for a CYCLIC machine (e.g. a circuit breaker) whose entry has incoming retry rails, so the zero-indegree heuristic cannot find it. Defaults to the first node with no incoming rail.' },
        source: { type: 'string', description: 'Optional original .dy source text' },
        nodes: {
          type: 'array',
          description: 'Nodes: [{ name, kind?, title?, prompt?, context? }]. `prompt` is the node\'s BRIEF — decision guidance at an agent node (leads the reactive decide prompt AND the driven yield\'s brief), work guidance elsewhere; it lives in the DEFINITION so a redefine regenerates instead of clobbering. `context` is the node\'s context binds (DyGram context nodes): fact keys (or {bind, as}) resolved at step time into the CEL scope (`ctx.<as>`) and the driven yield — machine-level `context` is inherited by every node.',
          items: { type: 'object' },
        },
        arrows: {
          type: 'array',
          description: 'Arrows: [{ from, arrow, to, label? }]. DyGram\'s relationship/rendering arrows are -> --> => <|-- *--> o--> <--> (stored as edge `rel`s; see ARROW_RELS). `~>`/`~>>` are NOT DyGram arrows — they are substrate-only rail syntax we add for task/work rails (see docs/machine.md).',
          items: { type: 'object' },
        },
        rails: {
          type: 'array',
          description: 'Optional explicit rails: [{ from, to, mode: "auto"|"agent"|"task"|"work"|"catch", condition?(CEL), prompt?, grants?, tools?, scope?, maxTurns?, maxMs? }]. `condition` (auto rails) is CEL over `{ value:<run>, now, nowMs, ctx }` — machine state, time, AND the node\'s resolved context binds, e.g. `value.deadline < now`, `nowMs - value.startedMs > 300000`, or `ctx.tending_latest.stale > 300` (a mechanical assessment that needs no agent node). `maxMs` is a soft per-step wall-clock budget (ms) the spawned work agent honours — bounds a step below the models cell Lambda ceiling (default ≈285s). A `catch` rail from a node fires only when that node`s work/agent step FAILED (`status:"failed"`), routing the run to a recovery node — the error-handling primitive (machine.md §13). NB: making rail mode explicit data — and the arrow→mode default below — is a substrate-only design choice, NOT a DyGram port: DyGram has no rail-mode enum and infers auto-vs-agent dynamically from node-type/out-degree/annotations (its `=>` is causation *styling*, not an agent marker). Our arrow→mode default: -> ⇒ auto, => ⇒ agent, ~> ⇒ task, ~>> ⇒ work. "work" SPAWNS @owner/models.agent at the node (machine-uses-agent): it runs `prompt` with scoped `grants` ({read,write[]}) and advances the run itself; `tools` is the allowlist of substrate tools it may call (the executor filters to it — docs/machine.md). "task" parks a claimable hand-off for a DRIVING agent instead.',
          items: { type: 'object' },
        },
        dryRun: { type: 'boolean', description: 'Validate + preview the decomposition facts + projected action/subscription ids WITHOUT writing anything.' },
        project: { type: 'boolean', description: 'Project the run vocabulary (start + decide actions, step + model-delivery subscriptions, triggers). Default true.' },
        reactive: { type: 'boolean', description: 'Register the step subscription so runs self-drive on change (default true). Pass false for a driven-only machine you advance by hand with the `step` tool.' },
        context: { type: 'array', items: { type: 'string' }, description: 'Substrate keys a decision should read for context (e.g. tending/latest); stored on the identity fact.' },
        trigger: { type: 'object', description: 'Optional fact pattern { type?, keyPrefix?, cel?, runId? } that STARTS a run. runId templates the run id from the event (default "${keySuffix}"); use e.g. "${value.at}" so a recurring source like tending gets a fresh run each time.' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['name'],
    },
    scope: null,
    // ADR-0039 Inc 2: a cell-authored renderer for this TOOL's result (plan/preview).
    // The gateway stamps it onto the result as `_render`; the card runs it under `as`.
    ui: { renderer: 'ui://@c15r/machine/renderers/define-plan.js', as: 'machine.define_machine' },
  },
  {
    name: 'trigger_run',
    description:
      'Fire a run of a machine by name — the canonical "scheduled routine / API trigger" entry (mirrors Claude Code Routines\' API trigger). Writes machine/<machine>/trigger/<run>; the machine\'s standing internal-trigger subscription starts the run at its entry node, injecting `text` as run context. Auto-generates `run` if omitted. The machine must have been define_machine\'d with projection on. `mode:"driven"` (ADR-0065) starts the run PARKED: the reactive step/decide/work subscriptions skip it, so a capable external driver (e.g. a scheduled Claude routine) advances it via the `step` tool and resolves each decision itself — no model is spawned. Omit (or "reactive") for the autonomous, models-backed path. Same machine, either mode.',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        machine: { type: 'string', description: 'Machine slug (the <name> in machine/<name>)' },
        run: { type: 'string', description: 'Optional run id (auto-generated if omitted)' },
        text: { type: 'string', description: 'Trigger-context body (like a Routine `text` payload) — stored on the run for the entry agent' },
        mode: { type: 'string', enum: ['reactive', 'driven'], description: 'ADR-0065 drive mode. "driven" = park for an external stepper (capable-agent driven); default/absent = reactive (auto-driven by the step + model-delivery subscriptions).' },
      },
      required: ['machine'],
    },
    scope: null,
  },
  {
    name: 'step',
    description:
      'Advance a machine run STATELESSLY (ADR-0018) — and, with `decide`, resolve the decision it is parked at in the same call (the DRIVE verb, ADR-0065). Assembles the machine from its decomposed facts, reads machine/<machine>/run/<run>, follows deterministic `auto` rails IN-PROCESS (CEL-guarded, ctx.* bound from the node\'s declared context binds), and emits at most ONE advanced run fact (carrying the execution `trace`). Returns the `yield` — the point where a decision is owed: `{kind, node, choices, mode?, brief?{prompt,text}, advance?}` plus `context` (the node\'s declared context binds, RESOLVED — no follow-up reads needed) — or null when the run completed. THE DRIVE LOOP: trigger_run {mode:"driven"} → step → read the yield\'s brief/choices/context, exercise judgment → step again with decide:{to, statement, confidence} — the cell writes the claim AND the merge-preserving advance (mode/text/trace all survive; the two classic driven-mode footguns are gone) — repeat until yield is null (the run closed itself). On a section/vote yield it spawns the children (inheriting the run\'s mode); the join barrier is deterministic. Idempotent: a parked run without `decide` emits nothing.',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        machine: { type: 'string', description: 'Machine slug (the <name> in machine/<name>)' },
        run: { type: 'string', description: 'Run id → machine/<machine>/run/<run>' },
        decide: {
          type: 'object',
          description: 'Resolve the decision the run is parked at, then step: {to: <a branch from the yield choices>, statement: <why — becomes the claim>, confidence: <0..1>}. The cell records the claim (machine/<m>/run/<run>/claim/<node>) and advances with a MERGE (mode, text, failures, trace preserved) — safer than hand-writing the run or the decide-* action for driven runs.',
          properties: {
            to: { type: 'string', description: 'The chosen branch (must be one of the yield\'s choices)' },
            statement: { type: 'string', description: 'Why this branch — the claim\'s statement' },
            confidence: { type: 'number', description: 'Calibrated belief 0..1' },
          },
          required: ['to'],
        },
      },
      required: ['machine', 'run'],
    },
    scope: null,
  },
  {
    name: 'describe_machine',
    description:
      'The REVISOR surface: return a machine\'s full definition AS CONTENT — the exact `define_machine` input that reproduces it (nodes with prompts/context binds, rails with conditions/prompts/grants/tools) — plus validation, the projected vocabulary a redefine would regenerate, DRIFT (live _actions/_subscriptions that differ from that regeneration: hand-patched prompts a redefine would CLOBBER — fold them into the definition first), and the machine\'s open runs (parked yields = standing obligations). Read this before editing any machine; iterate by round-tripping: describe_machine → edit the returned definition → define_machine {dryRun:true} → define_machine.',
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        machine: { type: 'string', description: 'Machine slug (the <name> in machine/<name>)' },
      },
      required: ['machine'],
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
/** Assemble a machine's in-memory def from its DECOMPOSED facts (identity + node +
 *  rail facts, all under the `machine/<name>/` namespace). Returns null if absent. */
async function loadMachine(sub, machineName) {
  const idFact = await sub.read(mkey.machine(machineName));
  if (!idFact) return null;
  const base = mkey.machine(machineName);
  const [nodeFacts, railFacts] = await Promise.all([
    sub.query({ prefix: `${base}/node/` }),
    sub.query({ prefix: `${base}/rail/` }),
  ]);
  // The slug we loaded by is authoritative for `name` — legacy identities (pre
  // name-on-identity) assemble with name = title, which mangles anything derived
  // from it (the yield's advance action id: seg("Drive-surface proof…") ≠ slug).
  return { ...assembleMachine(idFact, nodeFacts, railFacts), name: machineName };
}

async function stepRun(machineName, runId, decide) {
  const sub = createSubstrate({ owner: OWNER, via: 'machine.step' });
  const now = new Date().toISOString();
  const runKey = mkey.run(machineName, runId);
  const runFact = await sub.read(runKey);
  if (!runFact) return { error: `no run ${runKey}` };
  const original = runFact.value || {};
  let runValue = original;
  const mName = runValue.machine || machineName;
  const machine = await loadMachine(sub, mName);
  if (!machine) return { error: `no machine ${mkey.machine(mName)}` };

  // `decide` (the driven advance, ADR-0065 ergonomics): the DRIVER supplies only
  // the judgment — {to, statement, confidence} — and the CELL performs the
  // mechanics: claim write + a MERGE-preserving advance (mode, text, failures,
  // trace all survive; only node/status/via move). This kills the two footguns
  // of hand-advancing: the mode-drop (run silently reverts to reactive) and the
  // "back UNCHANGED except…" merge each driver had to re-implement in-context.
  let claimed;
  if (decide && decide.to) {
    const at = runValue.node;
    // agent/task rails are decisions in any mode. A WORK rail is decidable only
    // on a DRIVEN run: the reactive work sub skips driven runs, so the DRIVER is
    // the executor at that node (protocol/machine-drive) — after doing the work,
    // step{decide} records the work summary as the claim and advances, exactly
    // like the spawned agent's own advance. Without this, a driven run parking
    // at a work yield forces the driver to hand-write the run fact.
    const driven = runValue.mode === 'driven';
    const decision = machineRails(machine).filter(
      (r) => r.from === at && (r.mode === 'agent' || r.mode === 'task' || (driven && (r.mode === 'work' || r.mode === 'work-code'))),
    );
    if (!decision.length) return { error: `node "${at}" owes no decision (no agent/task${driven ? '/work' : ''} rail)` };
    if (!decision.some((r) => r.to === decide.to)) {
      return { error: `"${decide.to}" is not a branch at "${at}" — choices: ${decision.map((r) => r.to).join(', ')}` };
    }
    claimed = mkey.claim(mName, runId, at);
    await sub.emit([
      {
        key: claimed,
        value: {
          statement: decide.statement ?? '',
          ...(typeof decide.confidence === 'number' ? { confidence: decide.confidence } : {}),
          machine: mName,
          at,
          chose: decide.to,
        },
        type: 'claim',
        tags: ['claim', 'machine', 'dygram'],
      },
    ]);
    runValue = { ...runValue, node: decide.to, status: 'running', via: `${at}=>decision`, at: now };
  }

  // Resolve the node's context binds (DyGram context nodes, first slice): the
  // values feed the CEL guards as `ctx.*` and ride back to the driver so its
  // yield arrives already grounded — no follow-up reads for declared context.
  const binds = contextBindsOf(machine, runValue.node);
  const ctx = {};
  const context = {};
  for (const b of binds) {
    try {
      const f = await sub.read(b.bind);
      if (f) { ctx[b.as] = f.value; context[b.bind] = f.value; }
    } catch { /* an unreadable bind is simply absent from ctx */ }
  }

  const result = step(runValue, machine, now, ctx);

  // A section/vote yield spawns children; the spawn writes include the parent's
  // wait-state (which supersedes the plain advance), so don't also emit `result.run`.
  if (result.yield && (result.yield.kind === 'section' || result.yield.kind === 'vote')) {
    const spec = specFromYield(result.yield);
    const writes = spawnChildrenWrites(runId, mName, spec, now, result.run);
    await sub.emit(writes);
    return { run: runId, machine: mName, node: result.yield.node, yield: result.yield, spawned: writes.slice(1).map((w) => w.key), ...(claimed ? { claimed } : {}) };
  }

  // Emit the advance only if the meaningful state changed (idempotent — so a
  // reactive deliver to a parked run is a cheap no-op, no loop). trace always rides.
  const changed = result.run.node !== original.node || result.run.status !== original.status || JSON.stringify(result.run.trace) !== JSON.stringify(original.trace);
  if (changed) {
    await sub.emit([{ key: runKey, value: result.run, type: 'machine-run', tags: ['machine', `machine:${mName}`] }]);
  }

  let barrier;
  if (result.run.status === 'done') {
    barrier = await advanceParentBarrier(sub, mName, runId, result.run, machine, now);
  }

  return {
    run: runId,
    machine: mName,
    node: result.run.node,
    status: result.run.status,
    ...(result.run.mode ? { mode: result.run.mode } : {}),
    changed,
    yield: result.yield ?? null,
    path: result.path,
    ...(Object.keys(context).length ? { context } : {}),
    ...(claimed ? { claimed } : {}),
    ...(barrier ? { barrier } : {}),
  };
}

/**
 * The deterministic join barrier shell: if `childRunId` is a section/vote child,
 * read the parent + all siblings (under the machine's run namespace) and let the
 * pure `barrierAdvance` decide whether to advance the parent.
 */
async function advanceParentBarrier(sub, machineName, childRunId, childRun, machine, now) {
  const rel = parentOf(childRunId);
  if (!rel) return null;
  const parent = await sub.read(mkey.run(machineName, rel.parent));
  if (!parent) return null;
  const siblings = await sub.query({ prefix: `${mkey.run(machineName, rel.parent)}${rel.sep}` });
  // Organ writes are async: the child-done write that triggered this step may not
  // have applied yet, so the just-completed child can read back stale. Overlay its
  // fresh value (and ensure it's present) so the barrier counts it.
  const childKey = mkey.run(machineName, childRunId);
  let sawChild = false;
  const merged = siblings.map((s) => {
    if (s.key === childKey) { sawChild = true; return { ...s, value: childRun }; }
    return s;
  });
  if (!sawChild) merged.push({ key: childKey, value: childRun });
  const decision = barrierAdvance(rel.parent, parent.value, merged, machine, now);
  if (!decision.advance) return { parent: rel.parent, waiting: true, done: decision.done, expected: decision.expected, reason: decision.reason };
  await sub.emit([decision.advance]);
  return { parent: rel.parent, advanced: true, node: decision.advance.value.node, done: decision.done, expected: decision.expected };
}


/**
 * The revisor surface (see the describe_machine tool description). Returns the
 * DEFINITION as re-definable content, what a redefine would project, the drift
 * between that and the live vocabulary (hand-patched subscription prompts are
 * exactly what this catches — the ADR-0065 tending clobber hazard), and the
 * machine's open runs. Read-only.
 */
async function describeMachine(machineName) {
  const sub = createSubstrate({ owner: OWNER, via: 'machine.describe' });
  const base = mkey.machine(machineName);
  const idFact = await sub.read(base);
  if (!idFact) return { error: `no machine ${base}` };
  const idv = idFact.value || {};
  const [nodeFacts, railFacts, liveActions, liveSubs, runFacts] = await Promise.all([
    sub.query({ prefix: `${base}/node/` }),
    sub.query({ prefix: `${base}/rail/` }),
    sub.query({ prefix: `_actions/machine.${seg(machineName)}.` }),
    sub.query({ prefix: `_subscriptions/machine.${seg(machineName)}.` }),
    sub.query({ prefix: `${base}/run/`, limit: 200 }),
  ]);
  const machine = assembleMachine(idFact, nodeFacts, railFacts);
  const reactive = idv.reactive !== false;

  // The round-trippable definition: feed this straight back to define_machine.
  const definition = {
    name: machineName,
    title: machine.title,
    entry: machine.entry,
    ...(Array.isArray(machine.context) ? { context: machine.context } : {}),
    reactive,
    nodes: machine.nodes,
    rails: machine.rails,
  };
  const validation = validateMachine(machine.nodes, machine.rails, machine.entry);

  // What a redefine would regenerate — compared against the LIVE vocabulary so a
  // revisor sees hand-patches before clobbering them.
  const expActions = projectActions(machineName, machine.nodes, machine.rails, machine.entry);
  const expSubs = reactive ? projectSubscriptions(machineName, machine.rails, OWNER, machine.context, machine.nodes) : [];
  const expected = new Map([
    ...expActions.map((d) => [`_actions/${d.id}`, d]),
    ...expSubs.map((s) => [`_subscriptions/${s.id}`, s]),
  ]);
  const drift = [];
  const norm = (v) => JSON.stringify(v);
  for (const f of [...liveActions, ...liveSubs]) {
    // itrigger/trigger subs are emitted outside projectSubscriptions — expected by id shape.
    if (/\.(itrigger|trigger)$/.test(f.key)) continue;
    const e = expected.get(f.key);
    if (!e) drift.push({ key: f.key, kind: 'live-only', note: 'a redefine would supersede this (not derivable from the definition)' });
    else if (norm(f.value) !== norm(e)) {
      drift.push({ key: f.key, kind: 'differs', note: 'live value differs from what this definition regenerates — hand-patched? Fold the difference into the definition (node.prompt / rail facets) before redefining, or it will be clobbered.' });
    }
  }
  for (const key of expected.keys()) {
    if (![...liveActions, ...liveSubs].some((f) => f.key === key)) drift.push({ key, kind: 'expected-missing', note: 'this definition projects it, but it is not live — the machine predates a projection change; a redefine adds it' });
  }

  // Open runs = the machine's standing obligations (parked yields, waits, fans).
  const isRun = (f) => !f.key.includes('/claim/');
  const open = runFacts
    .filter(isRun)
    .filter((f) => ['running', 'waiting', 'sectioning', 'voting'].includes(f.value?.status))
    .map((f) => ({
      run: f.key.slice(`${base}/run/`.length),
      node: f.value?.node,
      status: f.value?.status,
      ...(f.value?.mode ? { mode: f.value.mode } : {}),
      ...(f.value?.at ? { at: f.value.at } : {}),
    }));

  return {
    machine: machineName,
    definition,
    validation,
    projected: { actions: expActions.map((d) => d.id), subscriptions: expSubs.map((s) => s.id) },
    drift,
    runs: { total: runFacts.filter(isRun).length, open },
    guide: {
      drive: 'trigger_run {machine, mode:"driven", text?} → step {machine, run} → read the yield (brief, choices, resolved context) → step {machine, run, decide:{to, statement, confidence}} → repeat until yield is null.',
      revise: 'Edit `definition` above (prompts live on nodes, mechanics on rails) → define_machine {...definition, dryRun:true} → review wouldSupersede + drift → define_machine {...definition}. Run history is never touched.',
      create: 'define_machine {name, nodes:[{name, kind?, prompt?, context?}], rails:[{from, to, mode, condition?, when?, prompt?, grants?, tools?}], context?, entry?, dryRun:true} — arrows [-> auto, => agent, ~> task, ~>> work] may replace rails.',
    },
  };
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';

  // ── the SSR React SPA (the user frontend) ──────────────────────────────
  if (method === 'GET' && path === '/app.js') {
    return { statusCode: 200, headers: { 'content-type': 'application/javascript; charset=utf-8', 'access-control-allow-origin': '*' }, body: readFile('app.js') };
  }
  // ADR-0039: the conversational renderer for `machine-run`, fetched by the parc.land
  // card via the gateway provider hop (ui://@c15r/machine/renderers/machine-run.js).
  // ACAO:* + cacheable — it is non-sensitive static renderer code (data arrives via
  // the host-proxied tool calls, never embedded here).
  if (method === 'GET' && path === '/renderers/machine-run.js') {
    return { statusCode: 200, headers: { 'content-type': 'application/javascript; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' }, body: MACHINE_RUN_RENDERER_SRC };
  }
  // ADR-0039: the machine DEFINITION renderer (interactive — assembles nodes/rails
  // via the host-proxied call). Same federation rail as machine-run.
  if (method === 'GET' && path === '/renderers/machine.js') {
    return { statusCode: 200, headers: { 'content-type': 'application/javascript; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' }, body: MACHINE_DEF_RENDERER_SRC };
  }
  // ADR-0039 Inc 2: a TOOL-result renderer (define_machine), declared on the tool's
  // `ui` and stamped onto the result by the gateway as `_render`.
  if (method === 'GET' && path === '/renderers/define-plan.js') {
    return { statusCode: 200, headers: { 'content-type': 'application/javascript; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' }, body: MACHINE_DEFINE_RENDERER_SRC };
  }
  const isAppRoute = path === '/' || path === '' || path.startsWith('/m/') || path.startsWith('/r/');
  if ((method === 'GET' || method === 'HEAD') && isAppRoute) {
    try {
      const caller = event.headers && event.headers['x-cell-caller'];
      const authed = !!caller && caller !== 'anonymous';
      const boot = buildBoot(authed ? caller : null, event.ssrData, path);
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
    const run = a.run || `${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await emit({
      key: mkey.trigger(a.machine, run),
      value: { at: new Date().toISOString(), ...(a.text ? { text: a.text } : {}), ...(a.mode ? { mode: a.mode } : {}) },
      type: 'machine-trigger',
      tags: ['machine', `machine:${a.machine}`, 'trigger'],
      via: 'machine.trigger_run',
    });
    return json(200, { triggered: true, machine: a.machine, run, key: mkey.trigger(a.machine, run) });
  }

  if (method === 'POST' && path === '/_tools/step') {
    const a = event.body ? JSON.parse(event.body) : {};
    if (!a.run || !a.machine) return json(400, { error: 'run and machine are required' });
    try {
      const out = await stepRun(a.machine, a.run, a.decide);
      return json(out.error ? 404 : 200, out);
    } catch (err) {
      return json(500, { error: (err && err.message) || String(err) });
    }
  }

  if (method === 'POST' && path === '/_tools/describe_machine') {
    const a = event.body ? JSON.parse(event.body) : {};
    if (!a.machine) return json(400, { error: 'machine is required' });
    try {
      const out = await describeMachine(a.machine);
      return json(out.error ? 404 : 200, out);
    } catch (err) {
      return json(500, { error: (err && err.message) || String(err) });
    }
  }

  if (method === 'POST' && path === '/_tools/define_machine') {
    const a = event.body ? JSON.parse(event.body) : {};
    if (!a.name) return json(400, { error: 'name is required' });
    const nodes = Array.isArray(a.nodes) ? a.nodes : [];
    const rails = railsFrom(Array.isArray(a.arrows) ? a.arrows : [], a.rails);
    const validation = validateMachine(nodes, rails, a.entry);
    const project = a.project !== false;
    const reactive = a.reactive !== false; // stepper-on by default; pass reactive:false for driven-only

    // The DECOMPOSED definition fan: identity + one fact per node + per rail.
    const writes = decomposeWrites(a.name, nodes, rails, { title: a.title, source: a.source, ...(a.entry ? { entry: a.entry } : {}), ...(a.kind ? { kind: a.kind } : {}) });
    if (Array.isArray(a.context)) writes[0].value.context = a.context; // decide reads these
    writes[0].value.reactive = reactive; // surfaced to the UI toggle
    if (Array.isArray(a.tags)) writes[0].tags = [...new Set([...writes[0].tags, ...a.tags])];

    const actions = project ? projectActions(a.name, nodes, rails, a.entry) : [];
    const subs = project && reactive ? projectSubscriptions(a.name, rails, OWNER, a.context, nodes) : [];
    const sub = createSubstrate({ owner: OWNER, via: 'machine.define_machine' });

    // Which prior definition facts / projected vocabulary this re-definition would
    // retire (full-replace semantics — see the reconcile sweep below). Computed up
    // front so `dryRun` can preview the cleanup, not just the writes.
    const keepFacts = new Set(writes.map((w) => w.key));
    const keepActionKeys = new Set(actions.map((d) => `_actions/${d.id}`));
    // `subs` ⊂ the final projected sub set; itrigger/trigger are added at emit time
    // below, so include their ids here too or the preview would over-report them.
    const projectedSubIds = [
      ...subs.map((s) => s.id),
      ...(project ? [`machine.${seg(a.name)}.itrigger`] : []),
      ...(project && a.trigger && typeof a.trigger === 'object' ? [`machine.${seg(a.name)}.trigger`] : []),
    ];
    const keepSubKeys = new Set(projectedSubIds.map((id) => `_subscriptions/${id}`));
    const findStale = async (prefix, keep) => {
      let existing = [];
      try { existing = await sub.query({ prefix, limit: 200 }); } catch { return []; }
      return existing.map((f) => f.key).filter((k) => !keep.has(k));
    };
    const stalePrefixes = [
      [`${mkey.machine(a.name)}/node/`, keepFacts],
      [`${mkey.machine(a.name)}/rail/`, keepFacts],
      [`_actions/machine.${seg(a.name)}.`, keepActionKeys],
      [`_subscriptions/machine.${seg(a.name)}.`, keepSubKeys],
    ];

    if (a.dryRun) {
      const stale = (await Promise.all(stalePrefixes.map(([p, k]) => findStale(p, k)))).flat();
      return json(200, { dryRun: true, validation, facts: writes.map((w) => w.key), actions: actions.map((d) => d.id), subscriptions: subs.map((s) => s.id), wouldSupersede: stale });
    }

    // 1. Emit the decomposition fan reliably (FailedEntryCount-checked).
    await sub.emit(writes);
    // 2. Project declared actions (start + decide) + the stepper subscriptions.
    const subscriptions = [];
    for (const def of actions) await emitAction(def, a.name);
    for (const s of subs) { await emitSubscription(s, a.name); subscriptions.push(s.id); }
    // 3. Triggers: the internal `machine/<name>/trigger/<run>` start, plus any
    //    optional fact-pattern trigger (e.g. a tending audit) — always, when projecting.
    if (project) {
      const itrig = {
        id: `machine.${seg(a.name)}.itrigger`,
        match: { keyPrefix: `${mkey.machine(a.name)}/trigger/` },
        invoke: `machine.${seg(a.name)}.start`,
        params: { run: '${keySuffix}', text: '${value.text}', mode: '${value.mode}' }, // ADR-0065: carry mode trigger→run
      };
      await emitSubscription(itrig, a.name);
      subscriptions.push(itrig.id);
      if (a.trigger && typeof a.trigger === 'object') {
        const { runId, ...match } = a.trigger;
        const trig = { id: `machine.${seg(a.name)}.trigger`, match, invoke: `machine.${seg(a.name)}.start`, params: { run: typeof runId === 'string' ? runId : '${keySuffix}' } };
        await emitSubscription(trig, a.name);
        subscriptions.push(trig.id);
      }
    }
    // 4. Reconcile — a re-definition is a full replace, so supersede the prior
    //    definition facts and projected vocabulary this one no longer includes
    //    (a removed node/rail, or a branch whose mode flipped agent⇄work, would
    //    otherwise leave an orphan node/rail fact or a stale decide-/work- sub
    //    that double-fires). Scoped to this machine's `/node/` + `/rail/` facts
    //    and its `_actions`/`_subscriptions` only; run/trigger/decide/work/claim
    //    execution facts are run history and are never swept. (Same prefixes the
    //    dryRun preview used; subscriptions[] now holds the emitted itrigger/trigger.)
    const keepSubsFinal = new Set(subscriptions.map((id) => `_subscriptions/${id}`));
    const sweepSets = [
      [`${mkey.machine(a.name)}/node/`, keepFacts],
      [`${mkey.machine(a.name)}/rail/`, keepFacts],
      [`_actions/machine.${seg(a.name)}.`, keepActionKeys],
      [`_subscriptions/machine.${seg(a.name)}.`, keepSubsFinal],
    ];
    const superseded = [];
    for (const [prefix, keep] of sweepSets) {
      for (const key of await findStale(prefix, keep)) {
        try { await sub.supersede(key); superseded.push(key); } catch { /* best-effort */ }
      }
    }
    return json(200, {
      defined: true,
      key: mkey.machine(a.name),
      facts: writes.map((w) => w.key),
      nodes: nodes.length,
      rails: rails.length,
      actions: actions.map((d) => d.id),
      reactive,
      subscriptions,
      superseded,
      validation,
    });
  }

  return json(404, { error: `no route for ${method} ${path}` });
};
