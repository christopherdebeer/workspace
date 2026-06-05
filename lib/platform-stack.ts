import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { HttpServiceCell, ServiceRouter, PlatformEventBus } from '../platform/infra';

export interface PlatformStackProps extends cdk.StackProps {
  /**
   * Deployment environment, e.g. "production" or "staging". Namespaces the
   * resources that must be account/region-unique (currently the event bus) so
   * multiple environments can coexist. Defaults to "production".
   */
  envName?: string;
  /**
   * Public base URL the platform is served from, e.g. "https://app.parc.land".
   * Sets the auth cell's OAuth issuer + WebAuthn RP id so they stay correct
   * across the CloudFront/OAC hop. Defaults to the CloudFront distribution's
   * own domain when omitted.
   */
  publicBaseUrl?: string;
  /** CloudFront alternate domain names (CNAMEs), e.g. ["app.parc.land"]. */
  domainNames?: string[];
  /** ARN of an ACM certificate in us-east-1 covering `domainNames`. */
  certificateArn?: string;
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

    // When running from compiled JS in dist/lib, ascend two dirs to the repo
    // root to locate the (TypeScript) service entry code for bundling.
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
      environment: { AUTH_SERVER_NAME: 'workspace' },
      // PUBLIC_BASE_URL / WEBAUTHN_RP_ID are set below, once the router (and thus
      // the public domain) exists.
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

    // Protected resource server: owns `/mcp/*`, the resource the auth cell
    // advertises in its protected-resource metadata. Exercises auth end-to-end
    // (validated bearer -> identity, 401 + WWW-Authenticate challenge).
    const resource = new HttpServiceCell(this, 'ResourceService', {
      name: 'resource',
      entry: serviceEntry('resource'),
      routes: ['/mcp/*'],
      eventBus,
    });

    // Least-privilege: documents may invoke render, but not vice versa.
    documents.allow(render);
    // Any cell that protects routes asks the auth service to validate the
    // bearer token (the in-cell alternative to edge validation).
    documents.allow(auth);
    resource.allow(auth);

    // Single public entrypoint, behaviours generated from manifests. Optionally
    // fronted by a custom domain (CloudFront alias + ACM cert in us-east-1).
    let certificate: acm.ICertificate | undefined;
    if (props?.certificateArn) {
      certificate = acm.Certificate.fromCertificateArn(this, 'RouterCert', props.certificateArn);
    } else if (props?.domainNames && props.domainNames.length > 0) {
      // CDK-managed, DNS-validated cert. With external DNS (Namecheap) you must
      // add the ACM validation CNAME(s) manually; the deploy waits until the
      // cert is ISSUED, so roll a domain out via workflow_dispatch/local (not an
      // unattended merge) and add the CNAME promptly.
      certificate = new acm.Certificate(this, 'RouterCert', {
        domainName: props.domainNames[0],
        subjectAlternativeNames: props.domainNames.slice(1),
        validation: acm.CertificateValidation.fromDns(),
      });
    }

    const router = new ServiceRouter(this, 'Router', {
      cells: [auth, documents, render, resource],
      defaultCell: documents,
      domainNames: props?.domainNames,
      certificate,
    });

    // Make the auth cell self-consistent with the public origin: prefer an
    // explicit public base URL (custom domain), else the distribution's own
    // domain. Without this the cell derives URLs from the (OAC-rewritten) Host
    // and advertises the IAM-protected Function URL as the OAuth issuer.
    let publicBaseUrl: string;
    let webauthnRpId: string;
    if (props?.publicBaseUrl) {
      publicBaseUrl = props.publicBaseUrl;
      webauthnRpId = new URL(props.publicBaseUrl).hostname;
    } else {
      const domain = router.distribution.distributionDomainName;
      publicBaseUrl = `https://${domain}`;
      webauthnRpId = domain;
    }
    auth.fn.addEnvironment('PUBLIC_BASE_URL', publicBaseUrl);
    auth.fn.addEnvironment('WEBAUTHN_RP_ID', webauthnRpId);
    // The resource cell derives its metadata/challenge URLs from req.url, which
    // honours PUBLIC_BASE_URL across the OAC hop (where the viewer Host is lost).
    resource.fn.addEnvironment('PUBLIC_BASE_URL', publicBaseUrl);
  }
}
