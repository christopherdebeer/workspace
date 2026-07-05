/**
 * Substrate archiver — the analytics/archive lane's pure planner.
 *
 * Pins the stream→row contract: facts only (skip edges + non-fact partitions),
 * OldImage on REMOVE, and the flattened column shape Athena reads.
 */
import { DynamoDB } from 'aws-sdk';
import { planArchiveRows, type FactRow } from '../services/substrate-archiver/handler';

const marshall = DynamoDB.Converter.marshall;

const AT = '2026-07-05T00:00:00.000Z';

function factImage(over: Record<string, unknown> = {}): Record<string, unknown> {
  return marshall({
    pk: 'STATE#c15r',
    sk: `KEY#${(over.key as string) ?? 'kb/abc'}`,
    scope: 'c15r',
    key: 'kb/abc',
    value: { content: 'hello' },
    type: 'knowledge',
    tags: ['a', 'b'],
    revision: 2,
    seq: 42,
    firstSeq: 40,
    writer: 'c15r',
    via: 'lit',
    superseded: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-04T00:00:00.000Z',
    ...over,
  });
}

function rec(
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
  image: Record<string, unknown>,
  which: 'NewImage' | 'OldImage' = 'NewImage',
) {
  return { eventName, dynamodb: { [which]: image } };
}

describe('planArchiveRows', () => {
  it('flattens a fact insert into the Athena column shape', () => {
    const rows = planArchiveRows({ Records: [rec('INSERT', factImage())] }, AT);
    expect(rows).toHaveLength(1);
    const row: FactRow = rows[0];
    expect(row).toMatchObject({
      scope: 'c15r',
      key: 'kb/abc',
      type: 'knowledge',
      tags: ['a', 'b'],
      revision: 2,
      seq: 42,
      first_seq: 40,
      writer: 'c15r',
      via: 'lit',
      superseded: false,
      event_name: 'INSERT',
      archived_at: AT,
    });
    // The arbitrary fact body is preserved as a JSON string, not a column.
    expect(JSON.parse(row.value_json)).toEqual({ content: 'hello' });
  });

  it('skips edges and non-fact partitions (only KEY# sort keys)', () => {
    const edge = marshall({ pk: 'STATE#c15r', sk: 'EDGE#a|rel|b', scope: 'c15r' });
    const traj = marshall({ pk: 'TRAJ#c15r', sk: '2026#1', scope: 'c15r' });
    const rows = planArchiveRows(
      { Records: [rec('INSERT', edge), rec('INSERT', traj), rec('INSERT', factImage())] },
      AT,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('kb/abc');
  });

  it('archives a REMOVE from the OldImage', () => {
    const rows = planArchiveRows(
      { Records: [rec('REMOVE', factImage({ superseded: true }), 'OldImage')] },
      AT,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].event_name).toBe('REMOVE');
    expect(rows[0].superseded).toBe(true);
  });

  it('is a no-op on an empty batch', () => {
    expect(planArchiveRows({}, AT)).toEqual([]);
    expect(planArchiveRows({ Records: [] }, AT)).toEqual([]);
  });
});
