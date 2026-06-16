/**
 * starter template — caller-write emission (Phase 4, docs/capability-consent.md).
 *
 * The canonical template now closes the read+write loop: a signed-in visitor
 * POSTs a note and the cell returns an `x-parc-writes` header DECLARING the write
 * for dispatch to apply AS THE CALLER (the cell holds no token). Asserts the
 * header shape for own-slice (`note:`) and cross-slice (`shared/` + owner) writes,
 * and that anonymous/empty requests emit nothing.
 */
// The POST/caller-write path never renders, so stub the JSX module (the test
// tsconfig transpiles .ts with createElement, not raw .tsx JSX) to keep the
// import graph free of JSX while we exercise the handler.
jest.mock('../cells/starter/shared', () => ({ Surface: () => null }));

import { handler as starter } from '../cells/starter/index';

interface CellResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}
interface Write {
  key: string;
  value: { text: string };
  type: string;
  owner?: string;
}

function post(body: unknown, caller?: string, path = '/note'): Promise<CellResponse> {
  return starter({
    requestContext: { http: { method: 'POST' } },
    rawPath: path,
    headers: caller ? { 'x-cell-caller': caller } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as Promise<CellResponse>;
}

const writesOf = (res: CellResponse): Write[] => JSON.parse(res.headers['x-parc-writes']) as Write[];

describe('starter cell — caller-write emission', () => {
  it('emits an own-slice note write for a signed-in visitor', async () => {
    const res = await post({ text: '  hello  ' }, 'alice');
    expect(res.statusCode).toBe(202);
    const writes = writesOf(res);
    expect(writes).toHaveLength(1);
    expect(writes[0].key).toMatch(/^note:/);
    expect(writes[0].type).toBe('note');
    expect(writes[0].value).toEqual({ text: 'hello' }); // trimmed
    expect(writes[0].owner).toBeUndefined(); // own slice
  });

  it('emits a cross-slice write under shared/ when a different owner is named', async () => {
    const res = await post({ text: 'for bob', owner: 'bob' }, 'alice');
    expect(res.statusCode).toBe(202);
    const writes = writesOf(res);
    expect(writes[0].key).toMatch(/^shared\//);
    expect(writes[0].owner).toBe('bob');
  });

  it('treats owner === caller as an own-slice write (note:, no owner)', async () => {
    const res = await post({ text: 'mine', owner: 'alice' }, 'alice');
    const writes = writesOf(res);
    expect(writes[0].key).toMatch(/^note:/);
    expect(writes[0].owner).toBeUndefined();
  });

  it('refuses an anonymous note (no x-parc-writes header)', async () => {
    const res = await post({ text: 'hi' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['x-parc-writes']).toBeUndefined();
  });

  it('rejects an empty note without emitting a write', async () => {
    const res = await post({ text: '   ' }, 'alice');
    expect(res.statusCode).toBe(400);
    expect(res.headers['x-parc-writes']).toBeUndefined();
  });
});
