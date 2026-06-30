/**
 * The federated render CONSUMER (ADR-0039/0041) — shared by every surface that
 * runs a cell-authored `ui://` renderer script. A renderer is a self-registering
 * classic script that adds `fn(host, value, api)` to `window.__parcRender[key]`.
 * It may be authored by ANY cell the caller can reach — including another
 * tenant's cell (`@alice/notes`), shared or granted, not just the caller's own —
 * so it is untrusted code by construction and MUST run inside an isolation
 * boundary that has no ambient session, exactly the ADR-0034 MCP-Apps security
 * model ("Host and Sandbox MUST have different origins"; no ambient parc.land
 * session; the view reaches the substrate only via a host-mediated call).
 *
 * Two shapes, because "already sandboxed" differs by surface:
 *
 * 1. `fetchAndRunRenderer` — for a caller that IS ITSELF the sandbox. The
 *    conversation card (`services/gateway/client/main.ts`) qualifies: claude.ai
 *    renders `ui://parc/card` in an opaque-origin sandboxed iframe with no
 *    parc.land session, so when the card's *own* bundle injects a renderer
 *    script into *its own* document, that injection still lands inside the
 *    sandbox claude.ai already built — safe.
 *
 * 2. `mountSandboxedRenderer` + `SANDBOX_HOST_HTML` — for a caller that is a
 *    first-party, session-bearing origin (home's field computer, and any other
 *    React surface that wants to run a foreign renderer inline). Such a caller
 *    must NOT inject foreign script into its own document — that would hand a
 *    third-party cell author the user's live session, cookies, and DOM. It
 *    instead builds its OWN child sandbox: a `sandbox="allow-scripts"` iframe
 *    (deliberately omitting `allow-same-origin`, so the iframe gets an opaque
 *    origin distinct from the parent's) and becomes that sandbox's HOST over a
 *    small postMessage protocol — the same host/view split ADR-0034 uses
 *    between claude.ai and the card, just run locally instead of through an
 *    external MCP client.
 *
 * Dependency-free (no React; `window`/`document` only) so it's a lean import
 * for any browser surface, matching `render-hints.ts`'s contract.
 */

export type RendererFn = (host: HTMLElement, value: unknown, api: RendererApi) => void;

export interface RendererApi {
  /** A host-proxied (card) or host-mediated-via-postMessage (sandboxed home
   *  iframe) read/act call — the renderer never calls the substrate directly. */
  call: (kind: 'read' | 'act', target: string, input: unknown) => Promise<unknown>;
  esc: (s: unknown) => string;
  md: (s: string) => string;
  /** The fact's substrate key — a decomposed renderer (e.g. a machine definition,
   *  whose nodes/rails are separate facts) needs it to fetch its children via call. */
  key?: string;
}

/**
 * ADR-0041 Inc 3 — the INPUT twin of `RendererFn`. Where a renderer DISPLAYS a
 * value, a form COLLECTS one: it mounts into `host` against a JSON Schema +
 * the current value, and calls `api.onChange(next)` on every edit. It never
 * submits — the embedding surface (the field computer, the card) owns the
 * Run/Submit action and the current value, exactly mirroring how
 * `platform/ui/form`'s `SchemaForm` only emits `onChange`. Self-registers
 * under a SEPARATE namespace (`window.__parcForm`) from output renderers
 * (`window.__parcRender`) — a tool may declare both for the same target. Same
 * untrusted-by-construction status as `RendererFn`, so it runs under the same
 * sandbox rules.
 */
export type FormRendererFn = (host: HTMLElement, schema: unknown, value: Record<string, unknown>, api: FormRendererApi) => void;

export interface FormRendererApi extends Omit<RendererApi, 'key'> {
  /** Report the form's current value — call on every edit; the host keeps it
   *  as the live arguments and is what actually runs the capability. */
  onChange: (value: Record<string, unknown>) => void;
}

const loadedRenderers = new Set<string>();

export function rendererRegistry(): Record<string, RendererFn> {
  const w = window as unknown as { __parcRender?: Record<string, RendererFn> };
  return (w.__parcRender = w.__parcRender || {});
}

/** Inject a renderer script ONCE per uri (idempotent across repeated mounts —
 *  re-running the same script would re-register the same key harmlessly, but
 *  there's no reason to re-fetch/re-inject it). */
function loadRendererScript(uri: string, src: string): void {
  if (loadedRenderers.has(uri) || !src) return;
  loadedRenderers.add(uri);
  try {
    const s = document.createElement('script');
    s.textContent = src; // inline <script> executes synchronously on insert
    document.head.appendChild(s);
  } catch {
    /* CSP blocked injection — the caller's placeholder content stays visible */
  }
}

