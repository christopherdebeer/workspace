/**
 * The public `POST /<service>/<command>` route runs a command under the caller's
 * own token with no gateway in front of it. `httpCommandGuard` puts the
 * gateway's rule there; the workspace's guard serves only its advertised tools,
 * each behind the scope its descriptor declares.
 */
import { defineService, UnknownCommandError } from '../platform/runtime/define-service';
import { ServiceAuthError, type Identity } from '../platform/runtime/auth';
import type { FunctionUrlEvent, FunctionUrlResponse } from '../platform/runtime';
import { workspaceHttpGuard } from '../services/workspace/http-guard';
import { TOOL_DESCRIPTORS, toolScope } from '../services/workspace/descriptors';

function httpEvent(method: string, path: string, body?: unknown): FunctionUrlEvent {
  return {
    rawPath: path,
    requestContext: { http: { method, path } },
    headers: { host: 'svc.example.com' },
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
  };
}

describe('defineService httpCommandGuard', () => {
  beforeEach(() => {
    process.env.SERVICE_NAME = 'thing';
  });
  const ran: string[] = [];
  const handler = defineService({
    name: 'thing',
    commands: {
      open: () => (ran.push('open'), { ok: 1 }),
      locked: () => (ran.push('locked'), { ok: 2 }),
      hidden: () => (ran.push('hidden'), { ok: 3 }),
    },
    httpCommandGuard: (command) => {
      if (command === 'locked') throw new ServiceAuthError('scope_denied: locked');
      if (command === 'hidden') throw new UnknownCommandError(command);
    },
  });

  it('runs what the guard allows, refuses what it refuses, and hides what it hides', async () => {
    ran.length = 0;
    const ok = (await handler(httpEvent('POST', '/thing/open', {}))) as FunctionUrlResponse;
    expect(ok.statusCode).toBe(200);
    const denied = (await handler(httpEvent('POST', '/thing/locked', {}))) as FunctionUrlResponse;
    expect(denied.statusCode).toBe(401);
    expect(JSON.parse(denied.body).error).toMatch(/scope_denied/);
    const hidden = (await handler(httpEvent('POST', '/thing/hidden', {}))) as FunctionUrlResponse;
    expect(hidden.statusCode).toBe(404);
    expect(ran).toEqual(['open']); // a refused command never runs
  });

  it('does not stand between peers: a direct invoke is not guarded', async () => {
    ran.length = 0;
    const res = (await handler({ __command: 'locked', payload: {}, user: 'alice' } as never)) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(ran).toEqual(['locked']);
  });
});

describe('workspace HTTP guard', () => {
  const as = (...scopes: string[]): Identity => ({ user: 'alice', scopes });

  it('serves only advertised tools', () => {
    expect(() => workspaceHttpGuard('registerSubscription', as('platform:*'))).toThrow(UnknownCommandError);
    expect(() => workspaceHttpGuard('invoke', as('platform:*'))).toThrow(UnknownCommandError);
    expect(() => workspaceHttpGuard('query', as('read:workspace'))).not.toThrow();
  });

  it('a read-only token reads but cannot act, share or administer', () => {
    const reader = as('workspace:read');
    expect(() => workspaceHttpGuard('recall', reader)).not.toThrow();
    for (const command of ['remember', 'share', 'supersede', 'link', 'declare', 'requestGrant', 'approveGrant']) {
      expect(() => workspaceHttpGuard(command, reader)).toThrow(/scope_denied/);
    }
  });

  it('applies each descriptor’s own scope: verb by default, explicit where declared, families where allowed', () => {
    expect(() => workspaceHttpGuard('share', as('workspace:write'))).not.toThrow();
    const admin = TOOL_DESCRIPTORS.find((t) => t.scope === 'workspace:admin')!;
    expect(() => workspaceHttpGuard(admin.name, as('workspace:write'))).toThrow(/workspace:admin/);
    expect(() => workspaceHttpGuard(admin.name, as('workspace:admin'))).not.toThrow();
    // A type-scoped token may remember (the handler then checks the type), but not share.
    expect(() => workspaceHttpGuard('remember', as('write:type:note'))).not.toThrow();
    expect(() => workspaceHttpGuard('share', as('write:type:note'))).toThrow(/scope_denied/);
  });

  it('is the same rule the gateway is given', () => {
    for (const t of TOOL_DESCRIPTORS) {
      expect(() => workspaceHttpGuard(t.name, as(toolScope(t)))).not.toThrow();
    }
  });
});
