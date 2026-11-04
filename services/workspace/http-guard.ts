/**
 * The workspace's public HTTP command route (`POST /workspace/<command>`, routed
 * by CloudFront) runs a command under the caller's own token with no gateway in
 * front of it. This guard applies the gateway's rule there too: only the
 * commands the workspace advertises as tools are served, each behind the scope
 * `describeTools` declares for it. Everything else is reached through the
 * gateway (`/mcp`) or by peers, never by a bare POST.
 */
import { ServiceAuthError, hasScope, holdsUnder, type Identity } from '../../platform/runtime/auth';
import { UnknownCommandError } from '../../platform/runtime/define-service';
import { TOOL_DESCRIPTORS, toolScope } from './descriptors';

const BY_NAME = new Map(TOOL_DESCRIPTORS.map((t) => [t.name, t]));

export function workspaceHttpGuard(command: string, identity: Identity): void {
  const tool = BY_NAME.get(command);
  if (!tool) throw new UnknownCommandError(command);
  const scope = toolScope(tool);
  if (hasScope(identity, scope)) return;
  if (tool.scopeFamily && holdsUnder(identity, tool.scopeFamily)) return;
  throw new ServiceAuthError(
    `scope_denied: workspace.${command} requires "${scope}"; this token holds [${identity.scopes.join(' ') || 'none'}].`,
  );
}