/**
 * Fetch (if not already loaded) + execute a cell-declared `ui://` renderer into
 * `host`. ONLY for a caller that is itself already a sandbox (see shape 1
 * above) — calling this from a session-bearing first-party page would run
 * untrusted cell code with that page's ambient authority. `fetchText` resolves
 * the `ui://` URI to its script source — each surface's own transport.
 * Degrades silently on any failure (offline, CSP, cell down, no renderer
 * registered under `type`): whatever placeholder content the caller already
 * painted into `host` simply stays up.
 */
export async function fetchAndRunRenderer(
  uri: string,
  type: string,
  host: HTMLElement,
  value: unknown,
  api: RendererApi,
  fetchText: (uri: string) => Promise<string | null>,
): Promise<void> {
  try {
    if (!loadedRenderers.has(uri)) {
      const src = await fetchText(uri);
      if (typeof src === 'string' && src) loadRendererScript(uri, src);
    }
    const fn = type && rendererRegistry()[type];
    if (typeof fn === 'function') {
      host.innerHTML = '';
      fn(host, value, api);
    }
  } catch {
    /* degrade to whatever's already in host */
  }
}

// ── shape 2: a first-party caller builds its own child sandbox ────────────

/**
 * The VIEW half — a tiny, fully inline document with no external script `src`
 * (so it works as an iframe `srcDoc` with `sandbox="allow-scripts"` and no
 * `allow-same-origin`, giving it an opaque origin: no cookies, no storage, no
 * reachable parc.land session). It self-registers `window.__parcRender`,
 * receives a renderer's source + the fact value over `postMessage` from its
 * parent, executes the renderer INSIDE this isolated document, and proxies
 * `api.call` back to the parent (which performs the real, authenticated
 * substrate call and replies) — never reaching the network itself.
 */
