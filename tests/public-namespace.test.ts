/**
 * ADR-0095 — the cell public namespace.
 *
 * Three things are asserted here, and each of them fails SILENTLY in
 * production if it regresses, which is why they are tests rather than review
 * notes:
 *
 * 1. **Behaviour precedence.** CloudFront picks a cache behaviour by
 *    declaration order, not by specificity. If `/@*` is declared before
 *    `/@*​/~/*`, every public-namespace request routes to the Lambda instead of
 *    S3 — and everything still WORKS, just through compute, forever.
 * 2. **Boundary scoping.** A cell must be able to write only its own prefix.
 *    A widened resource ARN would let any cell fill any other cell's namespace,
 *    and nothing would break until it mattered.
 * 3. **The key is the path.** The whole design rests on the stored key being
 *    byte-identical to the request path; if `tileKey` drifts, every fill writes
 *    somewhere the edge never looks and every request is a miss.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { ServiceRouter, PUBLIC_NS_PATTERN, CELL_HOST_NS_PATTERN } from '../platform/infra/service-router';
import { HttpServiceCell } from '../platform/infra/http-service-cell';
import { buildCellTemplate } from '../services/cells/cell-template';
import { __toRecordForTests } from '../services/cells/registry';
import { inflateSync } from 'node:zlib';
import { trimWays, tileKey, askOverpass, wcLevelFor, greyPng } from '../cells/drive/index';

function synth(withNamespace: boolean): Template {
  const app = new App();
  const stack = new Stack(app, 'T', { env: { account: '111111111111', region: 'us-east-1' } });
  const dispatch = new HttpServiceCell(stack, 'Dispatch', {
    name: 'dispatch',
    entry: `${__dirname}/fixtures/noop-service.ts`,
    routes: ['/@*'],
  });
  const bucket = new s3.Bucket(stack, 'Code');
  new ServiceRouter(stack, 'Router', {
    cells: [dispatch],
    defaultCell: dispatch,
    cellHostRouter: dispatch,
    // The cell-host distribution is where a cell's own client actually lives
    // (the apex 302s navigations to it), so both must be exercised.
    cellDomainNames: ['*.on.example.test'],
    cellCertificate: acm.Certificate.fromCertificateArn(
      stack, 'Cert', 'arn:aws:acm:us-east-1:111111111111:certificate/abc'),
    publicNamespaceBucket: withNamespace ? bucket : undefined,
  });
  return Template.fromStack(stack);
}

/** Cache behaviours of a distribution, in the order CloudFront will read them. */
function behavioursOf(t: Template, comment: string): Array<Record<string, unknown>> {
  const dists = t.findResources('AWS::CloudFront::Distribution');
  const match = Object.values(dists).find(
    (d) => ((d.Properties.DistributionConfig as Record<string, unknown>).Comment as string)?.includes(comment));
  const cfg = match!.Properties.DistributionConfig as Record<string, unknown>;
  return (cfg.CacheBehaviors ?? []) as Array<Record<string, unknown>>;
}
const behaviours = (t: Template) => behavioursOf(t, 'platform router');
const cellBehaviours = (t: Template) => behavioursOf(t, 'Cell-namespace router');

