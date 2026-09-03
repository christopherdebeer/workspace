import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { BorrowRequest, ShipmentRecord, ShippingAddress, ShippingProviderStatus, ShippingRate } from '../shared/types';
import { listBorrowRequests } from './store';

const TABLE = process.env.TABLE_NAME ?? '';
const OWNER = process.env.CELL_OWNER ?? 'c15r';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const userPk = (caller: string): string => `USER#${caller}`;
type ShippingConfig = { provider: 'shippo'; token: string; mode: 'test' | 'live'; configuredAt: string };

async function config(): Promise<ShippingConfig | null> {
  const result = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'CONFIG', sk: 'SHIPPING#SHIPPO' } }));
  return (result.Item?.value as ShippingConfig | undefined) ?? null;
}

export async function configureShipping(caller: string, token: string): Promise<ShippingProviderStatus> {
  if (caller !== OWNER) throw Object.assign(new Error('only the cell owner can configure shipping'), { statusCode: 403 });
  const clean = token.trim();
  if (!/^shippo_(test|live)_[A-Za-z0-9]+$/.test(clean)) throw new Error('a Shippo test or live API token is required');
  const value: ShippingConfig = { provider: 'shippo', token: clean, mode: clean.startsWith('shippo_test_') ? 'test' : 'live', configuredAt: new Date().toISOString() };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { pk: 'CONFIG', sk: 'SHIPPING#SHIPPO', entity: 'shipping-config', value } }));
  return { provider: 'shippo', configured: true, mode: value.mode };
}

export async function shippingStatus(caller?: string): Promise<ShippingProviderStatus> {
  const value = await config();
  return { provider: 'shippo', configured: Boolean(value), mode: value?.mode ?? 'unconfigured', canConfigure: caller === OWNER };
}

export async function saveShippingAddress(caller: string, address: ShippingAddress): Promise<void> {
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { pk: userPk(caller), sk: 'PROFILE#SHIPPING', entity: 'private-shipping-address', value: address, updatedAt: new Date().toISOString() } }));
}

export async function getShippingAddress(caller: string): Promise<ShippingAddress | null> {
  const result = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: userPk(caller), sk: 'PROFILE#SHIPPING' } }));
  return (result.Item?.value as ShippingAddress | undefined) ?? null;
}

async function shippo(path: string, body: unknown): Promise<Record<string, unknown>> {
  const value = await config();
  if (!value) throw Object.assign(new Error('Shipping is ready for a Shippo test token.'), { statusCode: 503 });
  const response = await fetch(`https://api.goshippo.com${path}`, { method: 'POST', headers: { authorization: `ShippoToken ${value.token}`, 'content-type': 'application/json', 'shippo-api-version': '2018-02-08' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw Object.assign(new Error(typeof result.detail === 'string' ? result.detail : `Shippo returned ${response.status}`), { statusCode: 502 });
  return result;
}

function shippoAddress(address: ShippingAddress): Record<string, unknown> {
  return { name: address.name, street1: address.street1, street2: address.street2, city: address.city, zip: address.postcode, country: 'GB', email: address.email, phone: address.phone };
}

function participantRequest(requests: { incoming: BorrowRequest[]; outgoing: BorrowRequest[] }, requestId: string): BorrowRequest {
  const request = [...requests.incoming, ...requests.outgoing].find((item) => item.id === requestId);
  if (!request) throw Object.assign(new Error('borrow request not found'), { statusCode: 404 });
  if (request.status !== 'accepted' || request.deliveryMethod !== 'post') throw new Error('postage is available after a postal request is accepted');
  return request;
}

export async function quoteRequestShipping(caller: string, requestId: string, parcel: 'single-book' | 'book-box' = 'single-book'): Promise<ShippingRate[]> {
  const request = participantRequest(await listBorrowRequests(caller), requestId);
  if (request.requesterId !== caller) throw Object.assign(new Error('the borrower chooses and pays for postage'), { statusCode: 403 });
  const [fromResult, toResult] = await Promise.all([
    ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: userPk(request.ownerId), sk: 'PROFILE#SHIPPING' } })),
    ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: userPk(request.requesterId), sk: 'PROFILE#SHIPPING' } })),
  ]);
  const from = fromResult.Item?.value as ShippingAddress | undefined;
  const to = toResult.Item?.value as ShippingAddress | undefined;
  if (!from || !to) throw new Error('both readers need to add a private postal address before rates can be requested');
  const size = parcel === 'book-box' ? { length: '35', width: '25', height: '10', weight: '2' } : { length: '25', width: '18', height: '5', weight: '0.75' };
  const shipment = await shippo('/shipments/', { address_from: shippoAddress(from), address_to: shippoAddress(to), parcels: [{ ...size, distance_unit: 'cm', mass_unit: 'kg' }], async: false, metadata: `shelved:${requestId}` });
  const rates = Array.isArray(shipment.rates) ? shipment.rates as Array<Record<string, unknown>> : [];
  return rates.filter((rate) => rate.object_id && rate.amount).map((rate) => {
    const service = (rate.servicelevel ?? {}) as Record<string, unknown>;
    return { id: String(rate.object_id), provider: String(rate.provider ?? 'Carrier'), service: String(service.name ?? 'Delivery'), amount: String(rate.amount), currency: String(rate.currency ?? 'GBP'), estimatedDays: typeof rate.estimated_days === 'number' ? rate.estimated_days : undefined, duration: typeof rate.duration_terms === 'string' ? rate.duration_terms : undefined };
  });
}

