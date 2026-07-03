import { saveCanvas, unpinElements } from '../network/storage.ts';
import {
  addEl, duplicateEl, deleteSelection, changeType,
  copySelection, pasteClipboard, clipboardHasContent,
  generateNew, inlineEdit, reorder,
  groupSelection, ungroupSelection, canUngroup,
  zoom, zoomToFit, exportJSON
} from './menu-item-helpers.ts';
import { autoLayout } from '../layout/auto-layout.ts';
import { align } from '../layout/align.ts';
import { generateContent } from '../network/generation.ts';
import { createFrame } from '../network/frameNav.ts';

function buildTypeItems(controller) {
  /* 1 – native + plug-ins */
  const base = [
    { type: 'text', icon: 'fa-font', shortcut: '⌘⇧T' },
    { type: 'markdown', icon: 'fa-brands fa-markdown', shortcut: '⌘⇧M' },
    { type: 'img', icon: 'fa-image', shortcut: '⌘⇧I' },
    { type: 'html', icon: 'fa-code', shortcut: '⌘⇧H' },
  ];
  const extras = controller.elementRegistry      // dynamic plug-ins
    ?.listTypes()
    .filter(t => !base.some(b => b.type === t))
    .map(t => ({ type: t, icon: 'fa-cube' })) || [];
  /* 2 – emit menu items */
  return [...base, ...extras].map(t => ({
    label: t.type,
    icon: t.icon,
    category: 'Convert',
    shortcut: t.shortcut,
    action: c => changeType(c, t.type)
  }));
}

/**
 * buildRootItems(cfg)  → Item[]
 * Constructs and returns the root-level item array.
 */