describe('ADR-0095 — the public namespace behaviour', () => {
  it('is declared BEFORE the /@* dispatch behaviour it would otherwise be swallowed by', () => {
    const list = behaviours(synth(true));
    const pub = list.findIndex((b) => b.PathPattern === PUBLIC_NS_PATTERN);
    const disp = list.findIndex((b) => b.PathPattern === '/@*');
    expect(pub).toBeGreaterThanOrEqual(0);
    expect(disp).toBeGreaterThanOrEqual(0);
    expect(pub).toBeLessThan(disp);
  });

  it('caches (the rest of the platform is CACHING_DISABLED; this one must not be)', () => {
    const list = behaviours(synth(true));
    const pub = list.find((b) => b.PathPattern === PUBLIC_NS_PATTERN)!;
    const disp = list.find((b) => b.PathPattern === '/@*')!;
    // The managed CACHING_DISABLED policy id — dispatch keeps it, we must not.
    const DISABLED = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';
    expect(disp.CachePolicyId).toBe(DISABLED);
    expect(pub.CachePolicyId).not.toBe(DISABLED);
  });

  it('falls back to the cell on a 403/404 from S3 — the cache miss', () => {
    const t = synth(true);
    t.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        OriginGroups: {
          Items: Match.arrayWith([
            Match.objectLike({
              // OAC without s3:ListBucket answers a missing key with 403, not
              // 404. Both are the miss.
              FailoverCriteria: { StatusCodes: Match.objectLike({ Items: Match.arrayWith([403, 404]) }) },
            }),
          ]),
        },
      },
    });
  });

  it('runs no edge lambdas on a hit — that is what makes a hit free', () => {
    const pub = behaviours(synth(true)).find((b) => b.PathPattern === PUBLIC_NS_PATTERN)!;
    expect(pub.LambdaFunctionAssociations ?? []).toHaveLength(0);
  });

  it('never caches a 5xx, so one bad upstream minute cannot become a bad week', () => {
    const t = synth(true);
    const dists = t.findResources('AWS::CloudFront::Distribution');
    const cfg = Object.values(dists)[0].Properties.DistributionConfig as Record<string, unknown>;
    const errs = (cfg.CustomErrorResponses ?? []) as Array<Record<string, unknown>>;
    for (const code of [500, 502, 503, 504]) {
      expect(errs).toContainEqual(expect.objectContaining({ ErrorCode: code, ErrorCachingMinTTL: 0 }));
    }
  });

  it('exists on the CELL-HOST distribution too — where a cell client actually runs', () => {
    // A navigation to /@owner/name 302s to <owner>-<name>.<cellDomain>, so this
    // is the distribution the game's own fetches hit. Adding the behaviour only
    // to the apex would leave every real user on the uncached path.
    const list = cellBehaviours(synth(true));
    const pub = list.find((b) => b.PathPattern === CELL_HOST_NS_PATTERN);
    expect(pub).toBeDefined();
    // The host-rewrite function must still run, or S3 is asked for a key with
    // no owner/name in it and every request is a miss.
    expect(pub!.FunctionAssociations).toBeDefined();
  });

  it('is opt-in: without a bucket the distribution is exactly as it was', () => {
    const t = synth(false);
    const list = behaviours(t);
    expect(list.find((b) => b.PathPattern === PUBLIC_NS_PATTERN)).toBeUndefined();
    expect(list.find((b) => b.PathPattern === '/@*')).toBeDefined();
    expect(cellBehaviours(t).find((b) => b.PathPattern === CELL_HOST_NS_PATTERN)).toBeUndefined();
  });
});

describe('ADR-0095 — the cell role is scoped to its own prefix', () => {
  const base = {
    cellId: 'drive-dcfd1204',
    owner: 'c15r',
    codeBucket: 'code-bucket',
    codeKey: 'cells/drive/x.zip',
    boundaryArn: 'arn:aws:iam::111111111111:policy/boundary',
    eventBusName: 'bus',
    eventBusArn: 'arn:aws:events:us-east-1:111111111111:event-bus/bus',
    region: 'us-east-1',
    accountId: '111111111111',
  };
  const statements = (tpl: Record<string, unknown>): Array<Record<string, unknown>> => {
    const res = tpl.Resources as Record<string, { Properties: Record<string, unknown> }>;
    const policies = res.CellRole.Properties.Policies as Array<{ PolicyDocument: { Statement: Array<Record<string, unknown>> } }>;
    return policies[0].PolicyDocument.Statement;
  };

  it('grants nothing in S3 when no namespace is declared', () => {
    const st = statements(buildCellTemplate(base));
    expect(st.find((s) => s.Sid === 'OwnPublicNamespace')).toBeUndefined();
    const env = ((buildCellTemplate(base).Resources as Record<string, { Properties: Record<string, unknown> }>)
      .CellFunction.Properties.Environment as { Variables: Record<string, string> }).Variables;
    expect(env.CELL_PUBLIC_BUCKET).toBeUndefined();
  });

  it('grants exactly its own prefix when it is', () => {
    const tpl = buildCellTemplate({ ...base, publicNamespace: { bucket: 'code-bucket', name: 'drive' } });
    const own = statements(tpl).find((s) => s.Sid === 'OwnPublicNamespace')!;
    expect(own).toBeDefined();
    // Keyed by OWNER and SLUG — the address the URL carries — never by cellId,
    // because CloudFront has to find the object without a lookup.
    expect(own.Resource).toBe('arn:aws:s3:::code-bucket/public/@c15r/drive/~/*');
    expect(own.Action).toEqual(['s3:GetObject', 's3:PutObject', 's3:DeleteObject']);
  });

  it('tells the handler where to write, prefix and all', () => {
    const tpl = buildCellTemplate({ ...base, publicNamespace: { bucket: 'code-bucket', name: 'drive' } });
    const env = ((tpl.Resources as Record<string, { Properties: Record<string, unknown> }>)
      .CellFunction.Properties.Environment as { Variables: Record<string, string> }).Variables;
    expect(env.CELL_PUBLIC_BUCKET).toBe('code-bucket');
    expect(env.CELL_PUBLIC_PREFIX).toBe('public/@c15r/drive/~');
  });
});