export async function purchaseTestLabel(caller: string, requestId: string, rateId: string): Promise<ShipmentRecord> {
  const currentConfig = await config();
  if (!currentConfig || currentConfig.mode !== 'test') throw new Error('Live labels require payment confirmation; only test labels can be purchased here.');
  const request = participantRequest(await listBorrowRequests(caller), requestId);
  if (request.requesterId !== caller) throw Object.assign(new Error('the borrower purchases postage'), { statusCode: 403 });
  const transaction = await shippo('/transactions', { rate: rateId, async: false, label_file_type: 'PDF_A4', metadata: `shelved:${requestId}` });
  if (transaction.status !== 'SUCCESS') throw new Error('Shippo could not create the test label.');
  const stamp = new Date().toISOString();
  const rate = (transaction.rate ?? {}) as Record<string, unknown>;
  const service = (rate.servicelevel ?? {}) as Record<string, unknown>;
  const shipment: ShipmentRecord = { id: randomUUID(), requestId, provider: 'shippo', direction: 'outbound', status: 'label-created', rateId, carrier: typeof rate.provider === 'string' ? rate.provider : undefined, service: typeof service.name === 'string' ? service.name : undefined, amount: typeof rate.amount === 'string' ? rate.amount : undefined, currency: typeof rate.currency === 'string' ? rate.currency : undefined, labelUrl: typeof transaction.label_url === 'string' ? transaction.label_url : undefined, qrCodeUrl: typeof transaction.qr_code_url === 'string' ? transaction.qr_code_url : undefined, trackingNumber: typeof transaction.tracking_number === 'string' ? transaction.tracking_number : undefined, trackingUrl: typeof transaction.tracking_url_provider === 'string' ? transaction.tracking_url_provider : undefined, createdAt: stamp, updatedAt: stamp };
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE, Item: { pk: userPk(request.ownerId), sk: `SHIPMENT#${shipment.id}`, entity: 'shipment', value: shipment } } },
    { Put: { TableName: TABLE, Item: { pk: userPk(request.requesterId), sk: `SHIPMENT#${shipment.id}`, entity: 'shipment', value: shipment } } },
  ] }));
  return shipment;
}

export async function listShipments(caller: string): Promise<ShipmentRecord[]> {
  const result = await ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': userPk(caller), ':prefix': 'SHIPMENT#' } }));
  return (result.Items ?? []).map((row) => row.value as ShipmentRecord).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
