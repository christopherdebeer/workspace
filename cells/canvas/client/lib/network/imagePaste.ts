/* ---------------------------------------------------------------------------
 * imagePaste.ts — drag/paste an image onto the board and it becomes a fact.
 *
 * The bytes go to the cell data layer (cells.putData, base64) under public/,
 * which the platform web-serves at /@owner/cell/_data/...; the element fact
 * `el:<id>` (type img) carries only the pointer URL — binary never enters the
 * substrate, but the substrate knows the image exists (pointers by default).
 * ------------------------------------------------------------------------- */
import { act } from './substrate.ts';
import { saveCanvas } from './storage.ts';

let installed = false;

function cellAddr(): { owner: string; name: string } {
  const m = (typeof location !== 'undefined' ? location.pathname : '').match(/^\/@([^/]+)\/([^/]+)/);
  return m
    ? { owner: decodeURIComponent(m[1]), name: decodeURIComponent(m[2]) }
    : { owner: 'c15r', name: 'canvas' };
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  }
  return btoa(bin);
}

function blobDims(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 480, h: img.naturalHeight || 320 });
    img.onerror = () => resolve({ w: 480, h: 320 });
    img.src = url;
  });
}

async function uploadImage(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > 8 * 1024 * 1024) throw new Error('image too large (>8MB)');
  const type = file.type || 'image/png';
  const ext = (type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'png';
  const key = `public/img/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const res = await act<{ url: string | null }>('cells.putData', {
    ...cellAddr(),
    key,
    content: toBase64(bytes),
    encoding: 'base64',
    contentType: type,
  });
  if (!res.url) throw new Error('blob stored but not web-addressable (cell not public?)');
  return res.url;
}

function isEditTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('input, textarea, [contenteditable], .CodeMirror');
}

async function addImages(files: Array<{ blob: Blob; name: string }>, sx: number, sy: number): Promise<void> {
  const cc = (window as any).CC;
  if (!cc || document.body.classList.contains('readonly')) return;
  for (let i = 0; i < files.length; i++) {
    const { blob, name } = files[i];
    // Local preview immediately (also: an img element with no src would
    // trigger AI regeneration — never leave src empty).
    const preview = URL.createObjectURL(blob);
    const { w, h } = await blobDims(preview);
    const scale = Math.min(1, 420 / w);
    const pt = cc.screenToCanvas(sx + i * 36, sy + i * 36);
    const id = cc.createNewElement(pt.x, pt.y, 'img', name || 'image', false, { src: preview });
    const el = cc.findElementById(id);
    if (el) {
      el.width = Math.max(60, Math.round(w * scale));
      el.height = Math.max(40, Math.round(h * scale));
    }
    cc.requestRender();
    try {
      const url = await uploadImage(blob);
      const live = cc.findElementById(id);
      if (live) {
        live.src = url;
        cc.requestRender();
        saveCanvas(cc.canvasState);
      }
      URL.revokeObjectURL(preview); // keep the preview alive if upload failed
    } catch (err) {
      console.warn('[canvas] image upload failed — keeping local preview', err);
    }
  }
}

/** Install once per page: window-level paste + drop become image elements. */
export function installImagePaste(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('paste', (ev: Event) => {
    const e = ev as ClipboardEvent;
    if (isEditTarget(e.target)) return;
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f)
      .map((f) => ({ blob: f as Blob, name: f.name }));
    if (!files.length) return;
    e.preventDefault();
    void addImages(files, window.innerWidth / 2, window.innerHeight / 2);
  });
  window.addEventListener('dragover', (ev: DragEvent) => {
    if (Array.from(ev.dataTransfer?.types ?? []).includes('Files')) ev.preventDefault();
  });
  window.addEventListener('drop', (ev: DragEvent) => {
    const files = Array.from(ev.dataTransfer?.files ?? [])
      .filter((f) => f.type.startsWith('image/'))
      .map((f) => ({ blob: f as Blob, name: f.name }));
    if (!files.length) return;
    ev.preventDefault();
    void addImages(files, ev.clientX, ev.clientY);
  });
}
