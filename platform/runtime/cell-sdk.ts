/**
 * `@parc/runtime/cell` — the platform SDK for FORGE-DEPLOYED CELLS (ADR-0042
 * Inc 1, delivery option (a)). A curated, cell-safe entry into the substrate's
 * read/present/reference pipeline, so a cell's own Lambda (SSR, an organ, a
 * scheduled job) runs the SAME core the gateway does instead of hand-rolling raw
 * DynamoDB queries + re-deriving edges/salience/membership by hand.
 *
 * WHY a separate entry (not the `platform/runtime` barrel): the barrel re-exports
 * the **v2** DynamoDB store and the vector machinery, which a cell must not bundle
 * (v2 `aws-sdk` isn't ambient on the Node 20 cell runtime; vectors are heavy).
 * This entry re-exports ONLY pure pipeline modules + the **v3** store (which
 * resolves `@aws-sdk/*` from the runtime), so a cell bundle stays lean and
 * Node-20-correct. The forge bundler (`services/cells/transpile.ts`) resolves
 * this module from disk as a server-bundled package.
 *
 * Typical cell SSR usage:
 *   import { createCellReader, createDynamoStateStore } from '@parc/runtime/cell';
 *   const read = createCellReader(createDynamoStateStore(TABLE), OWNER, { typeRules });
 *   const doc = await read.peek('doc:welcome');
 *   const { members } = await read.members('doc:welcome');
 */

// The reader — the one entry a cell SSR usually needs.
export { createCellReader } from './cell-reader';
export type { CellReader, CellReaderDefaults } from './cell-reader';

// The store: the v3 client, exported under the plain name a cell writes against
// (the v2 store is deliberately unreachable from here).
export { createDynamoStateStoreV3 as createDynamoStateStore } from './dynamo-state-store-v3';

// The pipeline primitives, for a cell that wants finer control than the reader.
export { createObservedState, createMemoryStateStore, computeScore, deriveBackboneEdges, extractTypeRules } from './state';
export { resolvePresent, resolveLabel } from './present';
export { resolveType, mergeTypeDecl, parseTypeSchema, missingRequired, schemaHints } from './type-schema';
export { matchesSelector } from './selector';
export { layer } from './resolution';

// The types a cell renders against.
export type {
  ObservedState,
  StateStore,
  StateRecord,
  EdgeRecord,
  Entry,
  EntryMeta,
  QueryOptions,
  QueryResult,
  NeighborsOptions,
  NeighborsResult,
  MembersResult,
  MemberEntry,
  TypeRules,
  AnnotatedEdge,
} from './state';
export type { Affordance, Presentable } from './present';
export type { Type, FieldSpec, FieldType, KeyEdge } from './type-schema';
export type { Selector, Selectable } from './selector';
