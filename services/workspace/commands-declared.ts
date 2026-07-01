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

/** The views/actions/subscriptions command handlers (ADR-0044 Inc 5). */
export function createDeclaredCommands(build: DepsBuilder): Pick<WorkspaceCommands, 'registerAction' | 'actions' | 'deleteAction' | 'invoke' | 'registerView' | 'views' | 'deleteView' | 'view' | 'registerSubscription' | 'subscriptions' | 'deleteSubscription'> {
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
  };
}
