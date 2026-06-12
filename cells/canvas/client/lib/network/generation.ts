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

async function enabledProviders(mode: 'text' | 'image'): Promise<string[]> {
  if (!providersCache) {
    try {
      providersCache = (await read<{ providers: Record<string, { enabled?: boolean }> }>('@c15r/models.listProviders', {}))
        .providers;
    } catch {
      providersCache = {};
    }
  }
  const order = mode === 'image' ? ['openai', 'google'] : ['anthropic', 'openai', 'google'];
  const found = order.filter((p) => providersCache?.[p]?.enabled);
  if (!found.length) {
    throw new Error(`no ${mode} provider enabled — paste a key at /@c15r/models/secrets`);
  }
  return found;
}

/** Try each enabled provider in order — an out-of-credits key must not block. */
async function runWithFallback(mode: 'text' | 'image', args: Record<string, unknown>): Promise<RunOut> {
  const errors: string[] = [];
  for (const provider of await enabledProviders(mode)) {
    try {
      if (mode === 'image') {
        // Image generation exceeds the edge's ~30s sync cap: submit a job
        // (fast), then poll fetch until it lands.
        const sub = await act<{ jobId: string }>('@c15r/models.run', { ...args, provider, mode, async: true });
        const deadline = Date.now() + 120_000;
        for (;;) {
          await new Promise((r) => setTimeout(r, 3000));
          const job = await read<RunOut & { status?: string; error?: string }>('@c15r/models.fetch', { jobId: sub.jobId });
          if (job.status === 'done') return job;
          if (job.status === 'error') throw new Error(job.error ?? 'generation failed');
          if (Date.now() > deadline) throw new Error('generation timed out (120s)');
        }
      }
      return await act<RunOut>('@c15r/models.run', { ...args, provider });
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  throw new Error(errors.join(' | '));
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
  const out = await runWithFallback('text', {
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
    const out = await runWithFallback('text', {
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

/**
 * Upload bytes via a presigned S3 PUT — no edge body cap, no inline base64,
 * no compression gate (iOS can't even encode webp: toDataURL('image/webp')
 * silently returns PNG there).
 */
export async function uploadBlob(key: string, blob: Blob, contentType: string): Promise<string> {
  const grant = await act<{ uploadUrl: string; url: string | null }>('cells.putData', {
    owner: 'c15r',
    name: 'canvas',
    key,
    contentType,
    presign: true,
  });
  const put = await fetch(grant.uploadUrl, { method: 'PUT', headers: { 'content-type': contentType }, body: blob });
  if (!put.ok) throw new Error(`upload failed: HTTP ${put.status}`);
  if (!grant.url) throw new Error('stored but not web-addressable (cell not public?)');
  return grant.url;
}

function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Generate an image for an img element from its content (the prompt).
 * The bytes go to blob storage; the fact carries only the pointer.
 */
export async function regenerateImage(el: any): Promise<void> {
  try {
    const out = await runWithFallback('image', {
      prompt: el.content || 'abstract placeholder image',
    });
    if (!out.imageB64) throw new Error('no image returned');
    const mime = out.mime ?? 'image/png';
    const ext = (mime.split('/')[1] ?? 'png').replace(/[^a-z0-9]/gi, '');
    const key = `public/img/gen-${Date.now().toString(36)}.${ext}`;
    el.src = await uploadBlob(key, b64ToBlob(out.imageB64, mime), mime);
    el.srcPrompt = el.content; // provenance: the prompt that produced this artifact
  } catch (err) {
    console.warn('[regenerateImage]', err);
    // Leave a visible placeholder rather than re-triggering generation loops.
    el.src = el.src || `https://placehold.co/${Math.round(el.width || 300)}x${Math.round(el.height || 200)}?text=${encodeURIComponent(((err as Error).message || 'generation failed').slice(0, 60))}`;
  }
}
