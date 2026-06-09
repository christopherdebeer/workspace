import { Construct } from 'constructs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';

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

  /**
   * Route events on this bus to a cell's Lambda (communication Mode 2,
   * subscriber side). `sourcePrefix` narrows the rule to trusted emitters —
   * e.g. `cell-` for dynamic cells, whose role policies pin `events:source`
   * to their own id, making the event's source IAM-attested.
   */
  routeTo(id: string, fn: lambda.IFunction, detailTypes: string[], sourcePrefix?: string): events.Rule {
    return new events.Rule(this, id, {
      eventBus: this.bus,
      eventPattern: {
        detailType: detailTypes,
        ...(sourcePrefix ? { source: events.Match.prefix(sourcePrefix) } : {}),
      },
      targets: [new targets.LambdaFunction(fn)],
    });
  }
}
