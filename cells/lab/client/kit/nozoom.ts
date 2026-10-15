/**
 * No page zoom on a phone. iOS Safari zooms the page on a quick double tap anywhere that isn't a canvas, and on a
 * pinch, and keeps that zoom for the page (across reloads) with no easy way back. The experiments manage their own
 * zoom, so the page's is turned off: Safari's pinch gestures, and the second tap of a quick double tap (its touchend,
 * which is what Safari zooms on — the pointer events the pages listen to still come, so a double tap of their own
 * still works). With `maximum-scale=1` in each page's viewport, a page that was left zoomed comes back at 1.
 */
export function noPageZoom(doc: Document = document) {
  for (const g of ['gesturestart', 'gesturechange', 'gestureend']) doc.addEventListener(g, (e) => e.preventDefault(), { passive: false } as AddEventListenerOptions);
  let last = 0, lx = 0, ly = 0;
  doc.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0], now = e.timeStamp;
    if (t && now - last < 350 && Math.hypot(t.clientX - lx, t.clientY - ly) < 40 && e.cancelable) e.preventDefault();
    last = now; lx = t?.clientX ?? 0; ly = t?.clientY ?? 0;
  }, { passive: false });
  doc.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
}
