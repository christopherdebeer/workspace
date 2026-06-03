import { Construct } from 'constructs';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';

/**
 * Shared EventBridge bus (communication Mode 2).
 *
 * A single platform bus carries domain events between cells. Services emit
 * with their own name as the event `Source`; subscribers attach rules in
 * their own stacks. The bus is intentionally the only piece of cross-service
 * infrastructure besides the router.
 */
export interface PlatformEventBusProps {
  busName?: string;
}

export class PlatformEventBus extends Construct {
  readonly bus: events.EventBus;

  constructor(scope: Construct, id: string, props: PlatformEventBusProps = {}) {
    super(scope, id);
    this.bus = new events.EventBus(this, 'Bus', {
      eventBusName: props.busName,
    });
  }

  /** Grant a principal permission to publish events to this bus. */
  grantPutEvents(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: ['events:PutEvents'],
      resourceArns: [this.bus.eventBusArn],
    });
  }
}
