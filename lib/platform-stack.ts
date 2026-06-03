import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import { HttpServiceCell, ServiceRouter, PlatformEventBus } from '../platform/infra';

export interface PlatformStackProps extends cdk.StackProps {
  /**
   * Deployment environment, e.g. "production" or "staging". Namespaces the
   * resources that must be account/region-unique (currently the event bus) so
   * multiple environments can coexist. Defaults to "production".
   */
  envName?: string;
}

/**
 * Serverless multi-project platform stack.
 *
 * Demonstrates the architecture: a single CloudFront router in front of many
 * independent service cells, a shared event bus, and direct (least-privilege)
 * service-to-service invocation. Each new service is a sub-50-line
 * `HttpServiceCell` instantiation.
 */
export class PlatformStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: PlatformStackProps) {
    super(scope, id, props);

    const envName = props?.envName ?? 'production';
    cdk.Tags.of(this).add('platform:env', envName);

    // When running from compiled JS in dist/lib, ascend two dirs to repo root
    // (matches the convention in inline-lambda-stack.ts) to locate service code.
    const serviceEntry = (name: string): string =>
      path.join(__dirname, '..', '..', 'services', name, 'service.ts');

    // The bus name must be unique per account/region, so suffix non-prod envs.
    const busName = envName === 'production' ? 'platform-bus' : `platform-bus-${envName}`;
    const eventBus = new PlatformEventBus(this, 'EventBus', { busName });

    // Auth primitive: WebAuthn passkeys + OAuth 2.1 + scoped tokens (ported from
    // c15r/mcp-auth). Owns the auth_* data; peers consume it via tokens, never
    // by reading its table. PUBLIC_BASE_URL keeps OAuth issuer/rpId stable
    // across the CloudFront/OAC hop (set to the platform's public domain).
    const auth = new HttpServiceCell(this, 'AuthService', {
      name: 'auth',
      entry: serviceEntry('auth'),
      routes: ['/auth/*', '/oauth/*', '/webauthn/*', '/.well-known/*'],
      persistence: { dynamo: true, dynamoTtl: true },
      commands: ['validateToken', 'mintToken', 'listTokens', 'revokeToken'],
      emits: ['auth.user.registered', 'auth.token.minted', 'auth.token.revoked'],
      eventBus,
      environment: {
        AUTH_SERVER_NAME: 'workspace',
        // PUBLIC_BASE_URL / WEBAUTHN_RP_ID should be set to the deployed domain.
        ...(process.env.PLATFORM_PUBLIC_BASE_URL
          ? { PUBLIC_BASE_URL: process.env.PLATFORM_PUBLIC_BASE_URL }
          : {}),
      },
    });

    const render = new HttpServiceCell(this, 'RenderService', {
      name: 'render',
      entry: serviceEntry('render'),
      routes: ['/render/*'],
      commands: ['generatePreview'],
      eventBus,
    });

    const documents = new HttpServiceCell(this, 'DocumentService', {
      name: 'documents',
      entry: serviceEntry('documents'),
      routes: ['/documents/*'],
      persistence: { dynamo: true, turso: true },
      commands: ['createDocument', 'getDocument'],
      emits: ['document.created'],
      eventBus,
    });

    // Least-privilege: documents may invoke render, but not vice versa.
    documents.allow(render);
    // Any cell may ask the auth service to validate a token (the in-cell
    // alternative to edge validation).
    documents.allow(auth);

    // Single public entrypoint, behaviours generated from manifests.
    new ServiceRouter(this, 'Router', {
      cells: [auth, documents, render],
      defaultCell: documents,
    });
  }
}