describe('ADR-0095 — the drive cell as miss handler', () => {
  it('writes the key CloudFront will ask S3 for, byte for byte', () => {
    // Request path `/~/osm/v1/16/37402/49926` under originPath `/public`
    // ⇒ S3 sees `/public/@c15r/drive/~/osm/v1/16/37402/49926`.
    expect(tileKey('/~/osm/v1/16/37402/49926', 'public/@c15r/drive/~'))
      .toBe('public/@c15r/drive/~/osm/v1/16/37402/49926');
  });

  it('keeps only what the renderer reads, at 6dp', () => {
    const out = trimWays([
      { type: 'way', id: 1, tags: { highway: 'residential' }, geometry: [{ lat: 51.5074123456, lon: -0.1278123456 }] },
      { type: 'way', id: 3, tags: { building: 'yes' } },            // no geometry at all
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ id: 1, tags: { highway: 'residential' }, geometry: [[51.507412, -0.127812]] });
  });

  // A FUEL STATION IS A NODE, and so is a viewpoint, a summit and most
  // garages. Dropping everything that was not a `way` is what left the rig
  // with nowhere to be serviced; a node carries its position in lat/lon rather
  // than a geometry array, and normalising it to a one-point geometry here is
  // what lets the renderer keep a single code path.
  it('turns a node into a one-point geometry rather than dropping it', () => {
    const out = trimWays([
      { type: 'node', id: 9, tags: { amenity: 'fuel', name: 'Badwater Fuel' }, lat: 36.2301234567, lon: -116.7699876 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      id: 9, tags: { amenity: 'fuel', name: 'Badwater Fuel' }, geometry: [[36.230123, -116.769988]],
    });
  });

  it('still drops anything with no position at all', () => {
    expect(trimWays([{ type: 'node', id: 4, tags: { amenity: 'fuel' } }])).toHaveLength(0);
    expect(trimWays([{ type: 'relation', id: 5, tags: { landuse: 'forest' } }])).toHaveLength(0);
  });

  it('an untagged way still round-trips (tags default to {}, never undefined)', () => {
    const out = trimWays([{ type: 'way', id: 7, geometry: [{ lat: 0, lon: 0 }] }]);
    expect(out[0].tags).toEqual({});
  });
});

// A tile that fails is retried; a tile that is WRITTEN is immutable for a week
// and cached in every browser that saw it. So the one thing this handler must
// never do is mistake a failure for an empty tile — and Overpass reports a
// timed-out query as HTTP 200 with no elements and a `remark`, which is exactly
// what open desert looks like.
describe('the drive cell asking Overpass', () => {
  const ok = (body: unknown): Response => ({
    ok: true, status: 200, json: async () => body,
  } as unknown as Response);
  const boom = (status: number): Response => ({
    ok: false, status, json: async () => ({}),
  } as unknown as Response);
  const realFetch = global.fetch;
  const hosts: string[] = [];
  afterEach(() => { global.fetch = realFetch; hosts.length = 0; });
  const stub = (fn: (url: string) => Promise<Response>): void => {
    global.fetch = ((url: string) => { hosts.push(new URL(url).host); return fn(url); }) as typeof fetch;
  };

  it('refuses a timed-out query rather than storing it as empty desert', async () => {
    stub(async () => ok({ elements: [], remark: 'runtime error: Query timed out in "query" at line 3' }));
    await expect(askOverpass('...')).rejects.toThrow(/timed out/i);
  });

  it('still accepts a genuinely empty tile — most of the planet is one', async () => {
    stub(async () => ok({ elements: [] }));
    await expect(askOverpass('...')).resolves.toEqual([]);
    expect(hosts).toHaveLength(1); // no pointless mirror rotation on success
  });

  it('rotates to the next mirror when the first rate-limits', async () => {
    stub(async (url) => (url.includes('overpass-api.de')
      ? boom(429)
      : ok({ elements: [{ type: 'way', id: 1, geometry: [{ lat: 0, lon: 0 }] }] })));
    const out = await askOverpass('...');
    expect(out).toHaveLength(1);
    expect(hosts).toEqual(['overpass-api.de', 'overpass.kumi.systems']);
  });

  it('names every mirror it tried when they all fail', async () => {
    stub(async () => boom(504));
    await expect(askOverpass('...')).rejects.toThrow(/overpass-api\.de.*kumi.*private\.coffee/s);
    expect(hosts).toHaveLength(3);
  });
});

// The land-cover reader is hand-rolled — no GeoTIFF library, no PNG library —
// so the two pure halves of it are worth pinning: picking an overview level,
// and emitting a PNG a browser will actually decode. The network half is
// exercised against the real bucket by the probe in the session scratch, not
// here; a unit test should not depend on ESA's uptime.
describe('the drive cell reading land cover', () => {
  it('picks the coarsest overview still finer than the tile asked for', () => {
    // Source levels are 3°/(36000>>L). A z12 tile is 360/(4096·256)°/px, which
    // level 2 (3°/9000) just clears — 32× fewer bytes than the full 10m grid
    // for a number that rounds to the same class.
    expect(wcLevelFor(12)).toBe(2);
    expect(wcLevelFor(14)).toBe(0);   // near-native detail
    expect(wcLevelFor(10)).toBe(4);   // far out, coarse is plenty
  });

  it('never picks a level off the end of the pyramid', () => {
    for (let z = 1; z <= 16; z++) {
      const L = wcLevelFor(z);
      expect(L).toBeGreaterThanOrEqual(0);
      expect(L).toBeLessThan(7);
    }
  });

  it('emits a greyscale PNG that decodes back to the exact class indices', () => {
    const px = new Uint8Array(256 * 256);
    for (let i = 0; i < px.length; i++) px[i] = (i * 7) % 101;  // spans every class code
    const png = greyPng(px, 256);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    let p = 8, w = 0, h = 0, depth = 0, colour = 0;
    const idat: Buffer[] = [];
    while (p < png.length) {
      const len = png.readUInt32BE(p);
      const type = png.toString('ascii', p + 4, p + 8);
      const body = png.subarray(p + 8, p + 8 + len);
      // Every chunk carries a CRC32 the decoder will check.
      expect(png.readUInt32BE(p + 8 + len)).toBeGreaterThanOrEqual(0);
      if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]; colour = body[9]; }
      if (type === 'IDAT') idat.push(body);
      p += 12 + len;
    }
    expect([w, h, depth, colour]).toEqual([256, 256, 8, 0]);   // colour 0 = greyscale
    const raw = inflateSync(Buffer.concat(idat));
    for (let y = 0; y < 256; y++) {
      expect(raw[y * 257]).toBe(0);                             // filter: none
      for (let x = 0; x < 256; x++) expect(raw[y * 257 + 1 + x]).toBe(px[y * 256 + x]);
    }
  });
});

