/**
 * Home-local federated renderer host.
 *
 * The iframe is an opaque origin AND network-denied by CSP. The parent still
 * mediates every substrate call; callers must supply a narrow policy.
 */
export const SANDBOX_HOST_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<style>html,body{margin:0;padding:0;color-scheme:light dark}#root{font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow-wrap:anywhere}</style>
</head><body><div id="root"></div><script>
(function(){
  'use strict';
  var reg = (window.__parcRender = Object.create(null));
  var formReg = (window.__parcForm = Object.create(null));
  var seq = 0, pending = Object.create(null);
  function call(kind, target, input){
    return new Promise(function(resolve, reject){
      if ((kind !== 'read' && kind !== 'act') || typeof target !== 'string' || target.length > 180) {
        reject(new Error('invalid renderer call')); return;
      }
      var id = ++seq;
      var timer = setTimeout(function(){ if (pending[id]) { delete pending[id]; reject(new Error('renderer call timed out')); } }, 15000);
      pending[id] = { resolve: resolve, reject: reject, timer: timer };
      parent.postMessage({ source: 'parc-sandbox', type: 'parc-call', id: id, kind: kind, target: target, input: input }, '*');
    });
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function md(s){ return esc(s); }
  var root = document.getElementById('root');
  function send(type, rest){ var m={source:'parc-sandbox',type:type}; if(rest) Object.assign(m,rest); parent.postMessage(m,'*'); }
  function reportSize(){ try { send('parc-size',{height:Math.max(24,Math.min(1200,document.documentElement.scrollHeight||24))}); } catch(e){} }
  if (window.ResizeObserver) new ResizeObserver(reportSize).observe(document.body);
  window.addEventListener('message', function(ev){
    if (ev.source !== parent) return;
    var m = ev.data;
    if (!m || typeof m !== 'object' || m.source !== 'parc-host') return;
    if (m.type === 'parc-render') {
      try {
        if (typeof m.src === 'string' && m.src.length <= 1000000) { var s=document.createElement('script'); s.textContent=m.src; document.head.appendChild(s); }
        var fn = typeof m.rendererType === 'string' && reg[m.rendererType];
        if (typeof fn !== 'function') { send('parc-render-failed'); return; }
        root.replaceChildren();
        fn(root,m.value,{call:call,esc:esc,md:md,key:typeof m.key==='string'?m.key:undefined});
        send('parc-rendered'); reportSize();
      } catch(e){ send('parc-render-failed',{error:String((e&&e.message)||e)}); }
    } else if (m.type === 'parc-mount-form') {
      try {
        if (typeof m.src === 'string' && m.src.length <= 1000000) { var fs=document.createElement('script'); fs.textContent=m.src; document.head.appendChild(fs); }
        var ffn = typeof m.formType === 'string' && formReg[m.formType];
        if (typeof ffn !== 'function') { send('parc-render-failed'); return; }
        root.replaceChildren();
        ffn(root,m.schema,m.value||{},{call:call,esc:esc,md:md,onChange:function(v){send('parc-form-change',{value:v});}});
        send('parc-rendered'); reportSize();
      } catch(e){ send('parc-render-failed',{error:String((e&&e.message)||e)}); }
    } else if (m.type === 'parc-call-result' && Number.isSafeInteger(m.id)) {
      var p=pending[m.id];
      if(p){ delete pending[m.id]; clearTimeout(p.timer); if(m.ok)p.resolve(m.value); else p.reject(new Error(String(m.error||'call failed'))); }
    }
  });
  send('parc-ready');
})();
<\/script></body></html>`;

type Call = (kind: 'read' | 'act', target: string, input: unknown) => Promise<unknown>;
type QueuedMount =
  | { kind: 'render'; src: string | null; type: string; value: unknown; key?: string }
  | { kind: 'form'; src: string | null; type: string; schema: unknown; value: Record<string, unknown> };

export interface SandboxedRendererHandle {
  render(src: string | null, type: string, value: unknown, key?: string): void;
  mountForm(src: string | null, type: string, schema: unknown, value: Record<string, unknown>): void;
  dispose(): void;
}

function bounded<T>(p: Promise<T>, ms = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('renderer host call timed out')), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

export function mountSandboxedRenderer(iframe: HTMLIFrameElement, opts: {
  call: Call;
  onResize?: (height: number) => void;
  onSettled?: (ok: boolean) => void;
  onFormChange?: (value: Record<string, unknown>) => void;
}): SandboxedRendererHandle {
  let ready = false;
  let queued: QueuedMount | null = null;
  let calls = 0;
  let disposed = false;
  const post = (msg: Record<string, unknown>): void => {
    if (disposed) return;
    try { iframe.contentWindow?.postMessage({ source: 'parc-host', ...msg }, '*'); } catch { /* frame vanished */ }
  };
  const send = (q: QueuedMount): void => {
    if (q.kind === 'render') post({ type: 'parc-render', src: q.src, rendererType: q.type, value: q.value, key: q.key });
    else post({ type: 'parc-mount-form', src: q.src, formType: q.type, schema: q.schema, value: q.value });
  };
  const onMessage = (ev: MessageEvent): void => {
    if (!iframe.contentWindow || ev.source !== iframe.contentWindow) return;
    const m = ev.data as Record<string, unknown> | null;
    if (!m || m.source !== 'parc-sandbox' || typeof m.type !== 'string') return;
    if (m.type === 'parc-ready') {
      ready = true;
      if (queued) { const q=queued; queued=null; send(q); }
    } else if (m.type === 'parc-call') {
      const id=m.id;
      const kind=m.kind;
      const target=m.target;
      if (!Number.isSafeInteger(id) || (kind !== 'read' && kind !== 'act') || typeof target !== 'string' || target.length > 180 || ++calls > 32) {
        post({type:'parc-call-result',id,ok:false,error:'renderer call rejected'});
        return;
      }
      bounded(opts.call(kind, target, m.input))
        .then((value)=>post({type:'parc-call-result',id,ok:true,value}))
        .catch((err)=>post({type:'parc-call-result',id,ok:false,error:String((err as Error)?.message??err)}));
    } else if (m.type === 'parc-size' && typeof m.height === 'number' && Number.isFinite(m.height)) {
      opts.onResize?.(Math.max(24,Math.min(1200,m.height)));
    } else if (m.type === 'parc-rendered') {
      opts.onSettled?.(true);
    } else if (m.type === 'parc-render-failed') {
      opts.onSettled?.(false);
    } else if (m.type === 'parc-form-change' && m.value && typeof m.value === 'object' && !Array.isArray(m.value)) {
      try {
        if (JSON.stringify(m.value).length <= 262144) opts.onFormChange?.(m.value as Record<string,unknown>);
      } catch { /* non-serializable form value */ }
    }
  };
  window.addEventListener('message',onMessage);
  return {
    render:(src,type,value,key)=>{const q:QueuedMount={kind:'render',src,type,value,key};if(ready)send(q);else queued=q;},
    mountForm:(src,type,schema,value)=>{const q:QueuedMount={kind:'form',src,type,schema,value};if(ready)send(q);else queued=q;},
    dispose:()=>{disposed=true;queued=null;window.removeEventListener('message',onMessage);},
  };
}

export function attachSandboxedRenderer(iframe: HTMLIFrameElement, opts: {
  call: Call;
  fetchSource: (uri: string) => Promise<string | null>;
  uri: string;
  type: string;
  value: unknown;
  key?: string;
  onResize?: (height: number) => void;
  onSettled?: (ok: boolean) => void;
}): () => void {
  let disposed=false;
  let handle:SandboxedRendererHandle|null=null;
  const onLoad=():void=>{
    if(disposed)return;
    handle?.dispose();
    handle=mountSandboxedRenderer(iframe,{call:opts.call,onResize:opts.onResize,onSettled:opts.onSettled});
    void opts.fetchSource(opts.uri).then((src)=>{if(!disposed)handle?.render(src,opts.type,opts.value,opts.key);});
  };
  iframe.addEventListener('load',onLoad);
  iframe.srcdoc=SANDBOX_HOST_HTML;
  return ()=>{disposed=true;iframe.removeEventListener('load',onLoad);handle?.dispose();};
}
