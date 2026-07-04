/**
 * Context menu v2 — labeled, sectioned, selection- and substrate-aware.
 *
 * Shares the command palette's helpers (one implementation of delete/
 * duplicate/inline-edit) and the storage seam's un-pin/expand. The header
 * names the FACT (icon · title · key · open-link), actions are labeled rows
 * with real tap targets, and appearance controls (type/color/blend/static)
 * fold away under a disclosure instead of leading with cryptic icons.
 */
import { saveCanvas, unpinElements } from './network/storage.ts';
import { deleteSelection, duplicateEl, inlineEdit, reorder } from './cmd-palette/menu-item-helpers.ts';
import type { CanvasElement, CanvasController } from '../types.ts';

function row(label: string, icon: string, onTap: (ev: Event) => void, danger = false): HTMLElement {
  const b = document.createElement('button');
  b.className = 'cm-row' + (danger ? ' cm-danger' : '');
  b.innerHTML = `<i class="fa-solid ${icon}"></i><span>${label}</span>`;
  b.addEventListener('pointerup', (ev) => {
    ev.stopPropagation();
    onTap(ev);
  });
  return b;
}

function section(title: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'cm-section';
  d.textContent = title;
  return d;
}

/** Build the element/group action list as a detached `.cm2` node, so it can be
 *  hosted either by the floating context menu or — Phase 1 of the unified sheet —
 *  the cmd-context panel. `done` is invoked after any terminal action. */
