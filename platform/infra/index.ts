/**
 * Infrastructure layer public API.
 *
 * Composable CDK constructs that turn a service definition into a deployable
 * cell plus shared routing/eventing. The runtime counterpart lives in
 * `platform/runtime`.
 */
export { HttpServiceCell } from './http-service-cell';
export type { HttpServiceCellProps, CellPersistence } from './http-service-cell';
export { ServiceRouter } from './service-router';
export type { ServiceRouterProps } from './service-router';
export { PlatformEventBus } from './event-bus';
export type { PlatformEventBusProps } from './event-bus';
export { DynamicCellControlPlane } from './dynamic-cell-control-plane';
export type { DynamicCellControlPlaneProps } from './dynamic-cell-control-plane';
export { TableFactory } from './table-factory';
export type { PlatformTableProps } from './table-factory';
export type { ServiceManifest, ServiceRegistry } from '../manifest';