export const SANDBOX_HOST_HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;color-scheme:light dark}#root{font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow-wrap:anywhere}</style>
</head><body><div id="root"></div><script>
(function(){
  var reg = (window.__parcRender = window.__parcRender || {});
  var formReg = (window.__parcForm = window.__parcForm || {});
  var seq = 0, pending = {};
  function call(kind, target, input){
    return new Promise(function(resolve, reject){
      var id = ++seq; pending[id] = { resolve: resolve, reject: reject };
      parent.postMessage({ source: 'parc-sandbox', type: 'parc-call', id: id, kind: kind, target: target, input: input }, '*');
    });
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  // No markdown engine ships in the sandbox (keep this bootstrap dependency-free);
  // a renderer wanting rich markdown brings its own (the card supplies real \`marked\`
  // for its own renderers — this floor's \`md\` is intentionally just escaping).
  function md(s){ return esc(s); }
  var root = document.getElementById('root');
  function reportSize(){ try { parent.postMessage({ source: 'parc-sandbox', type: 'parc-size', height: document.documentElement.scrollHeight }, '*'); } catch(e){} }
  if (window.ResizeObserver) new ResizeObserver(reportSize).observe(document.body);
  window.addEventListener('message', function(ev){
    var m = ev.data;
    if (!m || typeof m !== 'object' || m.source !== 'parc-host') return;
    if (m.type === 'parc-render') {
      try {
        if (m.src) { var s = document.createElement('script'); s.textContent = m.src; document.head.appendChild(s); }
        var fn = m.rendererType && reg[m.rendererType];
        if (typeof fn === 'function') {
          root.innerHTML = '';
          fn(root, m.value, { call: call, esc: esc, md: md, key: m.key });
          parent.postMessage({ source: 'parc-sandbox', type: 'parc-rendered' }, '*');
        } else {
          parent.postMessage({ source: 'parc-sandbox', type: 'parc-render-failed' }, '*');
        }
        reportSize();
      } catch (e) {
        parent.postMessage({ source: 'parc-sandbox', type: 'parc-render-failed', error: String((e && e.message) || e) }, '*');
      }
    } else if (m.type === 'parc-mount-form') {
      // ADR-0041 Inc 3: the INPUT twin of parc-render — mounts a form instead of
      // displaying a value, and reports edits back via parc-form-change rather
      // than settling once. The host (not this sandbox) decides when to submit.
      try {
        if (m.src) { var fs = document.createElement('script'); fs.textContent = m.src; document.head.appendChild(fs); }
        var ffn = m.formType && formReg[m.formType];
        if (typeof ffn === 'function') {
          root.innerHTML = '';
          ffn(root, m.schema, m.value || {}, { call: call, esc: esc, md: md, onChange: function(v){ parent.postMessage({ source: 'parc-sandbox', type: 'parc-form-change', value: v }, '*'); } });
          parent.postMessage({ source: 'parc-sandbox', type: 'parc-rendered' }, '*');
        } else {
          parent.postMessage({ source: 'parc-sandbox', type: 'parc-render-failed' }, '*');
        }
        reportSize();
      } catch (e) {
        parent.postMessage({ source: 'parc-sandbox', type: 'parc-render-failed', error: String((e && e.message) || e) }, '*');
      }
    } else if (m.type === 'parc-call-result') {
      var p = pending[m.id];
      if (p) { delete pending[m.id]; if (m.ok) p.resolve(m.value); else p.reject(new Error(String(m.error || 'call failed'))); }
    }
  });
  parent.postMessage({ source: 'parc-sandbox', type: 'parc-ready' }, '*');
})();
</script></body></html>`;

type QueuedMount =
  | { kind: 'render'; src: string | null; type: string; value: unknown; key?: string }
  | { kind: 'form'; src: string | null; type: string; schema: unknown; value: Record<string, unknown> };

export interface SandboxedRendererHandle {
  /** Send a renderer's source + the value into the sandbox (queued until the
   *  sandbox signals ready). Call again to re-render with a new value. */
  render(src: string | null, type: string, value: unknown, key?: string): void;
  /** ADR-0041 Inc 3 — mount a FORM (the input twin of `render`): the sandbox
   *  runs the form against `schema`/`value` and reports edits via the host's
   *  `onFormChange`. Call again (e.g. on a schema change) to remount. */
  mountForm(src: string | null, type: string, schema: unknown, value: Record<string, unknown>): void;
  /** Stop listening — call on unmount. */
  dispose(): void;
}

/**
 * The HOST half — wire a `sandbox="allow-scripts"` iframe (srcDoc=
 * `SANDBOX_HOST_HTML`) as an isolated renderer boundary. The PARENT (this
 * surface — home, or any first-party React page) holds the real session;
 * `call` is the parent's own authenticated read/act (e.g. home's `mcpCall`).
 * The iframe can reach nothing but `postMessage` to this parent, so a
 * cell-authored renderer or form — however untrusted — never touches the
 * parent's cookies, storage, or DOM.
 */
export function mountSandboxedRenderer(
  iframe: HTMLIFrameElement,
  opts: {
    call: (kind: 'read' | 'act', target: string, input: unknown) => Promise<unknown>;
    onResize?: (height: number) => void;
    onSettled?: (ok: boolean) => void;
    /** ADR-0041 Inc 3 — fires on every edit inside a mounted FORM. */
    onFormChange?: (value: Record<string, unknown>) => void;
  },
): SandboxedRendererHandle {
  let ready = false;
  let queued: QueuedMount | null = null;
  const post = (msg: Record<string, unknown>): void => {
    iframe.contentWindow?.postMessage({ source: 'parc-host', ...msg }, '*');
  };
  const send = (q: QueuedMount): void => {
    if (q.kind === 'render') post({ type: 'parc-render', src: q.src, rendererType: q.type, value: q.value, key: q.key });
    else post({ type: 'parc-mount-form', src: q.src, formType: q.type, schema: q.schema, value: q.value });
  };
  const onMessage = (ev: MessageEvent): void => {
    if (!iframe.contentWindow || ev.source !== iframe.contentWindow) return; // only this sandbox
    const m = ev.data as
      | { source?: string; type?: string; id?: number; kind?: 'read' | 'act'; target?: string; input?: unknown; height?: number; ok?: boolean; error?: string; value?: Record<string, unknown> }
      | null;
    if (!m || m.source !== 'parc-sandbox') return;
    if (m.type === 'parc-ready') {
      ready = true;
      if (queued) {
        const q = queued;
        queued = null;
        send(q);
      }
    } else if (m.type === 'parc-call' && m.kind && m.target) {
      opts
        .call(m.kind, m.target, m.input)
        .then((value) => post({ type: 'parc-call-result', id: m.id, ok: true, value }))
        .catch((err: unknown) => post({ type: 'parc-call-result', id: m.id, ok: false, error: String((err as Error)?.message ?? err) }));
    } else if (m.type === 'parc-size' && typeof m.height === 'number') {
      opts.onResize?.(m.height);
    } else if (m.type === 'parc-rendered') {
      opts.onSettled?.(true);
    } else if (m.type === 'parc-render-failed') {
      opts.onSettled?.(false);
    } else if (m.type === 'parc-form-change' && m.value && typeof m.value === 'object') {
      opts.onFormChange?.(m.value);
    }
  };
  window.addEventListener('message', onMessage);
  return {
    render: (src, type, value, key) => {
      const q: QueuedMount = { kind: 'render', src, type, value, key };
      if (ready) send(q);
      else queued = q;
    },
    mountForm: (src, type, schema, value) => {
      const q: QueuedMount = { kind: 'form', src, type, schema, value };
      if (ready) send(q);
      else queued = q;
    },
    dispose: () => window.removeEventListener('message', onMessage),
  };
}
