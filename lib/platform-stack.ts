import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import { HttpServiceCell, ServiceRouter, PlatformEventBus } from '../platform/infra';

/**
 * Serverless multi-project platform stack.
 *
 * Demonstrates the architecture: a single CloudFront router in front of many
 * independent service cells, a shared event bus, and direct (least-privilege)
 * service-to-service invocation. Each new service is a sub-50-line
 * `HttpServiceCell` instantiation.
 */
export class PlatformStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // When running from compiled JS in dist/lib, ascend two dirs to repo root
    // (matches the convention in inline-lambda-stack.ts) to locate service code.
    const serviceEntry = (name: string): string =>
      path.join(__dirname, '..', '..', 'services', name, 'service.ts');

    const eventBus = new PlatformEventBus(this, 'EventBus', { busName: 'platform-bus' });

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

    // Single public entrypoint, behaviours generated from manifests.
    new ServiceRouter(this, 'Router', {
      cells: [documents, render],
      defaultCell: documents,
    });
  }
}
