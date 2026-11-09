/**
 * The drawer's stylesheet: injected once, on the first use of anything here (not on import: the lab is one bundle, and
 * a module's import shouldn't touch a page that doesn't use it). Every colour and size is a token with a fallback, so
 * a page keeps its own look by setting the tokens it already has:
 * `--card` (the drawer's ground), `--ink`, `--muted`, `--edge`, `--accent`, and `--dw-cap` (its height's cap).
 * A page's own `.paper` (or any) class that redefines them changes the drawer with it.
 */
const CSS = `
.dw-drawer{position:fixed;left:0;right:0;bottom:0;z-index:5;max-width:720px;margin:0 auto;box-sizing:border-box;overflow:hidden;
  padding:0 12px max(10px,env(safe-area-inset-bottom));background:var(--card,rgba(30,31,34,.88));color:var(--ink,#ecebe6);
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-top:1px solid var(--edge,#3a3c40);border-radius:14px 14px 0 0;
  display:flex;flex-direction:column;gap:6px;transition:height .34s cubic-bezier(.2,.9,.25,1);overscroll-behavior:contain}
.dw-drawer.held{transition:none}
.dw-drawer>*{flex:none}
/* (settled, what lies below its height isn't shown at all: no sliver of the next row under the grip, however deep the
   safe area; while it's dragged, everything shows, so the drag previews what it opens to) */
.dw-drawer:not(.held)[data-drawer=closed]>:not(.dw-grip),.dw-drawer:not(.held)[data-drawer=focus]>[data-tier="2"],.dw-drawer:not(.held)[data-drawer=focus]>[data-tier="2"]~*{visibility:hidden}
.dw-drawer[data-drawer=full]:not(.held){overflow-y:auto}
.dw-grip{all:unset;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:3px;flex:none;width:100%;padding:7px 0 3px;cursor:grab;touch-action:none;-webkit-tap-highlight-color:transparent}
.dw-grip::before{content:'';width:38px;height:4px;border-radius:2px;background:var(--muted,#9a9c98);opacity:.55}
.dw-grip:focus-visible{outline:2px solid var(--accent,#f2a65a);outline-offset:-2px;border-radius:10px}
.dw-grip .sum{font:11px ui-monospace,monospace;color:var(--muted,#9a9c98);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0;height:0;transition:opacity .2s}
.dw-drawer[data-drawer=closed] .dw-grip .sum{opacity:1;height:auto}
details.dw-sec{border-top:1px solid var(--edge,#3a3c40)}details.dw-sec[hidden],details.dw-sub[hidden]{display:none}
details.dw-sec>summary,details.dw-sub>summary{list-style:none;display:flex;align-items:baseline;gap:8px;padding:7px 2px;cursor:pointer;-webkit-tap-highlight-color:transparent;user-select:none}
details.dw-sec>summary::-webkit-details-marker,details.dw-sub>summary::-webkit-details-marker{display:none}
details.dw-sec>summary::before,details.dw-sub>summary::before{content:'\\203A';display:inline-block;width:10px;color:var(--muted,#9a9c98);transition:transform .15s}
details[open].dw-sec>summary::before,details[open].dw-sub>summary::before{transform:rotate(90deg)}
details.dw-sec>summary .t,details.dw-sub>summary .t{font:600 11px ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase}
details.dw-sub>summary{padding:4px 2px}details.dw-sub>summary .t{font-weight:400}
details.dw-sec>summary .s,details.dw-sub>summary .s{font:11px ui-monospace,monospace;color:var(--muted,#9a9c98);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
details.dw-sec>summary:focus-visible,details.dw-sub>summary:focus-visible{outline:2px solid var(--accent,#f2a65a);outline-offset:-2px;border-radius:6px}
.dw-body{display:flex;flex-direction:column;gap:6px;padding:0 0 8px 14px}
[data-focus] label,[data-focus] .lab,[data-focus] .dw-name{cursor:pointer}
.dw-focusing [data-focus]:not(.dw-focused),.dw-focusing details.dw-sec>summary,.dw-focusing details.dw-sub>summary,.dw-focusing .dw-hide-in-focus{display:none!important}
.dw-focusing details.dw-sec:not(:has(.dw-focused)),.dw-focusing details.dw-sub:not(:has(.dw-focused)){display:none!important}
.dw-focusing .dw-body>*:not(:has(.dw-focused)):not(.dw-focused){display:none!important}
.dw-focused{outline:1px dashed var(--edge,#3a3c40);outline-offset:4px;border-radius:6px}
@media (prefers-reduced-motion:reduce){.dw-drawer{transition:none}}
`;
let done = false;
export function ensureStyle() {
  if (done || typeof document === 'undefined') return;
  done = true;
  const s = document.createElement('style'); s.dataset.dw = ''; s.textContent = CSS;
  document.head.prepend(s);
}
