import {
  type WorkspaceApplication,
  WorkspaceApplicationSchema,
} from '@maelstrom-co/agui-protocol';
import {
  type ChartRequest,
  getVisibleInstanceIds,
  type MaelstromResponse,
  tilingLeafInstanceId,
} from '@maelstrom-co/protocol';
import { z } from 'zod';

import {
  applyRecordCommand,
  emptyRecords,
  type RecordCommand,
  RecordCommandSchema,
  type Records,
} from '../records';
import { validateWorkspacePlan } from './plan-validation';

const pureActions = new Set([
  'calendar.showMonth',
  'calendar.showWeek',
  'calendar.showDay',
  'weather.showCurrent',
  'weather.showHourly',
  'weather.showWeekly',
  'labs.showList',
  'labs.showTrends',
]);
const localActions = new Set([
  'journal.openEntry',
  'journal.backToList',
  'map.showOverview',
  'map.showRoute',
  'map.focusLocation',
  'weather.setLocation',
  'labs.selectMarker',
]);
const recordKinds: Record<string, RecordCommand['kind']> = {
  'journal.createEntry': 'journal.create',
  'journal.writeContent': 'journal.append',
  'tasks.addTask': 'task.create',
  'tasks.removeTask': 'task.remove',
  'tasks.checkTask': 'task.check',
  'tasks.uncheckTask': 'task.check',
  'tasks.addSubtask': 'task.addSubtask',
  'calendar.addEvent': 'calendar.create',
  'calendar.removeEvent': 'calendar.remove',
  'calendar.moveEvent': 'calendar.move',
};

export interface IssuedPlan {
  response: MaelstromResponse;
  request: ChartRequest;
  toolCallId?: string;
  effect?: { index: number; command?: RecordCommand; allocatedId: string };
  receipt?: { records: Records; recordId: string };
  settled: boolean;
  accepted?: { application: WorkspaceApplication; observation: ChartRequest };
}

export class IssuedPlans {
  private records = emptyRecords();
  private plans = new Map<string, IssuedPlan>();
  private current?: string;
  private stopped = false;

  snapshot() {
    return structuredClone(this.records);
  }

  review() {
    return [...this.plans.values()].map((plan) => ({
      requestId: plan.response.requestId,
      toolCallId: plan.toolCallId,
      status: plan.accepted
        ? 'confirmed'
        : plan.receipt
          ? 'committed-unconfirmed'
          : 'issued-unconfirmed',
      recordId: plan.receipt?.recordId,
    }));
  }

  stop() {
    this.stopped = true;
  }

  reconcile() {
    this.current = undefined;
    this.stopped = false;
  }

  issue(
    response: MaelstromResponse,
    request: ChartRequest,
    tool?: { id: string; intent: string },
  ) {
    if (this.stopped || this.current || this.plans.has(response.requestId))
      throw new Error('Workspace plan cannot be issued.');
    const issues = validateWorkspacePlan({ request, response });
    if (issues.length)
      throw new Error(issues.map(({ message }) => message).join(' '));
    const intents = request.context.updateReasons.filter(
      (reason) => reason.type === 'user_intent',
    );
    if (
      tool
        ? intents.length !== 1 || intents[0].intent !== tool.intent
        : intents.length !== 0
    )
      throw new Error('Request intent does not match its tool admission.');
    const issued: IssuedPlan = {
      response: structuredClone(response),
      request: structuredClone(request),
      toolCallId: tool?.id,
      settled: false,
    };
    for (const [index, action] of response.executionPlan.entries()) {
      const vessel =
        response.layout?.type === 'tiling'
          ? response.layout.instances.find(
              ({ instanceId }) => instanceId === action.instanceId,
            )?.vesselId
          : request.instances.find(
              ({ instanceId }) => instanceId === action.instanceId,
            )?.vesselId;
      const name = `${vessel}.${action.action}`;
      if (pureActions.has(name)) continue;
      if (!tool)
        throw new Error(
          'Automatic requests cannot perform application effects.',
        );
      if (issued.effect)
        throw new Error(
          'Dependent effects require separate workspace tool calls.',
        );
      const kind = recordKinds[name];
      if (!kind && !localActions.has(name))
        throw new Error('Unsupported application Action.');
      const params = action.params ?? {};
      const command = kind
        ? RecordCommandSchema.parse({
            ...params,
            kind,
            target: { id: params.id, version: params.version },
            ...(kind === 'task.check'
              ? { done: action.action === 'checkTask' }
              : {}),
            ...(kind === 'task.addSubtask'
              ? { title: params.subtaskTitle }
              : {}),
          })
        : undefined;
      const allocatedId = crypto.randomUUID();
      if (command) applyRecordCommand(this.records, command, () => allocatedId);
      if (name === 'journal.openEntry') {
        const target = z
          .object({ id: z.string(), version: z.number().int().positive() })
          .parse(params);
        if (
          !this.records.journal.some(
            ({ id, version }) => id === target.id && version === target.version,
          )
        )
          throw new Error('Journal observation is stale.');
      }
      issued.effect = { index, command, allocatedId };
    }
    this.plans.set(response.requestId, issued);
    this.current = response.requestId;
  }

