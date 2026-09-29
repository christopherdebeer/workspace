/**
 * Field reports. A phone that can't run the pond can't be debugged from here,
 * so failures (and one boot line per load) go to the cell's own `/report`,
 * which logs them — read back with `cells.logs` for stillwater. A GET with
 * the report in the query: the edge refuses an anonymous POST (401).
 * Fire-and-forget: a report must never itself break the page.
 */
export function glInfo(): Record<string, unknown> {
  const info: Record<string, unknown> = {};
  try {
    const c = document.createElement('canvas');
    const gl2 = c.getContext('webgl2');
    info.webgl2 = !!gl2;
    const gl = gl2 ?? c.getContext('webgl');
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      info.renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      info.version = gl.getParameter(gl.VERSION);
      info.maxFragUniforms = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS);
      info.maxVertUniforms = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS);
      info.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      info.exts = (gl.getSupportedExtensions() ?? []).filter((e) => /float|half|color_buffer/i.test(e));
    }
  } catch (e) {
    info.probeError = String(e);
  }
  return info;
}

/**
 * Compile every program in its own fresh context and report each outcome, so
 * one failed load on a phone names every shader that phone can't take.
 */
export async function probe(programs: Array<[string, string, string]>, compileOne: (gl: WebGL2RenderingContext, name: string, vs: string, fs: string) => unknown) {
  const results: Array<Record<string, unknown>> = [];
  for (const [name, vs, fs] of programs) {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) {
      results.push({ name, ok: false, why: 'no context' });
      continue;
    }
    const t0 = performance.now();
    let why = '';
    try {
      compileOne(gl, name, vs, fs);
    } catch (e) {
      why = String(e instanceof Error ? e.message : e).split('\n').slice(0, 4).join(' | ').slice(0, 400);
    }
    // give a GPU-process crash a moment to surface as a lost context
    await new Promise((r) => setTimeout(r, 120));
    results.push({ name, ok: !why && !gl.isContextLost(), lost: gl.isContextLost(), ms: Math.round(performance.now() - t0), why: why || undefined });
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  report('probe', { results });
  return results;
}

export function report(kind: string, detail: Record<string, unknown>) {
  try {
    const body = JSON.stringify({ kind, ua: navigator.userAgent, w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ...detail }).slice(0, 6000);
    fetch('/report?d=' + encodeURIComponent(body), { keepalive: true, cache: 'no-store' }).catch(() => {});
  } catch {
    /* never */
  }
}

addEventListener('error', (e) => report('onerror', { msg: String(e.message), at: `${e.filename}:${e.lineno}:${e.colno}` }));
addEventListener('unhandledrejection', (e) => report('rejection', { msg: String((e as PromiseRejectionEvent).reason) }));
