import * as React from 'react';
import styled from '../../shared/styled';
import { theme } from '../../shared/theme';
import type { BorrowRequest, ShipmentRecord, ShippingAddress, ShippingProviderStatus, ShippingRate } from '../../shared/types';
import { BookCover } from '../../shared/components/BookCover';
import { Field, PrimaryButton, QuietButton } from '../../shared/components/Layout';

const Section = styled.section`margin: 30px 0; padding-top: 26px; border-top: 1px solid ${theme.line};`;
const Heading = styled.h2`margin: 0; font: 600 clamp(27px, 4vw, 40px)/1 ${theme.serif};`;
const Intro = styled.p`margin: 8px 0 18px; color: ${theme.quiet}; font-size: 13px; line-height: 1.5;`;
const Grid = styled.div`display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px;`;
const Card = styled.article`padding: 15px; border: 1px solid ${theme.line}; border-radius: 15px; background: ${theme.paperRaised};`;
const Row = styled.div`display: grid; grid-template-columns: 58px 1fr; gap: 12px;`;
const Title = styled.h3`margin: 2px 0 5px; font: 600 19px/1.1 ${theme.serif};`;
const Meta = styled.p`margin: 4px 0; color: ${theme.quiet}; font-size: 11px; line-height: 1.4;`;
const Badge = styled.span`display: inline-block; margin-top: 5px; border-radius: 999px; padding: 4px 7px; background: ${theme.mossSoft}; color: ${theme.moss}; font-size: 9px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;`;
const Actions = styled.div`display: flex; flex-wrap: wrap; gap: 7px; margin-top: 12px;`;
const Postal = styled.div`margin-top: 13px; padding: 12px; border-radius: 11px; background: ${theme.paper};`;
const PostalTitle = styled.strong`display: block; font-size: 12px;`;
const PostalText = styled.p`margin: 4px 0 10px; color: ${theme.quiet}; font-size: 11px; line-height: 1.45;`;
const Form = styled.div`display: grid; gap: 8px; margin-top: 10px;`;
const Pair = styled.div`display: grid; grid-template-columns: 1fr 1fr; gap: 8px;`;
const Rate = styled.button`width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 7px; border: 1px solid ${theme.line}; border-radius: 10px; padding: 10px; background: ${theme.paperRaised}; color: ${theme.ink}; cursor: pointer; text-align: left;`;
const Empty = styled.div`padding: 24px; border: 1px dashed ${theme.line}; border-radius: 14px; color: ${theme.quiet}; text-align: center; font-size: 13px;`;
const ErrorText = styled.p`color: ${theme.clay}; font-size: 11px;`;
const ShipmentLink = styled.a`display: inline-block; margin: 8px 10px 0 0; color: ${theme.moss}; font-size: 11px; font-weight: 750;`;
const Setup = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 0 0 18px; padding: 14px; border: 1px solid ${theme.line}; border-radius: 14px; background: ${theme.claySoft}; @media (max-width: 620px) { align-items: stretch; flex-direction: column; }`;
const SetupCopy = styled.p`margin: 4px 0 0; color: ${theme.quiet}; font-size: 11px; line-height: 1.45;`;
const TokenRow = styled.div`display: flex; gap: 7px; min-width: min(100%, 350px); & input { min-width: 0; }`;

const statusLabel = (request: BorrowRequest): string => `${request.status} · ${request.deliveryMethod === 'post' ? 'by post' : 'local handoff'}`;

function AddressForm({ onSave }: { onSave: (address: ShippingAddress) => Promise<void> }): React.JSX.Element {
  const [form, setForm] = React.useState({ name: '', street1: '', street2: '', city: '', postcode: '' });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value })) });
  const save = async (): Promise<void> => { setBusy(true); setError(''); try { await onSave({ ...form, country: 'GB' }); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } };
  return <Form><Field placeholder="Full name" {...field('name')} /><Field placeholder="Address line 1" {...field('street1')} /><Field placeholder="Address line 2 (optional)" {...field('street2')} /><Pair><Field placeholder="Town or city" {...field('city')} /><Field placeholder="Postcode" {...field('postcode')} /></Pair><PrimaryButton disabled={busy || !form.name || !form.street1 || !form.city || !form.postcode} onClick={() => void save()}>{busy ? 'Saving…' : 'Save private address'}</PrimaryButton>{error ? <ErrorText>{error}</ErrorText> : null}</Form>;
}

function RequestCard({ request, direction, address, shipping, shipment, onDecision, onSaveAddress, onQuote, onPurchaseTest }: {
  request: BorrowRequest; direction: 'incoming' | 'outgoing'; address: ShippingAddress | null; shipping: ShippingProviderStatus; shipment?: ShipmentRecord;
  onDecision: (id: string, status: 'accepted' | 'declined' | 'cancelled') => Promise<void>;
  onSaveAddress: (address: ShippingAddress) => Promise<void>;
  onQuote: (requestId: string) => Promise<ShippingRate[]>;
  onPurchaseTest: (requestId: string, rateId: string) => Promise<void>;
}): React.JSX.Element {
  const [rates, setRates] = React.useState<ShippingRate[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const quote = async (): Promise<void> => { setBusy(true); setError(''); try { setRates(await onQuote(request.id)); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } };
  return <Card><Row><BookCover title={request.title} url={request.coverUrl} width={58} height={86} /><div><Title>{request.title}</Title><Meta>{direction === 'incoming' ? 'Someone would like this copy' : 'Your request'}</Meta><Badge>{statusLabel(request)}</Badge></div></Row>{request.status === 'pending' ? <Actions>{direction === 'incoming' ? <><PrimaryButton onClick={() => void onDecision(request.id, 'accepted')}>Accept</PrimaryButton><QuietButton onClick={() => void onDecision(request.id, 'declined')}>Decline</QuietButton></> : <QuietButton onClick={() => void onDecision(request.id, 'cancelled')}>Cancel request</QuietButton>}</Actions> : null}{request.status === 'accepted' && request.deliveryMethod === 'post' ? <Postal><PostalTitle>Tracked postage</PostalTitle>{!address ? <><PostalText>Add your address privately. It is used server-side for the label and is never shown on the public shelf.</PostalText><AddressForm onSave={onSaveAddress} /></> : direction === 'incoming' ? <PostalText>Your return address is saved. The borrower can compare postage once their address is also ready.</PostalText> : shipment ? <><PostalText>{shipment.carrier ?? 'Carrier'} {shipment.service ?? ''} · {shipment.status}</PostalText>{shipment.labelUrl ? <ShipmentLink href={shipment.labelUrl} target="_blank" rel="noreferrer">Open printable label</ShipmentLink> : null}{shipment.qrCodeUrl ? <ShipmentLink href={shipment.qrCodeUrl} target="_blank" rel="noreferrer">Open drop-off QR</ShipmentLink> : null}{shipment.trackingUrl ? <ShipmentLink href={shipment.trackingUrl} target="_blank" rel="noreferrer">Track parcel</ShipmentLink> : null}</> : !shipping.configured ? <PostalText>The shipping adapter is installed. A Shippo test token is the remaining switch for rates and test labels.</PostalText> : <><PostalText>{shipping.mode === 'test' ? 'Test mode: compare real-shaped rates and generate non-chargeable labels.' : 'Live rates are enabled. Label purchase remains locked until buyer payment is wired.'}</PostalText><QuietButton disabled={busy} onClick={() => void quote()}>{busy ? 'Checking…' : 'Compare postage'}</QuietButton>{rates.map((rate) => <Rate key={rate.id} disabled={shipping.mode !== 'test'} onClick={() => void onPurchaseTest(request.id, rate.id)}><span><strong>{rate.provider}</strong><br /><small>{rate.service}{rate.estimatedDays ? ` · ~${rate.estimatedDays} days` : ''}</small></span><strong>{rate.currency} {rate.amount}</strong></Rate>)}</>}{error ? <ErrorText>{error}</ErrorText> : null}</Postal> : null}</Card>;
}

export function RequestsPanel({ incoming, outgoing, address, shipping, shipments, onDecision, onSaveAddress, onQuote, onPurchaseTest, onConfigure }: {
  incoming: BorrowRequest[]; outgoing: BorrowRequest[]; address: ShippingAddress | null; shipping: ShippingProviderStatus; shipments: ShipmentRecord[];
  onDecision: (id: string, status: 'accepted' | 'declined' | 'cancelled') => Promise<void>;
  onSaveAddress: (address: ShippingAddress) => Promise<void>;
  onQuote: (requestId: string) => Promise<ShippingRate[]>;
  onPurchaseTest: (requestId: string, rateId: string) => Promise<void>;
  onConfigure: (token: string) => Promise<void>;
}): React.JSX.Element {
  const [token, setToken] = React.useState('');
  const [configuring, setConfiguring] = React.useState(false);
  const [configError, setConfigError] = React.useState('');
  const configure = async (): Promise<void> => { setConfiguring(true); setConfigError(''); try { await onConfigure(token); setToken(''); } catch (err) { setConfigError((err as Error).message); } finally { setConfiguring(false); } };
  const all = [...incoming.map((request) => ({ request, direction: 'incoming' as const })), ...outgoing.map((request) => ({ request, direction: 'outgoing' as const }))];
  return <Section><Heading>Requests & journeys</Heading><Intro>Local handoffs stay simple. Postal requests become tracked journeys only after both readers agree.</Intro>{shipping.canConfigure ? <Setup><div><strong>Postage · {shipping.configured ? shipping.mode : 'not connected'}</strong><SetupCopy>{shipping.configured ? 'The carrier token is stored write-only in this cell.' : 'Connect a Shippo test token to exercise rates and non-chargeable labels. The token is never shown again.'}</SetupCopy>{configError ? <ErrorText>{configError}</ErrorText> : null}</div>{!shipping.configured ? <TokenRow><Field type="password" autoComplete="off" placeholder="shippo_test_…" value={token} onChange={(event) => setToken(event.target.value)} /><PrimaryButton disabled={configuring || !token} onClick={() => void configure()}>{configuring ? 'Connecting…' : 'Connect'}</PrimaryButton></TokenRow> : null}</Setup> : null}{all.length ? <Grid>{all.map(({ request, direction }) => <RequestCard key={`${direction}-${request.id}`} request={request} direction={direction} address={address} shipping={shipping} shipment={shipments.find((item) => item.requestId === request.id)} onDecision={onDecision} onSaveAddress={onSaveAddress} onQuote={onQuote} onPurchaseTest={onPurchaseTest} />)}</Grid> : <Empty>No requests yet. When another reader asks for one of your books, it will appear here.</Empty>}</Section>;
}
