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
import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { ServiceRouter, PUBLIC_NS_PATTERN } from '../platform/infra/service-router';
import { HttpServiceCell } from '../platform/infra/http-service-cell';
import { buildCellTemplate } from '../services/cells/cell-template';
import { trimWays, tileKey } from '../cells/drive/index';

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
    publicNamespaceBucket: withNamespace ? bucket : undefined,
  });
  return Template.fromStack(stack);
}

/** The distribution's cache behaviours, in the order CloudFront will read them. */
function behaviours(t: Template): Array<Record<string, unknown>> {
  const dists = t.findResources('AWS::CloudFront::Distribution');
  const cfg = Object.values(dists)[0].Properties.DistributionConfig as Record<string, unknown>;
  return (cfg.CacheBehaviors ?? []) as Array<Record<string, unknown>>;
}

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

  it('is opt-in: without a bucket the distribution is exactly as it was', () => {
    const list = behaviours(synth(false));
    expect(list.find((b) => b.PathPattern === PUBLIC_NS_PATTERN)).toBeUndefined();
    expect(list.find((b) => b.PathPattern === '/@*')).toBeDefined();
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
      { type: 'node', id: 2, geometry: [{ lat: 1, lon: 2 }] },      // not a way
      { type: 'way', id: 3, tags: { building: 'yes' } },            // no geometry
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ id: 1, tags: { highway: 'residential' }, geometry: [[51.507412, -0.127812]] });
  });

  it('an untagged way still round-trips (tags default to {}, never undefined)', () => {
    const out = trimWays([{ type: 'way', id: 7, geometry: [{ lat: 0, lon: 0 }] }]);
    expect(out[0].tags).toEqual({});
  });
});
