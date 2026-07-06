/* ---------------------------------------------------------------------------
 * @c15r/tasks — substrate-native goals & tasks for long-range development.
 *
 * A tools-first tier-2 cell. GOALS (project-related objectives) and TASKS
 * (sub-units of a goal, with dependencies) are first-class SUBSTRATE FACTS in
 * the owner's slice — so they federate into $catalog / workspace.query / $graph,
 * carry provenance + salience, link to projects, and render like anything else.
 * The point: durable structure for long-range work instead of piecemeal
 * per-session sprints.
 *
 * Reads: `@parc/runtime/cell` reader (IAM-scoped to the owner's slice, no token).
 * Writes: the organ path — a `substrate.write.requested` EventBridge event the
 * workspace applies as a fact in the owner's slice, stamping provenance
 * (`@c15r/tasks`) server-side. Writes are therefore asynchronous (a create/update
 * is durable within a moment; an immediate re-read may lag by an eventbus hop).
 *
 * Keys:
 *   goal/<gid>                    type `goal`
 *   task/<gid>/<tid>              type `task`  (keyEdges → partOf goal/<gid>)
 * Dependencies (task→task) are carried in `value.dependsOn` (task keys); `next`
 * resolves them to surface only actionable work.
 * ------------------------------------------------------------------------- */
import { createCellReader, createDynamoStateStore } from '@parc/runtime/cell';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const OWNER = process.env.CELL_OWNER || 'c15r';
const TABLE = process.env.SUBSTRATE_TABLE || '';

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

// --- Lifecycle -------------------------------------------------------------
// Small, explicit state machines. A transition must be declared here (a no-op
// to the same status is always allowed); anything else is rejected with the set
// of legal next states, so lifecycle stays honest.
const GOAL_TX: Record<string, string[]> = {
  proposed: ['active', 'dropped'],
  active: ['blocked', 'done', 'dropped'],
  blocked: ['active', 'dropped'],
  done: ['active'], // reopen
  dropped: ['proposed', 'active'], // revive
};
const TASK_TX: Record<string, string[]> = {
  todo: ['doing', 'blocked', 'cancelled'],
  doing: ['done', 'blocked', 'todo', 'cancelled'],
  blocked: ['todo', 'doing', 'cancelled'],
  done: ['todo'], // reopen
  cancelled: ['todo'], // revive
};
const GOAL_STATUSES = Object.keys(GOAL_TX);
const TASK_STATUSES = Object.keys(TASK_TX);

interface GoalValue {
  id: string;
  title: string;
  detail?: string;
  status: string;
  project?: string; // a project fact key, e.g. `kb/proj_sol`
  createdAt: string;
  updatedAt: string;
}
interface TaskValue {
  id: string;
  goal: string; // goal id
  title: string;
  detail?: string;
  status: string;
  dependsOn?: string[]; // task keys this task waits on
  createdAt: string;
  updatedAt: string;
}

const goalKey = (id: string) => `goal/${id}`;
const taskKey = (goal: string, id: string) => `task/${goal}/${id}`;
const nowIso = () => new Date().toISOString();
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function reader() {
  return createCellReader(createDynamoStateStore(TABLE), OWNER);
}

async function emit(detail: Record<string, unknown>): Promise<void> {
  const client = new EventBridgeClient({});
  await client.send(new PutEventsCommand({
    Entries: [{
      EventBusName: process.env.EVENT_BUS_NAME,
      Source: process.env.SERVICE_NAME,
      DetailType: 'substrate.write.requested',
      Detail: JSON.stringify(detail),
    }],
  }));
}

async function writeGoal(g: GoalValue): Promise<void> {
  const tags = ['goal', `status:${g.status}`, ...(g.project ? [`project:${g.project}`] : [])];
  await emit({ key: goalKey(g.id), value: g, type: 'goal', tags, via: 'tasks.goal' });
}
async function writeTask(t: TaskValue): Promise<void> {
  const tags = ['task', `status:${t.status}`, `goal:${t.goal}`];
  await emit({ key: taskKey(t.goal, t.id), value: t, type: 'task', tags, via: 'tasks.task' });
}