  execute(requestId: string, index: number) {
    const plan = this.plans.get(requestId);
    if (plan?.effect?.index === index && plan.effect.command && plan.receipt)
      return structuredClone(plan.receipt);
    if (
      this.stopped ||
      this.current !== requestId ||
      !plan ||
      plan.settled ||
      plan.effect?.index !== index ||
      !plan.effect.command
    )
      throw new Error('Record operation was not issued for this binding.');
    const result = applyRecordCommand(
      this.records,
      plan.effect.command,
      () => plan.effect?.allocatedId ?? crypto.randomUUID(),
    );
    // The local host publishes records and receipt together; the durable host must persist this transaction atomically.
    this.records = result.records;
    plan.receipt = structuredClone(result);
    return structuredClone(result);
  }

  settle(requestId: string, status: string, toolCallId?: string) {
    const plan = this.plans.get(requestId);
    if (
      this.stopped ||
      this.current !== requestId ||
      !plan ||
      plan.settled ||
      plan.toolCallId !== toolCallId
    ) {
      this.stop();
      throw new Error('Application settlement does not match the issued plan.');
    }
    if (status !== 'applied' || (plan.effect?.command && !plan.receipt)) {
      this.stop();
      throw new Error('Application effects are not confirmed.');
    }
    plan.settled = true;
    this.current = undefined;
  }

  confirmed(requestId: string, toolCallId: string) {
    const plan = this.plans.get(requestId);
    if (
      this.stopped ||
      !plan?.settled ||
      !plan.accepted ||
      plan.toolCallId !== toolCallId
    )
      throw new Error('Tool application is not confirmed.');
    return structuredClone(plan);
  }

  accept(
    application: WorkspaceApplication,
    observation: ChartRequest,
    toolCallId?: string,
  ) {
    const requestId = application.correlation.requestId;
    const plan = this.plans.get(requestId);
    const expected = plan?.response.executionPlan;
    const retained = new Set(
      observation.instances.map(({ instanceId }) => instanceId),
    );
    const visible = new Set(
      [...getVisibleInstanceIds(observation.layout)].filter((id) =>
        retained.has(id),
      ),
    );
    const layout = observation.layout;
    const projection = WorkspaceApplicationSchema.shape.chart.parse({
      instances: observation.instances
        .filter(({ instanceId }) => visible.has(instanceId))
        .map(({ instanceId, vesselId, variant }) => ({
          instanceId,
          vesselId,
          variant,
        })),
      layout:
        layout.type === 'tiling'
          ? {
              ...layout,
              tree: layout.tree.map((token) => {
                const id = tilingLeafInstanceId(token);
                return id === null || visible.has(id) ? token : null;
              }),
              instances: layout.instances.filter(({ instanceId }) =>
                visible.has(instanceId),
              ),
            }
          : {
              ...layout,
              positions: layout.positions.filter(({ instanceId }) =>
                visible.has(instanceId),
              ),
            },
      layoutMode: observation.context.layoutMode,
      chartDimensions: observation.context.chartDimensions,
    });
    if (
      !expected ||
      expected.length !== application.actions.length ||
      application.actions.some(
        (action, index) =>
          !action.succeeded ||
          action.instanceId !== expected[index].instanceId ||
          action.action !== expected[index].action,
      ) ||
      JSON.stringify(projection) !== JSON.stringify(application.chart)
    ) {
      this.stop();
      throw new Error(
        'Canonical settlement evidence does not match the issued plan.',
      );
    }
    this.settle(requestId, application.status, toolCallId);
    plan.accepted = structuredClone({ application, observation });
  }
}
