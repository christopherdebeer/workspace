import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const json = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const handler = async (event) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  if (method === 'GET' && path === '/_tools') {
    return json(200, { tools: [{ name: 'report', description: 'Emit a fact to the reef via substrate.write.requested', kind: 'act', inputSchema: { type: 'object', properties: { key: { type: 'string' }, value: {} }, required: ['key'] }, scope: null }] });
  }
  if (method === 'POST' && path === '/_tools/report') {
    const args = event.body ? JSON.parse(event.body) : {};
    const client = new EventBridgeClient({});
    await client.send(new PutEventsCommand({ Entries: [{
      EventBusName: process.env.EVENT_BUS_NAME,
      Source: process.env.SERVICE_NAME,
      DetailType: 'substrate.write.requested',
      Detail: JSON.stringify({ key: args.key, value: args.value ?? null, type: 'reading', via: 'reef-writer.report' }),
    }]}));
    return json(200, { emitted: true, key: args.key, at: new Date().toISOString() });
  }
  return json(404, { error: `no route for ${method} ${path}` });
};
