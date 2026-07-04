import type { CanvasElement } from '../types';

let $root: HTMLElement | null = null;    // modal shell (created on-demand)
let $contentEditorHost: HTMLElement | null = null;    // div that will hold CodeMirror
let $srcEditorHost: HTMLElement | null = null;
let $btnPrev: HTMLElement | null = null;
let $btnNext: HTMLElement | null = null;
let $info: HTMLElement | null = null;
let $btnClear: HTMLElement | null = null;
let $btnCopy: HTMLElement | null = null;
let $btnCancel: HTMLElement | null = null;
let $btnSave: HTMLElement | null = null;
let $btnGenerate: HTMLElement | null = null;
let $tabContent: HTMLElement | null = null;
let $tabSrc: HTMLElement | null = null;
let $errorBox: HTMLElement | null = null;

let cmContent: any = null;    // CodeMirror instances
let cmSrc: any = null;

let activeTab: 'content' | 'src' = 'content';
let currentEl: CanvasElement | null = null;    // element being edited (live reference)
let currentVerIdx = 0;       // 0 … el.versions.length  (top == current)
let resolver: ((value: { status: string; el: CanvasElement | null }) => void) | null = null;    // Promise resolver returned by showModal
let generateFn: ((seed: string) => Promise<string> | string) | null = null;    // callback injected by caller (optional)
let hostEl: HTMLElement | null = null;         // when set, the editor lives inside the sheet (full detent) rather than a centered overlay

export function showModal(el: CanvasElement, opts: { generateContent?: (seed: string) => Promise<string> | string; host?: HTMLElement } = {}): Promise<{ status: string; el: CanvasElement | null }> {
  if (!el) throw new Error('showModal: element required');
  // A re-open before the previous close resolved would strand the prior
  // awaiter forever — settle it as cancelled first.
  resolver?.({ status: 'cancelled', el: null });
  resolver = null;
  generateFn = opts.generateContent ?? null;
  hostEl = opts.host ?? null;

  ensureDom();
  hydrateUiFor(el);

  return new Promise((res) => { resolver = res; });
}

