/**
 * generation.ts — the canvas's hand into the generative executor.
 *
 * All model calls go through @c15r/models.run (provider client code + key
 * custody live THERE, not here). Providers are picked from whatever the
 * owner has enabled (/@c15r/models/secrets); context still flows from the
 * element's incoming edges — the substrate graph is the prompt context.
 * Generated images land in blob storage (putData) and the fact carries
 * only the pointer, like pasted images.
 */
import { act, read } from './substrate.ts';
import { saveCanvas } from './storage.ts';

type RunOut = { text?: string; imageB64?: string; mime?: string };

let providersCache: Record<string, { enabled?: boolean }> | null = null;

async function pickProvider(mode: 'text' | 'image'): Promise<string> {
  if (!providersCache) {
    try {
      providersCache = (await read<{ providers: Record<string, { enabled?: boolean }> }>('@c15r/models.listProviders', {}))
        .providers;
    } catch {
      providersCache = {};
    }
  }
  const order = mode === 'image' ? ['openai', 'google'] : ['anthropic', 'openai', 'google'];
  const found = order.find((p) => providersCache?.[p]?.enabled);
  if (!found) {
    throw new Error(`no ${mode} provider enabled — paste a key at /@c15r/models/secrets`);
  }
  return found;
}

/** Incoming-edge context: the graph IS the prompt context. */
function edgeContext(el: any, c: any): string {
  const incoming = c
    .findEdgesByElementId(el.id)
    .filter((e: any) => e.target === el.id)
    .map((e: any) => ({ label: e.label, content: c.findElementById(e.source)?.content }))
    .filter((r: any) => typeof r.content === 'string');
  if (!incoming.length) return '';
  return incoming.map((r: any) => `<relation label="${r.label ?? ''}">\n${r.content}\n</relation>`).join('\n');
}

/**
 * Edit an element per a free-form instruction (the command-palette flow).
 * Explicitly user-invoked, so the result applies directly; the substrate
 * revision chain keeps the prior value.
 */
export async function editElementWithPrompt(prompt: string, el: any, controller: any): Promise<string | undefined> {
  const provider = await pickProvider('text');
  const out = await act<RunOut>('@c15r/models.run', {
    provider,
    prompt: `Update this canvas element (type: ${el.type}) according to the instruction.\n\n<current-content>\n${el.content ?? ''}\n</current-content>\n\nInstruction: "${prompt}"`,
    system:
      'You edit elements on a visual canvas. Respond ONLY with the new element content — no preamble, no explanation, no code fences (unless the content itself is code).',
    context: edgeContext(el, controller) || undefined,
  });
  if (!out.text) return undefined;
  el.content = out.text.trim();
  controller.updateElementNode(controller.elementNodesMap[el.id], el, true);
  saveCanvas(controller.canvasState);
  return el.content;
}

/**
 * Generate/improve content from a seed (modal Generate button, palette
 * Generate New). Returns the text; the CALLER decides where it lands —
 * the modal shows it for review (consent before save).
 */
export async function generateContent(content: string, el: any, c: any): Promise<string | null> {
  try {
    const provider = await pickProvider('text');
    const out = await act<RunOut>('@c15r/models.run', {
      provider,
      prompt: content || `Write content for an empty ${el.type} canvas element.`,
      system: `You write content for elements on a visual canvas. The element type is "${el.type}" — produce content appropriate to it (markdown for markdown, valid HTML fragments for html, plain prose for text). Respond ONLY with the content: no preamble, no code fences.`,
      context: edgeContext(el, c) || undefined,
    });
    return out.text?.trim() ?? null;
  } catch (err) {
    console.warn('[generate]', err);
    alert((err as Error).message);
    return null;
  }
}

/** Re-encode to webp under the edge's ~700KB inline ceiling. */
async function compressForUpload(b64: string, mime: string): Promise<{ b64: string; mime: string }> {
  if (b64.length * 0.75 < 600 * 1024 && mime === 'image/webp') return { b64, mime };
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('generated image failed to decode'));
    img.src = `data:${mime};base64,${b64}`;
  });
  const cv = document.createElement('canvas');
  const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
  cv.width = Math.round(img.naturalWidth * k);
  cv.height = Math.round(img.naturalHeight * k);
  cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
  for (const q of [0.85, 0.65, 0.45]) {
    const data = cv.toDataURL('image/webp', q);
    const out = data.slice(data.indexOf(',') + 1);
    if (out.length * 0.75 < 600 * 1024) return { b64: out, mime: 'image/webp' };
  }
  throw new Error('generated image too large even after compression');
}

/**
 * Generate an image for an img element from its content (the prompt).
 * The bytes go to blob storage; the fact carries only the pointer.
 */
export async function regenerateImage(el: any): Promise<void> {
  try {
    const provider = await pickProvider('image');
    const out = await act<RunOut>('@c15r/models.run', {
      provider,
      mode: 'image',
      prompt: el.content || 'abstract placeholder image',
    });
    if (!out.imageB64) throw new Error('no image returned');
    const { b64, mime } = await compressForUpload(out.imageB64, out.mime ?? 'image/png');
    const key = `public/img/gen-${Date.now().toString(36)}.webp`;
    const put = await act<{ url: string | null }>('cells.putData', {
      owner: 'c15r',
      name: 'canvas',
      key,
      content: b64,
      encoding: 'base64',
      contentType: mime,
    });
    if (!put.url) throw new Error('image stored but not web-addressable');
    el.src = put.url;
    el.srcPrompt = el.content; // provenance: the prompt that produced this artifact
  } catch (err) {
    console.warn('[regenerateImage]', err);
    // Leave a visible placeholder rather than re-triggering generation loops.
    el.src = el.src || `https://placehold.co/${Math.round(el.width || 300)}x${Math.round(el.height || 200)}?text=${encodeURIComponent(((err as Error).message || 'generation failed').slice(0, 60))}`;
  }
}
