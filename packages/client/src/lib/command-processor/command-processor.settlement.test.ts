import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  ActionName,
  err,
  InstanceId,
  ok,
  tilingLeafToken,
  VariantName,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';
import { flushMicrotasks } from '../../../test-utils/async-utils.js';
import {
  calendarMain,
  calendarViewsVessel,
  createCalendarLayout,
} from '../../../test-utils/calendar-vessel.js';
import {
  createExecuteActionsCommand,
  createSetLayoutCommand,
} from '../../../test-utils/command-mocks.js';
import type { ActionResult } from './action-result.js';
import { CommandProcessor } from './command-processor.js';

describe('CommandProcessor.dispatchSettled', () => {
  let clock: ReturnType<typeof FakeTimers.install>;
  let processor: CommandProcessor;
  beforeEach(() => {
    clock = FakeTimers.install();
    processor = new CommandProcessor({
      defaultActionWaitTimeoutMs: 10,
      actionExecutionTimeoutMs: 20,
    });
  });
  afterEach(() => {
    processor.dispose();
    clock.uninstall();
  });

  it('isolates a first-layout refusal and abandoned tail from the next batch', async () => {
    const refused = createSetLayoutCommand('one');
    if (refused.kind !== 'set_layout' || refused.layout.type !== 'tiling')
      throw new Error('expected tiling fixture');
    refused.layout = {
      ...refused.layout,
      tree: [
        'V',
        tilingLeafToken(InstanceId('one')),
        tilingLeafToken(InstanceId('one')),
      ],
    };
    const runner = mock(() => ok(undefined));
    processor.registerRunner(InstanceId('one'), { show: runner });
    const failed = processor.dispatchSettled(
      refused,
      createExecuteActionsCommand('one', 'show'),
    );
    const applied = processor.dispatchSettled(createSetLayoutCommand('two'));
    expect((await failed).status).toBe('failed');
    expect(await applied).toEqual({ status: 'applied' });
    expect(runner).not.toHaveBeenCalled();
    expect(processor.store.state.instances.has(InstanceId('two'))).toBe(true);
  });

  it('reports action errors and skips as unknown, not successful command dispatch', async () => {
    const error = new Error('runner failed');
    processor.registerRunner(InstanceId('one'), { show: () => err(error) });
    expect(
      await processor.dispatchSettled(
        createExecuteActionsCommand('one', 'show'),
      ),
    ).toEqual({ status: 'unknown', error });
    const skipped = processor.dispatchSettled(
      createExecuteActionsCommand('missing', 'show'),
    );
    await clock.tickAsync(10);
    expect((await skipped).status).toBe('unknown');
    expect(
      await processor.dispatchSettled(createSetLayoutCommand('two')),
    ).toEqual({ status: 'applied' });
  });

  it('settles action timeout as unknown without claiming rollback', async () => {
    processor.registerRunner(InstanceId('one'), {
      show: () => new Promise<ActionResult>(() => {}),
    });
    const batch = processor.dispatchSettled(
      createSetLayoutCommand('one'),
      createExecuteActionsCommand('one', 'show'),
    );
    await clock.tickAsync(20);
    expect((await batch).status).toBe('unknown');
    expect(processor.store.state.instances.has(InstanceId('one'))).toBe(true);
  });

  it('settles active and queued batches on disposal and never runs their abandoned tails', async () => {
    let finish!: (result: ActionResult) => void;
    processor.registerRunner(InstanceId('one'), {
      show: () =>
        new Promise<ActionResult>((resolve) => {
          finish = resolve;
        }),
    });
    const active = processor.dispatchSettled(
      createExecuteActionsCommand('one', 'show'),
      createSetLayoutCommand('tail'),
    );
    const queued = processor.dispatchSettled(createSetLayoutCommand('queued'));
    await flushMicrotasks();
    processor.dispose();
    expect((await active).status).toBe('unknown');
    expect((await queued).status).toBe('unknown');
    finish(ok(undefined));
    await flushMicrotasks();
    expect(processor.store.state.instances.size).toBe(0);
    expect(
      (await processor.dispatchSettled(createSetLayoutCommand('late'))).status,
    ).toBe('unknown');
    expect(clock.countTimers()).toBe(0);
  });
});

describe('CommandProcessor.dispatchSettled with Vessel resolution', () => {
  let processor: CommandProcessor;
  beforeEach(() => {
    processor = new CommandProcessor({
      defaultActionWaitTimeoutMs: 10,
      resolveVessel: (vesselId) =>
        vesselId === calendarViewsVessel.id ? calendarViewsVessel : undefined,
    });
  });
  afterEach(() => {
    processor.dispose();
  });

  it('applies an effect none transition Action after the layout and settles as applied', async () => {
    processor.registerRunner(calendarMain, {});

    const settled = await processor.dispatchSettled(
      { kind: 'set_layout', layout: createCalendarLayout('day') },
      {
        kind: 'execute_actions',
        executionPlan: [
          { instanceId: calendarMain, action: ActionName('showWeek') },
        ],
      },
    );

    expect(settled).toEqual({ status: 'applied' });
    expect(processor.store.state.instances.get(calendarMain)?.variant).toBe(
      VariantName('week'),
    );
  });

  it('settles as unknown with a reason when the Action is not on the current Variant', async () => {
    processor.registerRunner(calendarMain, {});

    const settled = await processor.dispatchSettled(
      { kind: 'set_layout', layout: createCalendarLayout('week') },
      {
        kind: 'execute_actions',
        executionPlan: [
          { instanceId: calendarMain, action: ActionName('showWeek') },
        ],
      },
    );

    expect(settled.status).toBe('unknown');
    if (settled.status !== 'unknown') throw new Error('expected unknown');
    expect(settled.error?.message).toBe(
      'Action "showWeek" is not defined on Variant "week" of Instance "calendar-main"',
    );
    expect(processor.store.state.instances.get(calendarMain)?.variant).toBe(
      VariantName('week'),
    );
  });
});
