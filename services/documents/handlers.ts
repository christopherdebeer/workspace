/**
 * Documents service command handlers.
 *
 * Demonstrates the full cell toolkit: per-user auth, owned DynamoDB
 * persistence, a synchronous call into the Render service, and a domain event
 * emitted onto the shared bus.
 */
import { randomUUID } from 'crypto';
import { DynamoDB } from 'aws-sdk';
import { ServiceContext, requireUser } from '../../platform/runtime';

const db = new DynamoDB.DocumentClient();

export interface CreateDocumentInput {
  title: string;
  body: string;
}

export interface DocumentRecord {
  id: string;
  title: string;
  body: string;
  preview: string;
  owner: string;
  createdAt: string;
}

interface RenderPreview {
  preview: string;
}

function keyFor(id: string): { pk: string; sk: string } {
  return { pk: `doc#${id}`, sk: 'v0' };
}

function tableName(ctx: ServiceContext): string {
  if (!ctx.config.tableName) {
    throw new Error('Documents service requires a DynamoDB table (TABLE_NAME)');
  }
  return ctx.config.tableName;
}

export async function createDocument(
  input: CreateDocumentInput,
  ctx: ServiceContext,
): Promise<DocumentRecord> {
  const owner = requireUser(ctx.identity);
  if (!input?.title || !input?.body) {
    throw new Error('title and body are required');
  }

  // Mode 1: synchronous command into a peer service for the preview.
  const { preview } = await ctx
    .serviceClient('render')
    .command<RenderPreview>('generatePreview', { body: input.body });

  const record: DocumentRecord = {
    id: randomUUID(),
    title: input.title,
    body: input.body,
    preview,
    owner,
    createdAt: new Date().toISOString(),
  };

  await db
    .put({
      TableName: tableName(ctx),
      Item: { ...keyFor(record.id), ...record },
    })
    .promise();

  // Mode 2: announce the change for any interested subscriber.
  await ctx.events.emit('document.created', { id: record.id, owner, title: record.title });
  ctx.logger.info('document created', { id: record.id });

  return record;
}

export interface GetDocumentInput {
  id: string;
}

export async function getDocument(
  input: GetDocumentInput,
  ctx: ServiceContext,
): Promise<DocumentRecord | null> {
  requireUser(ctx.identity);
  if (!input?.id) {
    throw new Error('id is required');
  }
  const { Item } = await db
    .get({ TableName: tableName(ctx), Key: keyFor(input.id) })
    .promise();
  if (!Item) return null;
  const { pk: _pk, sk: _sk, ...record } = Item as DocumentRecord & { pk: string; sk: string };
  return record;
}
