/**
 * Render service — a tiny peer used to demonstrate synchronous
 * service-to-service commands (communication Mode 1). The Documents service
 * calls `render.generatePreview` while creating a document.
 */
import { defineService, ServiceContext } from '../../platform/runtime';

interface GeneratePreviewInput {
  body: string;
  maxLength?: number;
}

interface GeneratePreviewOutput {
  preview: string;
}

async function generatePreview(
  input: GeneratePreviewInput,
  ctx: ServiceContext,
): Promise<GeneratePreviewOutput> {
  const max = input.maxLength ?? 140;
  const normalised = (input.body ?? '').replace(/\s+/g, ' ').trim();
  const preview = normalised.length > max ? `${normalised.slice(0, max - 1)}…` : normalised;
  ctx.logger.info('generated preview', { length: preview.length });
  return { preview };
}

export const handler = defineService({
  name: 'render',
  commands: { generatePreview },
  events: { emits: [] },
});

export default handler;
