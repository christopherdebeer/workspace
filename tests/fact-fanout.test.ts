/**
 * FactFanout (services/fact-fanout) — the ONE physical origin of
 * `workspace.fact.written`. `planFactEvents` reduces a DynamoDB stream batch to
 * the announcements it implies; these tests pin the reactor's input contract at
 * the origin: facts only, no vocabulary/system keys, no reaps or retirements,
 * and MODIFY announces only on a revision change (touch bumps and supersedes
 * leave `revision` untouched, so they filter structurally).
 */
import { DynamoDB } from 'aws-sdk';
import { planFactEvents } from '../services/fact-fanout/handler';

const M = (obj: Record<string, unknown>) => DynamoDB.Converter.marshall(obj);
const fact = (scope: string, key: string, extra: Record<string, unknown> = {}) => ({ sk: `KEY#${key}`, scope, key, ...extra });

describe('planFactEvents — stream batch → fact.written announcements', () => {
  it('announces INSERTs and revision-bumping MODIFYs with the real revision', () => {
    const events = planFactEvents({
      Records: [
        { eventName: 'INSERT', dynamodb: { NewImage: M(fact('alice', 'note/1', { revision: 1, value: 'v' })) } },
        {
          eventName: 'MODIFY',
          dynamodb: {
            NewImage: M(fact('alice', 'run/r1', { revision: 7, value: { node: 'B' } })),
            OldImage: M(fact('alice', 'run/r1', { revision: 6, value: { node: 'A' } })),
          },
        },
      ],
    });
    expect(events).toEqual([
      { scope: 'alice', key: 'note/1', revision: 1 },
      { scope: 'alice', key: 'run/r1', revision: 7 },
    ]);
  });

  it('a touch-only MODIFY (same revision — recordTouch, supersede) does not announce', () => {
    const events = planFactEvents({
      Records: [
        {
          eventName: 'MODIFY',
          dynamodb: {
            NewImage: M(fact('alice', 'note/1', { revision: 3, t_hr: 5, w_hr: 2, w_b: 100 })),
            OldImage: M(fact('alice', 'note/1', { revision: 3, t_hr: 4, w_hr: 1, w_b: 100 })),
          },
        },
      ],
    });
    expect(events).toEqual([]);
  });

  it('skips non-facts, vocabulary keys, retirements, and reaps', () => {
    const events = planFactEvents({
      Records: [
        // an edge row — never announces
        { eventName: 'INSERT', dynamodb: { NewImage: M({ sk: 'EDGE#a|rel|b', scope: 'alice', from: 'a', rel: 'rel', to: 'b' }) } },
        // a `_`-prefixed system fact — reactions never see these
        { eventName: 'INSERT', dynamodb: { NewImage: M(fact('alice', '_subscriptions/s1', { revision: 1 })) } },
        // a supersede writes superseded:true (same revision) — retirement isn't an announcement
        {
          eventName: 'MODIFY',
          dynamodb: {
            NewImage: M(fact('alice', 'old/1', { revision: 2, superseded: true })),
            OldImage: M(fact('alice', 'old/1', { revision: 2 })),
          },
        },
        // a TTL reap — not a write
        { eventName: 'REMOVE', dynamodb: { OldImage: M(fact('alice', 'lease/x', { revision: 1 })) } },
      ],
    });
    expect(events).toEqual([]);
  });

  it('a revive (fresh put over a superseded key) announces again', () => {
    const events = planFactEvents({
      Records: [
        {
          eventName: 'MODIFY',
          dynamodb: {
            NewImage: M(fact('alice', 'old/1', { revision: 3, superseded: false })),
            OldImage: M(fact('alice', 'old/1', { revision: 2, superseded: true })),
          },
        },
      ],
    });
    expect(events).toEqual([{ scope: 'alice', key: 'old/1', revision: 3 }]);
  });
});

describe('planWaitWakes — stream batch → one-shot wait-wake schedules (2026-08-01 cost review)', () => {
  const { planWaitWakes } = jest.requireActual<typeof import('../services/fact-fanout/handler')>('../services/fact-fanout/handler');

  it('plans a wake for a machine-run entering `waiting` with a parseable deadline', () => {
    const wakes = planWaitWakes({
      Records: [
        {
          eventName: 'MODIFY',
          dynamodb: {
            NewImage: M(fact('alice', 'machine/tending/run/r1', { type: 'machine-run', revision: 4, value: { status: 'waiting', waitUntil: '2026-08-02T09:00:00.000Z' } })),
            OldImage: M(fact('alice', 'machine/tending/run/r1', { type: 'machine-run', revision: 3, value: { status: 'running' } })),
          },
        },
      ],
    });
    expect(wakes).toEqual([{ scope: 'alice', key: 'machine/tending/run/r1', waitUntil: '2026-08-02T09:00:00.000Z' }]);
  });

  it('ignores non-machine-run facts, non-waiting statuses, retirements, reaps, and unparseable deadlines', () => {
    const wakes = planWaitWakes({
      Records: [
        { eventName: 'INSERT', dynamodb: { NewImage: M(fact('alice', 'note/1', { revision: 1, value: { status: 'waiting', waitUntil: '2026-08-02T09:00:00Z' } })) } },
        { eventName: 'INSERT', dynamodb: { NewImage: M(fact('alice', 'machine/x/run/r2', { type: 'machine-run', revision: 1, value: { status: 'running' } })) } },
        { eventName: 'INSERT', dynamodb: { NewImage: M(fact('alice', 'machine/x/run/r3', { type: 'machine-run', revision: 1, superseded: true, value: { status: 'waiting', waitUntil: '2026-08-02T09:00:00Z' } })) } },
        { eventName: 'REMOVE', dynamodb: { OldImage: M(fact('alice', 'machine/x/run/r4', { type: 'machine-run', revision: 1, value: { status: 'waiting', waitUntil: '2026-08-02T09:00:00Z' } })) } },
        { eventName: 'INSERT', dynamodb: { NewImage: M(fact('alice', 'machine/x/run/r5', { type: 'machine-run', revision: 1, value: { status: 'waiting', waitUntil: 'not-a-date' } })) } },
      ],
    });
    expect(wakes).toEqual([]);
  });
});