export function buildRootItems(controller) {

  return [
    /* ── Mode toggle ──────────────────────────────────────────────────────
     * No shortcuts here: ⌘E/⌘V/⌘T collided with Inline Edit / Paste / the
     * browser's new-tab (last-registered silently won). Esc already toggles
     * modes, and the toolbar button is one tap. */
    {
      label: 'Mode', icon: 'fa-arrows-alt', category: 'Navigation', children: [
        { label: 'Edit', icon: 'fa-pen-to-square', aliases: 'editing direct', action: c => c.switchMode('direct') },
        { label: 'View', icon: 'fa-eye', aliases: 'viewing navigate pan', action: c => c.switchMode('navigate') },
        { label: 'Toggle', icon: 'fa-toggle-on', action: c => c.switchMode() },
      ]
    },

    /* ── undo/redo ─────────────────────────────────────────────────────── */
    { label: 'Undo', icon: 'fa-rotate-left', category: 'Edit', shortcut: '⌘Z', action: c => c.undo() },
    { label: 'Redo', icon: 'fa-rotate-right', category: 'Edit', shortcut: '⌘⇧Z', action: c => c.redo() },

    /* ── Add … ───────────────────────────────────────────────────────────── */
    /* "⌘N x" chord shortcuts were display fiction — the dispatcher can't
     * produce two-key sequences, so they advertised keys that never worked. */
    {
      label: 'Add', icon: 'fa-plus-circle', category: 'Create', children: [
        { label: 'Text', icon: 'fa-font', category: 'Create', aliases: 'new note', needsInput: "Text", action: (c, text) => addEl(c, 'text', text) },
        { label: 'Markdown', icon: 'fa-brands fa-markdown', category: 'Create', aliases: 'new note md', needsInput: "Content", action: (c, text) => addEl(c, 'markdown', text) },
        { label: 'Image', icon: 'fa-image', category: 'Create', aliases: 'new picture', needsInput: "Prompt", action: (c, text) => addEl(c, 'img', text) },
        {
          label: 'Nested canvas', icon: 'fa-object-group', category: 'Create', aliases: 'new board nested sub',
          needsInput: 'Board name',
          action: (c, name) => {
            // A nested canvas is born LINKED to its child board — the old flow
            // created a bare canvas-container that nothing could render or open.
            const slug = String(name || 'board').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'board';
            const child = `${c.canvasState.canvasId}-${slug}`;
            const pt = c.screenToCanvas(window.innerWidth / 2, window.innerHeight / 2);
            const id = c.createNewElement(pt.x, pt.y, 'canvas-container', name || slug, false, { refCanvasId: child });
            const el = c.findElementById(id);
            if (el) { el.width = 340; el.height = 240; }
            c.requestRender();
          }
        },
        {
          label: 'Generate',
          icon: 'fa-wand-magic-sparkles',
          category: 'AI',
          aliases: 'ai create',
          needsInput: 'Prompt',
          action: async (c, text) => {
            const { innerWidth: W, innerHeight: H } = window;
            const pt = c.screenToCanvas(W / 2, H / 2);
            const elId = c.createNewElement(pt.x, pt.y, 'markdown', text || 'generating…');
            const el = c.findElementById(elId);
            const newContent = await generateContent(text, el, c);
            if (newContent) {
              el.content = newContent;
              c.updateElementNode(c.elementNodesMap[elId], el, true);
              saveCanvas(c.canvasState);
            }
          }
        },
      ]
    },

    /* ── Edit / Clipboard ───────────────────────────────────────────────── */
    {
      label: 'Edit', icon: 'fa-pen-to-square',
      category: 'Edit',
      visible: c => c.selectedElementIds.size > 0,
      children: [
        {
          label: 'Duplicate', icon: 'fa-copy', category: 'Edit',
          shortcut: '⌘D', aliases: 'copy clone',
          action: c => [...c.selectedElementIds].forEach(id => duplicateEl(c, id))
        },
        { label: 'Delete', icon: 'fa-trash', category: 'Edit', shortcut: '⌫', aliases: 'remove erase', action: c => deleteSelection(c) },
        {
          label: 'Image from selection', icon: 'fa-image', category: 'AI',
          visible: c => c.selectedElementIds.size === 1,
          action: async (c) => {
            // The transform affordance: source content becomes the PROMPT of a
            // new img element, linked derived-from its source.
            const srcId = [...c.selectedElementIds][0];
            const src = c.findElementById(srcId);
            if (!src) return;
            const id = c.createNewElement(src.x + (src.width ?? 240) + 80, src.y, 'img', src.content ?? '', false, {});
            const el = c.findElementById(id);
            if (el) { el.width = 320; el.height = 320; }
            c.requestRender();
            try {
              const { act } = await import('../network/substrate.ts');
              void act('workspace.link', { from: `el:${id}`, rel: 'derived-from', to: `el:${srcId}` }).catch(() => undefined);
            } catch { /* provenance is best-effort */ }
          },
        },
        {
          label: 'Un-pin', icon: 'fa-thumbtack', category: 'Edit', aliases: 'unpin release tray',
          visible: c => c.selectedElementIds.size > 0,
          action: c => unpinElements(c, [...c.selectedElementIds]),
        },
        {
          // Frame the selection (ADR-0015): a named viewpoint whose region = the
          // selected facts. It follows them, and is shareable / tour-able.
          label: 'Frame selection', icon: 'fa-crop-simple', category: 'Navigation',
          visible: c => c.selectedElementIds.size > 0,
          needsInput: 'Frame name',
          action: (c, text) => createFrame(c, text),
        },
        { label: 'Copy', icon: 'fa-clone', category: 'Edit', shortcut: '⌘C', action: c => copySelection(c) },
        {
          label: 'Paste', icon: 'fa-paste', category: 'Edit', shortcut: '⌘V',
          enabled: () => clipboardHasContent(),
          action: c => pasteClipboard(c)
        },
        {
          // No ⌘G — that's Group's (the collision was resolved silently by
          // registration order before).
          label: 'Generate New', icon: 'fa-arrow-rotate-right', category: 'AI', aliases: 'ai regenerate rewrite',
          enabled: c => (c.selectedElementIds.size === 1 &&
            c.findElementById([...c.selectedElementIds][0])?.type !== 'img'),
          action: c => generateNew(c)
        },
        { label: 'Inline Edit', icon: 'fa-i-cursor', category: 'Edit', shortcut: '⌘E', action: c => inlineEdit(c) },
        {
          label: 'Auto-Layout', icon: 'fa-wand-magic-sparkles', category: 'Layout', children: [
            { label: '→  Right', category: 'Layout', shortcut: '⌘⇧→', action: c => autoLayout(c, { direction: 'RIGHT' }) },
            { label: '↓  Down', category: 'Layout', shortcut: '⌘⇧↓', action: c => autoLayout(c, { direction: 'DOWN' }) },
            { label: '⇆  Left', category: 'Layout', shortcut: '⌘⇧←', action: c => autoLayout(c, { direction: 'LEFT' }) },
            { label: '↕  Up', category: 'Layout', shortcut: '⌘⇧↑', action: c => autoLayout(c, { direction: 'UP' }) },
            { label: 'Radial', category: 'Layout', shortcut: '⌘⇧R', action: c => autoLayout(c, { algorithm: 'radial' }) }
          ]
        },
        { label: 'Convert Type', icon: 'fa-shapes', category: 'Edit', children: buildTypeItems(controller) },
      ]
    },

    /* ── Arrange ─────────────────────────────────────────────────────────── */
    {
      label: 'Arrange', icon: 'fa-layer-group',
      category: 'Layout',
      visible: c => c.selectedElementIds.size > 0,
      children: [
        { label: 'Bring Front', icon: 'fa-arrow-up', category: 'Layout', shortcut: '⌘]', action: c => reorder(c, 'front') },
        { label: 'Send Back', icon: 'fa-arrow-down', category: 'Layout', shortcut: '⌘[', action: c => reorder(c, 'back') },
        {
          label: 'Group', icon: 'fa-object-group', category: 'Layout', shortcut: '⌘G',
          enabled: c => c.selectedElementIds.size > 1,
          action: c => groupSelection(c)
        },
        {
          label: 'Ungroup', icon: 'fa-object-ungroup', category: 'Layout', shortcut: '⌘⇧G',
          enabled: c => canUngroup(c),
          action: c => ungroupSelection(c)
        },
        {
          label: 'Align', icon: 'fa-align-left', category: 'Layout',
          children: [
            { label: 'Left', category: 'Layout', shortcut: '⌘⌥L', action: (c) => align(c, { axis: 'x', pos: 'min' }) },
            { label: 'Right', category: 'Layout', shortcut: '⌘⌥R', action: (c) => align(c, { axis: 'x', pos: 'max' }) },
            { label: 'Top', category: 'Layout', shortcut: '⌘⌥T', action: (c) => align(c, { axis: 'y', pos: 'min' }) },
            { label: 'Bottom', category: 'Layout', shortcut: '⌘⌥B', action: (c) => align(c, { axis: 'y', pos: 'max' }) },
            { label: 'Centre Vert', category: 'Layout', shortcut: '⌘⌥V', action: (c) => align(c, { axis: 'x', pos: 'center' }) },
            { label: 'Centre Horiz', category: 'Layout', shortcut: '⌘⌥H', action: (c) => align(c, { axis: 'y', pos: 'center' }) },
          ]
        }
      ]
    },

    /* ── View ────────────────────────────────────────────────────────────── */
    {
      label: 'View', icon: 'fa-search', category: 'Navigation', children: [
        { label: 'Zoom In', icon: 'fa-search-plus', category: 'Navigation', shortcut: '⌘+', action: c => zoom(c, 1.25) },
        { label: 'Zoom Out', icon: 'fa-search-minus', category: 'Navigation', shortcut: '⌘-', action: c => zoom(c, 0.8) },
        { label: 'Reset Zoom', icon: 'fa-compress', category: 'Navigation', shortcut: '⌘0', action: c => zoom(c, 1 / c.viewState.scale) },
        { label: 'Zoom to Fit', icon: 'fa-expand', category: 'Navigation', shortcut: '⌘1', aliases: 'fit all overview', action: c => zoomToFit(c) }
      ]
    },

    /* ── Canvas ──────────────────────────────────────────────────────────
     * "Save" is gone: saves are automatic — offering the command implied
     * they weren't (the save dot in the sheet footer is the honest signal).
     * "History" showed versionHistory, which the persister strips — always
     * an empty list. */
    {
      label: 'Canvas', icon: 'fa-database', category: 'File', children: [
        { label: 'Export JSON', icon: 'fa-file-export', category: 'File', shortcut: '⌘⇧E', aliases: 'download backup', action: c => exportJSON(c) }
      ]
    },
  ];
}