function ensureDom(): void {
  const target = hostEl ?? document.body;
  // Build once (keeps the CodeMirror instances alive across opens); just
  // re-attach to the current target — body (centered) or the sheet host.
  if ($root) {
    if ($root.parentElement !== target) target.appendChild($root);
    $root.classList.toggle('in-sheet', !!hostEl);
    return;
  }

  const tpl = /*html*/`
<div id="edit-modal" class="modal">
  <div class="modal-content">
    <div class="modal-versions">
      <div class="versions-nav">
        <button id="versions-prev"><i class="fa-solid fa-angle-left"></i></button>
        <span id="versions-info"></span>
        <button id="versions-next"><i class="fa-solid fa-angle-right"></i></button>
      </div>
      <div id="modal-error"></div>
    </div>
    <div class="modal-tabs">
      <button id="tab-content" class="active">Content</button>
      <button id="tab-src">Src</button>
    </div>
    <div class="modal-editor">
      <div id="editor-content"></div>
      <div id="editor-src" style="display:none"></div>
    </div>
    <div class="modal-buttons">
      <button id="modal-clear">Clear</button>
      <button id="modal-copy">Copy</button>
      <button id="modal-cancel">Close</button>
      <button id="modal-save">Save</button>
      <button id="modal-generate">Generate</button>
    </div>
  </div>
</div>`;
  const wrap = document.createElement('div');
  wrap.innerHTML = tpl;
  $root = wrap.firstElementChild as HTMLElement;
  target.appendChild($root);
  $root.classList.toggle('in-sheet', !!hostEl);
  // Scope every lookup to THIS root, never document.getElementById: the ids here
  // (editor-content, modal-save, …) are not globally unique — a stale static
  // copy of this markup, or a second instance, would otherwise hijack them and
  // wire CodeMirror + the buttons to the wrong (hidden) nodes, which is exactly
  // how the in-sheet editor went dead.
  const q = <T extends HTMLElement = HTMLElement>(id: string): T => $root!.querySelector('#' + id) as T;
  $contentEditorHost = q('editor-content');
  $srcEditorHost = q('editor-src');
  $btnPrev = q('versions-prev');
  $btnNext = q('versions-next');
  $info = q('versions-info');
  $errorBox = q('modal-error');

  $btnClear = q('modal-clear');
  $btnCopy = q('modal-copy');
  $btnCancel = q('modal-cancel');
  $btnSave = q('modal-save');
  $btnGenerate = q('modal-generate');

  $tabContent = q('tab-content');
  $tabSrc = q('tab-src');

  /* ------ 2.  install event handlers -------------------------------------- */
  $btnPrev.onclick = () => navVersion(-1);
  $btnNext.onclick = () => navVersion(+1);
  $btnClear.onclick = () => getActiveCM().setValue('');
  $btnCopy.onclick = copyToClipboard;
  $btnCancel.onclick = () => close('cancelled');
  $btnSave.onclick = () => saveAndClose();
  $btnGenerate.onclick = () => generateContent();

  $tabContent.onclick = () => switchTab('content');
  $tabSrc.onclick = () => switchTab('src');

  /* Escape key closes modal */
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if ($root!.style.display !== 'none' && e.key === 'Escape') close('cancelled');
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Modal lifecycle helpers
 * ------------------------------------------------------------------------- */
function hydrateUiFor(el: CanvasElement): void {
  /* editors (lazy) */
  if (!cmContent) {
    cmContent = (window as any).CodeMirror($contentEditorHost, {
      value: '', mode: getMode(el.type), lineNumbers: true,
      theme: 'default', lineWrapping: true
    });
  } else {
    cmContent.setOption('mode', getMode(el.type));
  }
  if (!cmSrc) {
    cmSrc = (window as any).CodeMirror($srcEditorHost, {
      value: '', mode: 'text', lineNumbers: true,
      theme: 'default', lineWrapping: true
    });
  }

  currentEl = el;
  currentVerIdx = (el.versions ?? []).length; // point to “current”
  activeTab = (el.type === 'img' && el.src) ? 'src' : 'content';
  switchTab(activeTab, /*silent=*/true);

  loadVersion(currentVerIdx);
  clearError();

  $root!.style.display = "block";
  // CodeMirror measured a hidden / zero-height container — re-measure now that
  // the modal is visible and sized, else the editor paints empty. Refresh twice
  // (rAF + a short timeout) because in-sheet layout settles a frame late.
  requestAnimationFrame(() => { cmContent?.refresh?.(); cmSrc?.refresh?.(); });
  setTimeout(() => { cmContent?.refresh?.(); cmSrc?.refresh?.(); }, 80);
}

function loadVersion(idx: number): void {
  const vCount = (currentEl!.versions ?? []).length;
  currentVerIdx = idx = Math.max(0, Math.min(idx, vCount));

  if (idx < vCount) {
    cmContent.setValue(currentEl!.versions![idx].content);
  } else {
    cmContent.setValue(currentEl!.content ?? '');
  }
  cmSrc.setValue(currentEl!.src ?? '');

  $info!.textContent = `Version ${idx + 1} of ${vCount + 1}`;
}

function navVersion(delta: number): void {
  loadVersion(currentVerIdx + delta);
}

function switchTab(tab: 'content' | 'src', silent = false): void {
  activeTab = tab;
  $tabContent!.classList.toggle('active', tab === 'content');
  $tabSrc!.classList.toggle('active', tab === 'src');
  $contentEditorHost!.style.display = tab === 'content' ? 'block' : 'none';
  $srcEditorHost!.style.display = tab === 'src' ? 'block' : 'none';
  if (!silent) getActiveCM().refresh?.();
}

function getActiveCM(): any { return activeTab === 'content' ? cmContent : cmSrc; }

function saveAndClose(): void {
  if (!currentEl) return;

  if (activeTab === 'content') {
    const newContent = cmContent.getValue();
    if (currentEl.content !== newContent) {
      currentEl.versions = currentEl.versions ?? [];
      currentEl.versions.push({ content: currentEl.content, timestamp: Date.now() });
      currentEl.content = newContent;
      if (currentEl.type !== 'img') currentEl.src = undefined;
    }
  } else {            // src tab
    currentEl.src = cmSrc.getValue();
  }
  close('saved', currentEl);
}

function generateContent(): void {
  clearError();
  if (typeof generateFn !== 'function') return;

  ($btnGenerate as HTMLButtonElement).disabled = true;
  const oldLabel = $btnGenerate!.textContent;
  $btnGenerate!.innerHTML = `Generating… <i class="fa-solid fa-spinner fa-spin"></i>`;

  const seed = getActiveCM().getValue();
  Promise.resolve(generateFn!(seed))
    .then((res: string) => {
      if (res) getActiveCM().setValue(res);
      else showError('No content generated.');
    })
    .catch((err: Error) => {
      console.error('Generate error', err);
      showError('Error while generating content.');
    })
    .finally(() => {
      ($btnGenerate as HTMLButtonElement).disabled = false;
      $btnGenerate!.innerHTML = oldLabel!;
    });
}

function copyToClipboard(): void {
  navigator.clipboard.writeText(getActiveCM().getValue())
    .then(() => alert('Copied to clipboard!'))
    .catch((err: Error) => console.warn('Clipboard error', err));
}

function getMode(type: string): string {
  switch (type) {
    case 'html': return 'htmlmixed';
    case 'markdown': return 'markdown';
    case 'text': return 'javascript';
    default: return 'text';
  }
}

function clearError(): void { $errorBox!.textContent = ''; }
function showError(msg: string): void { $errorBox!.textContent = msg; }

function close(status: string, el: CanvasElement | null = null): void {
  if ($root) $root.style.display = "none";
  resolver?.({ status, el });
  resolver = null;
  currentEl = null;
}

/** Programmatic close (cancel) — the unified sheet's header uses this so closing
 *  works even if the modal's own buttons are off-screen. */
export function closeModal(): void { close('cancelled'); }