const asGoal = (v: unknown) => v as GoalValue;
const asTask = (v: unknown) => v as TaskValue;

async function getGoal(id: string): Promise<GoalValue | null> {
  const r = await reader().peek(goalKey(id));
  return r ? asGoal(r.value) : null;
}
async function getTask(goal: string, id: string): Promise<TaskValue | null> {
  const r = await reader().peek(taskKey(goal, id));
  return r ? asTask(r.value) : null;
}
async function listGoals(status?: string): Promise<GoalValue[]> {
  const recs = await reader().list('goal/');
  let gs = recs.map((r) => asGoal(r.value)).filter(Boolean);
  if (status) gs = gs.filter((g) => g.status === status);
  return gs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
async function listTasks(goal?: string, status?: string): Promise<TaskValue[]> {
  const recs = await reader().list(goal ? `task/${goal}/` : 'task/');
  let ts = recs.map((r) => asTask(r.value)).filter(Boolean);
  if (status) ts = ts.filter((t) => t.status === status);
  return ts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** A task is actionable when it is `todo` and every dependency is `done`. */
async function depsSatisfied(t: TaskValue): Promise<boolean> {
  if (!t.dependsOn || !t.dependsOn.length) return true;
  const rdr = reader();
  for (const dep of t.dependsOn) {
    const r = await rdr.peek(dep);
    const status = r ? asTask(r.value).status : undefined;
    if (status !== 'done' && status !== 'cancelled') return false;
  }
  return true;
}

// --- Tool implementations --------------------------------------------------
type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strOpt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

async function toolCall(name: string, args: Args): Promise<{ statusCode: number; body: unknown }> {
  switch (name) {
    case 'create_goal': {
      const title = str(args.title);
      if (!title) return { statusCode: 400, body: { error: 'title is required' } };
      const g: GoalValue = {
        id: newId(), title, detail: strOpt(args.detail), status: 'proposed',
        project: strOpt(args.project), createdAt: nowIso(), updatedAt: nowIso(),
      };
      await writeGoal(g);
      return { statusCode: 200, body: { ok: true, key: goalKey(g.id), goal: g } };
    }
    case 'update_goal': {
      const id = str(args.id);
      const g = id ? await getGoal(id) : null;
      if (!g) return { statusCode: 404, body: { error: `no goal ${id}` } };
      if (args.title !== undefined) g.title = str(args.title) || g.title;
      if (args.detail !== undefined) g.detail = strOpt(args.detail);
      if (args.project !== undefined) g.project = strOpt(args.project);
      g.updatedAt = nowIso();
      await writeGoal(g);
      return { statusCode: 200, body: { ok: true, key: goalKey(g.id), goal: g } };
    }
    case 'set_goal_status': {
      const id = str(args.id);
      const status = str(args.status);
      const g = id ? await getGoal(id) : null;
      if (!g) return { statusCode: 404, body: { error: `no goal ${id}` } };
      if (!GOAL_STATUSES.includes(status)) {
        return { statusCode: 400, body: { error: `unknown status "${status}"`, allowed: GOAL_STATUSES } };
      }
      if (status !== g.status && !(GOAL_TX[g.status] || []).includes(status)) {
        return { statusCode: 409, body: { error: `illegal ${g.status} → ${status}`, allowed: GOAL_TX[g.status] } };
      }
      g.status = status;
      g.updatedAt = nowIso();
      await writeGoal(g);
      return { statusCode: 200, body: { ok: true, key: goalKey(g.id), goal: g } };
    }
    case 'get_goal': {
      const id = str(args.id);
      const g = id ? await getGoal(id) : null;
      if (!g) return { statusCode: 404, body: { error: `no goal ${id}` } };
      const tasks = await listTasks(id);
      return { statusCode: 200, body: { goal: g, tasks } };
    }
    case 'list_goals': {
      const goals = await listGoals(strOpt(args.status));
      return { statusCode: 200, body: { goals, count: goals.length } };
    }
    case 'create_task': {
      const goal = str(args.goal);
      const title = str(args.title);
      if (!goal || !title) return { statusCode: 400, body: { error: 'goal and title are required' } };
      if (!(await getGoal(goal))) return { statusCode: 404, body: { error: `no goal ${goal}` } };
      const dependsOn = Array.isArray(args.dependsOn) ? (args.dependsOn as unknown[]).map(str).filter(Boolean) : undefined;
      const t: TaskValue = {
        id: newId(), goal, title, detail: strOpt(args.detail), status: 'todo',
        dependsOn, createdAt: nowIso(), updatedAt: nowIso(),
      };
      await writeTask(t);
      return { statusCode: 200, body: { ok: true, key: taskKey(goal, t.id), task: t } };
    }
    case 'update_task': {
      const goal = str(args.goal);
      const id = str(args.id);
      const t = goal && id ? await getTask(goal, id) : null;
      if (!t) return { statusCode: 404, body: { error: `no task ${goal}/${id}` } };
      if (args.title !== undefined) t.title = str(args.title) || t.title;
      if (args.detail !== undefined) t.detail = strOpt(args.detail);
      if (args.dependsOn !== undefined) {
        t.dependsOn = Array.isArray(args.dependsOn) ? (args.dependsOn as unknown[]).map(str).filter(Boolean) : [];
      }
      t.updatedAt = nowIso();
      await writeTask(t);
      return { statusCode: 200, body: { ok: true, key: taskKey(goal, t.id), task: t } };
    }
    case 'set_task_status': {
      const goal = str(args.goal);
      const id = str(args.id);
      const status = str(args.status);
      const t = goal && id ? await getTask(goal, id) : null;
      if (!t) return { statusCode: 404, body: { error: `no task ${goal}/${id}` } };
      if (!TASK_STATUSES.includes(status)) {
        return { statusCode: 400, body: { error: `unknown status "${status}"`, allowed: TASK_STATUSES } };
      }
      if (status !== t.status && !(TASK_TX[t.status] || []).includes(status)) {
        return { statusCode: 409, body: { error: `illegal ${t.status} → ${status}`, allowed: TASK_TX[t.status] } };
      }
      t.status = status;
      t.updatedAt = nowIso();
      await writeTask(t);
      return { statusCode: 200, body: { ok: true, key: taskKey(goal, t.id), task: t } };
    }
    case 'get_task': {
      const goal = str(args.goal);
      const id = str(args.id);
      const t = goal && id ? await getTask(goal, id) : null;
      if (!t) return { statusCode: 404, body: { error: `no task ${goal}/${id}` } };
      return { statusCode: 200, body: { task: t } };
    }
    case 'list_tasks': {
      const tasks = await listTasks(strOpt(args.goal), strOpt(args.status));
      return { statusCode: 200, body: { tasks, count: tasks.length } };
    }
    case 'next': {
      // The "what should I work on" query for long-range dev: actionable `todo`
      // tasks (all deps satisfied) plus work already in flight (`doing`), across
      // one goal or all active goals.
      const goal = strOpt(args.goal);
      const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 10;
      let activeGoals: string[] | undefined;
      if (!goal) activeGoals = (await listGoals('active')).map((g) => g.id);
      const all = await listTasks(goal);
      const scoped = activeGoals ? all.filter((t) => activeGoals!.includes(t.goal)) : all;
      const doing = scoped.filter((t) => t.status === 'doing');
      const ready: TaskValue[] = [];
      for (const t of scoped) {
        if (t.status === 'todo' && (await depsSatisfied(t))) ready.push(t);
      }
      const next = [...doing, ...ready].slice(0, limit);
      return { statusCode: 200, body: { next, doing: doing.length, ready: ready.length } };
    }
    default:
      return { statusCode: 404, body: { error: `unknown tool ${name}` } };
  }
}

// --- Tool catalog ----------------------------------------------------------
const goalStatusEnum = { type: 'string', enum: GOAL_STATUSES };
const taskStatusEnum = { type: 'string', enum: TASK_STATUSES };
const TOOLS = [
  { name: 'create_goal', kind: 'act', description: 'Create a goal (a project-related objective). Starts `proposed`.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' }, project: { type: 'string', description: 'a project fact key, e.g. kb/proj_sol' } }, required: ['title'] } },
  { name: 'update_goal', kind: 'act', description: 'Edit a goal\'s title/detail/project (not status — use set_goal_status).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, detail: { type: 'string' }, project: { type: 'string' } }, required: ['id'] } },
  { name: 'set_goal_status', kind: 'act', description: 'Transition a goal\'s lifecycle: proposed→active→(done|blocked|dropped), reversible.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, status: goalStatusEnum }, required: ['id', 'status'] } },
  { name: 'get_goal', kind: 'read', description: 'A goal plus its tasks.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'list_goals', kind: 'read', description: 'List goals, newest first, optionally filtered by status.',
    inputSchema: { type: 'object', properties: { status: goalStatusEnum } } },
  { name: 'create_task', kind: 'act', description: 'Create a task under a goal. Starts `todo`. `dependsOn` = task keys it waits on.',
    inputSchema: { type: 'object', properties: { goal: { type: 'string', description: 'goal id' }, title: { type: 'string' }, detail: { type: 'string' }, dependsOn: { type: 'array', items: { type: 'string' }, description: 'task keys, e.g. task/<gid>/<tid>' } }, required: ['goal', 'title'] } },
  { name: 'update_task', kind: 'act', description: 'Edit a task\'s title/detail/dependsOn (not status — use set_task_status).',
    inputSchema: { type: 'object', properties: { goal: { type: 'string' }, id: { type: 'string' }, title: { type: 'string' }, detail: { type: 'string' }, dependsOn: { type: 'array', items: { type: 'string' } } }, required: ['goal', 'id'] } },
  { name: 'set_task_status', kind: 'act', description: 'Transition a task\'s lifecycle: todo→doing→(done|blocked|cancelled), reversible.',
    inputSchema: { type: 'object', properties: { goal: { type: 'string' }, id: { type: 'string' }, status: taskStatusEnum }, required: ['goal', 'id', 'status'] } },
  { name: 'get_task', kind: 'read', description: 'One task.',
    inputSchema: { type: 'object', properties: { goal: { type: 'string' }, id: { type: 'string' } }, required: ['goal', 'id'] } },
  { name: 'list_tasks', kind: 'read', description: 'List tasks, optionally scoped to a goal and/or status.',
    inputSchema: { type: 'object', properties: { goal: { type: 'string' }, status: taskStatusEnum } } },
  { name: 'next', kind: 'read', description: 'Actionable work: `doing` tasks + `todo` tasks whose dependencies are all done, across a goal or all active goals.',
    inputSchema: { type: 'object', properties: { goal: { type: 'string' }, limit: { type: 'number' } } } },
];

// --- Handler ---------------------------------------------------------------
export const handler = async (event: {
  rawPath?: string;
  requestContext?: { http?: { method?: string } };
  headers?: Record<string, string | undefined>;
  body?: string;
}) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  const caller = event.headers?.['x-cell-caller'] ?? 'anonymous';

  if (method === 'GET' && path === '/_tools') return json(200, { tools: TOOLS });

  if (method === 'POST' && path.startsWith('/_tools/')) {
    // Personal workspace: the owner (or an agent acting as them) only.
    if (caller !== OWNER) return json(403, { error: 'tasks is owner-only' });
    const name = path.slice('/_tools/'.length);
    let args: Args = {};
    try {
      args = event.body ? (JSON.parse(event.body) as Args) : {};
    } catch {
      return json(400, { error: 'invalid JSON body' });
    }
    try {
      const { statusCode, body } = await toolCall(name, args);
      return json(statusCode, body);
    } catch (err) {
      return json(500, { error: (err as Error).message });
    }
  }

  if (method === 'GET' && (path === '/' || path === '')) {
    return json(200, { cell: '@c15r/tasks', tools: TOOLS.map((t) => t.name) });
  }
  return json(404, { error: `no route for ${method} ${path}` });
};
