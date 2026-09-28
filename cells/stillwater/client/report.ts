/**
 * Field reports. A phone that can't run the pond can't be debugged from here,
 * so failures (and one boot line per load) are POSTed to the cell's own
 * `/report`, which logs them — read back with `cells.logs` for stillwater.
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

export function report(kind: string, detail: Record<string, unknown>) {
  try {
    const body = JSON.stringify({ kind, ua: navigator.userAgent, w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ...detail }).slice(0, 16000);
    fetch('/report', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
  } catch {
    /* never */
  }
}

addEventListener('error', (e) => report('onerror', { msg: String(e.message), at: `${e.filename}:${e.lineno}:${e.colno}` }));
addEventListener('unhandledrejection', (e) => report('rejection', { msg: String((e as PromiseRejectionEvent).reason) }));