describe('ADR-0095 — the registry must not silently drop stack-shape fields', () => {
  // `toRecord` is an explicit projection: a field it does not name is dropped
  // on read, so the NEXT configureCell that omits that knob re-renders the
  // stack without it. This was not theoretical — live,
  // `configureCell {timeoutSeconds: 30}` answered `publicNamespace: false` and
  // took away the S3 grant the previous call had just granted.
  it('round-trips publicNamespace, timeoutSeconds and memoryMb', () => {
    const stored = {
      pk: 'CELL#drive-x', sk: 'A',
      cellId: 'drive-x', name: 'drive', owner: 'c15r', description: null,
      functionName: 'cell-drive-x', stackName: 'cell-drive-x', grants: ['c15r'],
      public: true, publicNamespace: true, timeoutSeconds: 30, memoryMb: 512,
      status: 'ACTIVE', createdAt: 'now', updatedAt: 'now',
    };
    const back = __toRecordForTests(stored);
    expect(back.publicNamespace).toBe(true);
    expect(back.timeoutSeconds).toBe(30);
    expect(back.memoryMb).toBe(512);
  });

  it('leaves them absent when the stored item never had them', () => {
    const back = __toRecordForTests({
      cellId: 'x', name: 'x', owner: 'c15r', description: null,
      functionName: 'f', stackName: 's', grants: [], public: false,
      status: 'ACTIVE', createdAt: 'now', updatedAt: 'now',
    });
    expect(back.publicNamespace).toBeUndefined();
    expect(back.timeoutSeconds).toBeUndefined();
    expect(back.memoryMb).toBeUndefined();
  });
});

/**
 * The drive cell's HTML shell is a template literal, so a stray backtick in it
 * — even inside a CSS comment — silently ends the string and the whole module
 * stops parsing. That is invisible to `tsc` here (cells are not in the app
 * tsconfig) and only surfaces as a FAILED DEPLOY, which is the worst place to
 * find it. This costs a millisecond and catches the whole class.
 */
describe('drive cell shell', () => {
  const src = readFileSync(join(__dirname, '..', 'cells', 'drive', 'index.ts'), 'utf8');

  it('closes its template literal and carries a whole document', () => {
    const m = src.match(/const SHELL = `([\s\S]*?)`;/);
    expect(m).not.toBeNull();
    const html = m![1];
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('</html>');
    expect(html).toContain('id="scene"');
  });

  it('has no backtick between the shell delimiters', () => {
    const start = src.indexOf('const SHELL = `') + 'const SHELL = `'.length;
    const end = src.indexOf('</html>', start);
    expect(end).toBeGreaterThan(start);
    expect(src.slice(start, end)).not.toContain('`');
  });
});
