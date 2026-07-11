/**
 * Workspace command group (ADR-0044 Inc 5): the declared no-code vocabulary —
 * actions (register/list/delete/invoke), views (register/list/delete/evaluate),
 * and subscriptions (register/list/delete).
 */
import { requireUser } from '../../platform/runtime';
import { createDeclarativeActions, type ActionDefinition } from './actions';
import { createRegisteredViews, type ViewDefinition } from './views';
import { createSubscriptions, type SubscriptionDefinition } from './subscriptions';
import { type DepsBuilder } from './shared';
import type { WorkspaceCommands } from './handlers';

export interface RegisterActionInput {
  action: ActionDefinition;
}
export interface DeleteActionInput {
  id: string;
}
export interface InvokeInput {
  action: string;
  params?: Record<string, unknown>;
}
export interface RegisterViewInput {
  view: ViewDefinition;
}
export interface ViewInput {
  id: string;
}
export type DeleteViewInput = ViewInput;
export interface RegisterSubscriptionInput {
  subscription: SubscriptionDefinition;
}
export interface DeleteSubscriptionInput {
  id: string;
}

// ── ADR-0068 (C1): the one declaration surface ──────────────────────────
// The three kinds share one storage lifecycle (ADR-0001, `declarations.ts`); the
// composed verbs expose that once — `declare`/`declarations`/`undeclare` are the
// universal lifecycle, `evaluate` is the per-kind essence (invoke for actions,
// evaluate for views; subscriptions match in the reactor, not by a caller). The
// eleven legacy verbs below remain as aliases during the deprecation window.
export type DeclarationKindName = 'action' | 'view' | 'subscription';
export interface DeclareInput {
  kind: DeclarationKindName;
  def: ActionDefinition | ViewDefinition | SubscriptionDefinition;
}
export interface DeclarationsInput {
  kind?: DeclarationKindName;
}
export interface UndeclareInput {
  kind: DeclarationKindName;
  id: string;
}
export interface EvaluateInput {
  kind: DeclarationKindName;
  id: string;
  params?: Record<string, unknown>;
}

/** The views/actions/subscriptions command handlers (ADR-0044 Inc 5) + the composed
 *  declaration surface (ADR-0068). */