function buildElementActions(el: CanvasElement, controller: CanvasController, done: () => void): HTMLElement {
  const menu = document.createElement('div');
  menu.className = 'cm2';

  const selected = controller.selectedElementIds ?? new Set<string>();
  const group = selected.size > 1 && selected.has(el.id) ? [...selected] : [el.id];
  const many = group.length > 1;

  /* — header: this IS a fact — name it — */
  const head = document.createElement('div');
  head.className = 'cm-head';
  if (many) {
    head.innerHTML = `<strong>${group.length} selected</strong>`;
  } else {
    const anyEl = el as unknown as Record<string, unknown>;
    const icon = (anyEl._factIcon as string) ?? '';
    const title = (anyEl._factTitle as string) ?? (typeof el.content === 'string' ? el.content.split('\n')[0].slice(0, 48) : el.id);
    const key = (anyEl._factKey as string) ?? `el:${el.id}`;
    // Title/key are fact content (often agent-authored) — never innerHTML.
    const strong = document.createElement('strong');
    strong.textContent = `${icon ? icon + ' ' : ''}${title}`;
    const code = document.createElement('code');
    code.textContent = key;
    head.append(strong, code);
    if (anyEl._factHref) {
      const a = document.createElement('a');
      a.href = String(anyEl._factHref);
      a.textContent = 'open →';
      a.className = 'cm-open';
      head.appendChild(a);
    }
  }
  menu.appendChild(head);

  /* — actions — */
  if (!many) {
    menu.appendChild(row('Edit', 'fa-pen-to-square', () => { controller.openEditModal(el); done(); }));
    menu.appendChild(row('Edit inline', 'fa-i-cursor', (ev) => { controller.createEditElement(ev, el, 'content'); done(); }));
    menu.appendChild(
      row('Expand links', 'fa-circle-nodes', () => {
        const anyEl = el as unknown as Record<string, unknown>;
        document.dispatchEvent(
          new CustomEvent('parc:expand', { detail: { key: String(anyEl._factKey ?? `el:${el.id}`), id: el.id } }),
        );
        done();
      }),
    );
  }
  menu.appendChild(
    row(many ? `Duplicate ${group.length}` : 'Duplicate', 'fa-copy', () => {
      group.forEach((id) => duplicateEl(controller, id));
      done();
    }),
  );
  menu.appendChild(
    row(many ? `Un-pin ${group.length}` : 'Un-pin', 'fa-thumbtack', () => {
      unpinElements(controller, group);
      done();
    }),
  );
  menu.appendChild(row('Bring to front', 'fa-layer-group', () => { reorder(controller, 'front'); done(); }));
  menu.appendChild(
    row(many ? `Delete ${group.length}` : 'Delete', 'fa-trash', () => {
      if (!selected.has(el.id)) controller.selectElement(el.id);
      deleteSelection(controller);
      done();
    }, /*danger*/ true),
  );

  /* — appearance (folded; single element only) — */
  if (!many) {
    const details = document.createElement('details');
    details.className = 'cm-appearance';
    const summary = document.createElement('summary');
    summary.textContent = 'Appearance';
    details.appendChild(summary);

    // Type: the FULL render vocabulary — board-native types plus every
    // registered renderer (mermaid, machine, view, surface, …), not the
    // legacy four. Never offered for fact cards (their type is the
    // substrate's, not the board's).
    const isFactCard = !!(el as unknown as Record<string, unknown>)._factCard;
    if (!isFactCard) {
      const typeWrap = document.createElement('label');
      typeWrap.className = 'cm-field';
      typeWrap.textContent = 'Type';
      const typeSel = document.createElement('select');
      const base = ['text', 'markdown', 'html', 'img'];
      const registered: string[] = ((controller as any).elementRegistry?.listTypes?.() ?? [])
        .filter((t: string) => !base.includes(t) && t !== 'fact' && t !== 'edit-prompt');
      const types = [...base, ...registered.sort()];
      if (!types.includes(el.type)) types.unshift(el.type); // current type always listed
      for (const t of types) {
        const o = document.createElement('option');
        o.value = t;
        o.textContent = t;
        typeSel.appendChild(o);
      }
      typeSel.value = el.type;
      typeSel.onchange = () => {
        el.type = typeSel.value;
        controller.updateElementNode(controller.elementNodesMap[el.id], el, el.id === controller.selectedElementId);
        saveCanvas(controller.canvasState);
      };
      typeWrap.appendChild(typeSel);
      details.appendChild(typeWrap);
    }

    if (el.type === 'img') {
      details.appendChild(row('Regenerate image', 'fa-arrow-rotate-right', () => { controller.regenerateImage?.(el); done(); }));
    }

    if (el.type === 'text' || el.type === 'markdown') {
      const colorWrap = document.createElement('label');
      colorWrap.className = 'cm-field';
      colorWrap.textContent = 'Color';
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = el.color || '#000000';
      colorInput.addEventListener('change', () => {
        el.color = colorInput.value;
        controller.updateElementNode(controller.elementNodesMap[el.id], el, el.id === controller.selectedElementId);
        saveCanvas(controller.canvasState);
      });
      colorWrap.appendChild(colorInput);
      details.appendChild(colorWrap);
    }

    const blendWrap = document.createElement('label');
    blendWrap.className = 'cm-field';
    blendWrap.textContent = 'Blend';
    const blendSel = document.createElement('select');
    for (const bm of ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference']) {
      const o = document.createElement('option');
      o.value = bm;
      o.textContent = bm;
      blendSel.appendChild(o);
    }
    blendSel.value = el.blendMode || 'normal';
    blendSel.onchange = () => {
      el.blendMode = blendSel.value;
      controller.updateElementNode(controller.elementNodesMap[el.id], el, el.id === controller.selectedElementId);
      saveCanvas(controller.canvasState);
    };
    blendWrap.appendChild(blendSel);
    details.appendChild(blendWrap);

    details.appendChild(
      row(el.static ? 'Un-stick from screen' : 'Stick to screen', 'fa-arrows-to-dot', () => {
        const node = controller.elementNodesMap[el.id];
        controller.updateElementNode(node, el, true);
        controller.toggleStatic(el);
        (el.static ? controller.staticContainer : controller.container).appendChild(node);
        controller.requestRender();
        saveCanvas(controller.canvasState);
        done();
      }),
    );

    if (el.refCanvasId) {
      details.appendChild(row('Open nested canvas', 'fa-object-group', () => controller.handleDrillIn(el)));
    }
    menu.appendChild(details);
  }
  return menu;
}

/** Legacy floating context menu (retired by the unified sheet, kept as a no-cost
 *  fallback). Renders the same actions into `controller.contextMenu`. */
function buildContextMenu(el: CanvasElement, controller: CanvasController): void {
  if (!el) return;
  const menu = controller.contextMenu;
  menu.innerHTML = '';
  menu.classList.add('cm2');
  menu.appendChild(buildElementActions(el, controller, () => controller.hideContextMenu()));
}

export { buildContextMenu, buildElementActions };
