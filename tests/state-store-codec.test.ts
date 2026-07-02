/**
 * StateStore wire codec (ADR-0042 Inc 1) — the pure item⇄record mapping shared by
 * the DynamoDB stores. Testing it directly covers the part of a store port most
 * likely to drift (field coercion), so the v3 store's faithfulness rests on a
 * proof, not a hope — the `send`/command wiring is verified live at deploy.
 */
import { key, itemToRecord, itemToEdge, stripUndefined } from '../platform/runtime/state-store-codec';

describe('state-store-codec: key grammar', () => {
  it('builds the substrate table keys with the scope repeated for LeadingKeys', () => {
    expect(key.statePk('c15r')).toBe('STATE#c15r');
    expect(key.factSk('doc:guide')).toBe('KEY#doc:guide');
    expect(key.edgeSk('a', 'inDoc', 'doc:g')).toBe('EDGE#a|inDoc|doc:g');
    expect(key.inPk('c15r', 'doc:g')).toBe('IN#c15r#doc:g');
    expect(key.inSk('inDoc', 'a')).toBe('inDoc|a');
    expect(key.typePk('c15r', 'doc-block')).toBe('TYPE#c15r#doc-block');
    expect(key.trajSk('2026-07-01T00:00:00.000Z', 42)).toBe('2026-07-01T00:00:00.000Z#000000000042');
  });
});

describe('state-store-codec: itemToRecord', () => {
  it('coerces numerics, defaults absent fields, and preserves optional seeds', () => {
    const rec = itemToRecord({
      scope: 'c15r', key: 'doc:g', value: { title: 'G' },
      revision: '3', seq: '10', firstSeq: '4',
      writer: 'c15r', via: 'lit', createdAt: 'a', updatedAt: 'b',
      writers: ['c15r'], superseded: false, type: 'doc', tags: ['doc'],
      seedReads: '7',
    });
    expect(rec.revision).toBe(3);
    expect(rec.seq).toBe(10);
    expect(rec.firstSeq).toBe(4);
    expect(rec.value).toEqual({ title: 'G' });
    expect(rec.superseded).toBe(false);
    expect(rec.type).toBe('doc');
    expect(rec.seedReads).toBe(7);
    expect(rec.seedWrites).toBeUndefined();
  });

  it('null-defaults value/writer/via/type/supersededBy/timer and array-defaults writers/tags', () => {
    const rec = itemToRecord({ scope: 's', key: 'k', revision: 1, seq: 1, firstSeq: 1, createdAt: 'a', updatedAt: 'b' });
    expect(rec.value).toBeNull();
    expect(rec.writer).toBeNull();
    expect(rec.via).toBeNull();
    expect(rec.type).toBeNull();
    expect(rec.supersededBy).toBeNull();
    expect(rec.timerExpiresAt).toBeNull();
    expect(rec.timerEffect).toBeNull();
    expect(rec.writers).toEqual([]);
    expect(rec.tags).toEqual([]);
  });
});

describe('state-store-codec: itemToEdge', () => {
  it('defaults strength/writer and includes score only when present', () => {
    const bare = itemToEdge({ scope: 's', from: 'a', rel: 'r', to: 'b', createdAt: 'a' });
    expect(bare.strength).toBeNull();
    expect(bare.writer).toBeNull();
    expect('score' in bare).toBe(false);
    const scored = itemToEdge({ scope: 's', from: 'a', rel: 'similarTo', to: 'b', createdAt: 'a', strength: 0.3, score: '0.42', writer: 'platform/vectors' });
    expect(scored.strength).toBe(0.3);
    expect(scored.score).toBe(0.42);
    expect(scored.writer).toBe('platform/vectors');
  });
});

describe('state-store-codec: stripUndefined', () => {
  it('drops undefined OBJECT KEYS recursively, keeps null/0, preserves array positions', () => {
    const out = stripUndefined({ a: 1, b: undefined, c: { d: undefined, e: null }, z: 0, f: [1, undefined as unknown as number, 3] });
    // `b` and nested `d` are gone; `e:null` and `z:0` stay; array keeps its slots.
    expect(out).toEqual({ a: 1, c: { e: null }, z: 0, f: [1, undefined, 3] });
    expect('b' in out).toBe(false);
    expect('d' in (out.c as object)).toBe(false);
  });

  it('returns primitives and null unchanged', () => {
    expect(stripUndefined(5)).toBe(5);
    expect(stripUndefined('x')).toBe('x');
    expect(stripUndefined(null)).toBeNull();
  });
});