export function createDeclaredCommands(build: DepsBuilder): Pick<WorkspaceCommands, 'registerAction' | 'actions' | 'deleteAction' | 'invoke' | 'registerView' | 'views' | 'deleteView' | 'view' | 'registerSubscription' | 'subscriptions' | 'deleteSubscription' | 'declare' | 'declarations' | 'undeclare' | 'evaluate'> {
  return {
    async registerAction(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.action) throw new Error('action is required');
      const { state } = build(ctx);
      const result = await createDeclarativeActions(state).register(scope, input.action, ctx.identity);
      ctx.logger.info('workspace action registered', {
        scope,
        action: result.action.id,
        contested: result.contested.length,
      });
      return result;
    },

    async actions(_input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      return { actions: await createDeclarativeActions(state).list(scope) };
    },

    async deleteAction(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.id) throw new Error('id is required');
      const { state } = build(ctx);
      return createDeclarativeActions(state).remove(scope, input.id, ctx.identity);
    },

    async invoke(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.action) throw new Error('action is required');
      const { state } = build(ctx);
      const result = await createDeclarativeActions(state).invoke(scope, input.action, input.params ?? {}, ctx.identity);
      await ctx.events.emit('workspace.action.invoked', { scope, action: input.action });
      // Each write is a fact change — surface it so subscriptions react to a
      // manual step exactly as they do to a reactive one.
      for (const w of result.writes) {
        await ctx.events.emit('workspace.fact.written', { scope, key: w.key, revision: w._meta.revision });
      }
      ctx.logger.info('workspace action invoked', { scope, action: input.action, writes: result.writes.length });
      return result;
    },

    async registerView(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.view) throw new Error('view is required');
      const { state } = build(ctx);
      const view = await createRegisteredViews(state).register(scope, input.view, ctx.identity);
      ctx.logger.info('workspace view registered', { scope, view: view.id });
      return view;
    },

    async views(_input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      return { views: await createRegisteredViews(state).list(scope) };
    },

    async deleteView(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.id) throw new Error('id is required');
      const { state } = build(ctx);
      return createRegisteredViews(state).remove(scope, input.id, ctx.identity);
    },

    async view(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.id) throw new Error('id is required');
      const { state } = build(ctx);
      return createRegisteredViews(state).evaluate(scope, input.id, ctx.identity);
    },

    async registerSubscription(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.subscription) throw new Error('subscription is required');
      const { state } = build(ctx);
      const sub = await createSubscriptions(state).register(scope, input.subscription, ctx.identity);
      ctx.logger.info('workspace subscription registered', { scope, subscription: sub.id, invoke: sub.invoke });
      return sub;
    },

    async subscriptions(_input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      return { subscriptions: await createSubscriptions(state).list(scope) };
    },

    async deleteSubscription(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.id) throw new Error('id is required');
      const { state } = build(ctx);
      return createSubscriptions(state).remove(scope, input.id, ctx.identity);
    },

    // ── ADR-0068 (C1): declare / declarations / undeclare / evaluate ──────
    async declare(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.kind || !input?.def) throw new Error('kind and def are required');
      const { state } = build(ctx);
      switch (input.kind) {
        case 'action': {
          const result = await createDeclarativeActions(state).register(scope, input.def as ActionDefinition, ctx.identity);
          ctx.logger.info('workspace declaration registered', { scope, kind: input.kind, id: result.action.id, contested: result.contested.length });
          return result;
        }
        case 'view': {
          const view = await createRegisteredViews(state).register(scope, input.def as ViewDefinition, ctx.identity);
          ctx.logger.info('workspace declaration registered', { scope, kind: input.kind, id: view.id });
          return view;
        }
        case 'subscription': {
          const sub = await createSubscriptions(state).register(scope, input.def as SubscriptionDefinition, ctx.identity);
          ctx.logger.info('workspace declaration registered', { scope, kind: input.kind, id: sub.id });
          return sub;
        }
        default:
          throw new Error(`unknown declaration kind: ${String(input.kind)}`);
      }
    },

    async declarations(input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      const kind = input?.kind;
      if (kind === 'action') return { declarations: await createDeclarativeActions(state).list(scope) };
      if (kind === 'view') return { declarations: await createRegisteredViews(state).list(scope) };
      if (kind === 'subscription') return { declarations: await createSubscriptions(state).list(scope) };
      if (kind) throw new Error(`unknown declaration kind: ${String(kind)}`);
      // No kind → the union across all three, each entry tagged with its kind.
      const [actions, views, subs] = await Promise.all([
        createDeclarativeActions(state).list(scope),
        createRegisteredViews(state).list(scope),
        createSubscriptions(state).list(scope),
      ]);
      return {
        declarations: [
          ...actions.map((d) => ({ kind: 'action' as const, ...d })),
          ...views.map((d) => ({ kind: 'view' as const, ...d })),
          ...subs.map((d) => ({ kind: 'subscription' as const, ...d })),
        ],
      };
    },

    async undeclare(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.kind || !input?.id) throw new Error('kind and id are required');
      const { state } = build(ctx);
      switch (input.kind) {
        case 'action':
          return createDeclarativeActions(state).remove(scope, input.id, ctx.identity);
        case 'view':
          return createRegisteredViews(state).remove(scope, input.id, ctx.identity);
        case 'subscription':
          return createSubscriptions(state).remove(scope, input.id, ctx.identity);
        default:
          throw new Error(`unknown declaration kind: ${String(input.kind)}`);
      }
    },

    async evaluate(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.kind || !input?.id) throw new Error('kind and id are required');
      const { state } = build(ctx);
      if (input.kind === 'view') {
        return createRegisteredViews(state).evaluate(scope, input.id, ctx.identity);
      }
      if (input.kind === 'action') {
        // Mirror `invoke` exactly: same interpreter + the same surfaced events so
        // subscriptions react to a manual step as they do to a reactive one.
        const result = await createDeclarativeActions(state).invoke(scope, input.id, input.params ?? {}, ctx.identity);
        await ctx.events.emit('workspace.action.invoked', { scope, action: input.id });
        for (const w of result.writes) {
          await ctx.events.emit('workspace.fact.written', { scope, key: w.key, revision: w._meta.revision });
        }
        ctx.logger.info('workspace declaration evaluated', { scope, kind: input.kind, id: input.id, writes: result.writes.length });
        return result;
      }
      throw new Error(`declaration kind "${String(input.kind)}" has no evaluate (only action | view)`);
    },
  };
}
