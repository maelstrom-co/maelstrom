import { afterEach, expect, test } from 'bun:test';
import { Host } from './host.js';
import {
  decode,
  frontendCall,
  post,
  runRequest,
  toolHistory,
  type WireEvent,
} from './wire.js';
import { FixtureStore, Workspace } from './workspace.js';

const workspaces: Workspace[] = [];
afterEach(() => {
  for (const workspace of workspaces.splice(0)) workspace.dispose();
});

async function suspended(gate?: (signal: AbortSignal) => Promise<void>) {
  const store = new FixtureStore(() => 'approved-record-37');
  const workspace = new Workspace(store);
  workspaces.push(workspace);
  const host = new Host(store, gate, 'approval');
  const initial = runRequest([
    {
      id: 'goal',
      role: 'user',
      content: 'Create a note and focus its record.',
    },
  ]);
  const first = await decode(await host.handle(post(initial)));
  const call = frontendCall(first);
  if (!call) throw new Error('Missing create');
  const ack = await workspace.apply(call.id, call.input);
  const waiting = await decode(
    await host.handle(
      post(
        runRequest(
          [
            ...toolHistory(first),
            {
              id: 'result-create',
              role: 'tool',
              toolCallId: call.id,
              content: JSON.stringify(ack),
            },
          ],
          2,
        ),
      ),
    ),
  );
  return { store, workspace, host, waiting };
}

function approval(events: WireEvent[], approved: boolean) {
  const terminal = events.at(-1);
  if (
    terminal?.type !== 'RUN_FINISHED' ||
    terminal.outcome?.type !== 'interrupt'
  )
    throw new Error('Missing approval pause');
  return {
    ...runRequest(toolHistory(events), 3),
    resume: [
      {
        interruptId: terminal.outcome.interrupts[0]!.id,
        status: 'resolved',
        payload: approved,
      },
    ],
  };
}

test.each([
  true,
  false,
])('workspace goal resumes its child, then honors approval=%s', async (approved) => {
  const f = await suspended();
  expect(f.store.creates).toBe(1);
  expect(f.host.approvedLookup.reads).toBe(0);
  expect(f.store.focused).toBeUndefined();
  const input = approval(f.waiting, approved);
  const resumed = await decode(await f.host.handle(post(input)));
  expect(f.host.approvedLookup.identities).toHaveLength(2);
  expect(f.host.approvedLookup.identities[1]).toBe(
    f.host.approvedLookup.identities[0],
  );
  expect(f.host.approvedLookup.reads).toBe(approved ? 1 : 0);
  const call = frontendCall(resumed);
  if (approved) {
    if (!call) throw new Error('Missing dependent focus');
    expect(call.input.response.executionPlan[0]?.params).toEqual(
      f.store.read(),
    );
    const ack = await f.workspace.apply(call.id, call.input);
    expect(ack.status).toBe('applied');
    const final = await decode(
      await f.host.handle(
        post(
          runRequest(
            [
              ...toolHistory(resumed),
              {
                id: 'result-focus',
                role: 'tool',
                toolCallId: call.id,
                content: JSON.stringify(ack),
              },
            ],
            4,
          ),
        ),
      ),
    );
    expect(frontendCall(final)).toBeUndefined();
    expect(f.store.focused).toEqual(f.store.read());
  } else {
    expect(call).toBeUndefined();
    expect(f.store.focused).toBeUndefined();
    expect(JSON.stringify(resumed)).toContain('Read denied');
  }
  expect((await f.host.handle(post(input))).status).toBe(409);
  expect(f.store.creates).toBe(1);
  expect(
    input.messages.filter(
      (message) => message.role === 'user' && !message.subagentRunId,
    ),
  ).toHaveLength(1);
});

test('missing, stale, and tampered approval requests cannot read or focus', async () => {
  const f = await suspended();
  const valid = approval(f.waiting, true);
  for (const input of [
    { ...valid, resume: [] },
    { ...valid, resume: [{ ...valid.resume[0], payload: 'true' }] },
    { ...valid, resume: [valid.resume[0], valid.resume[0]] },
    { ...valid, resume: [{ ...valid.resume[0], interruptId: 'stale' }] },
    { ...valid, parentRunId: 'run-1' },
    { ...valid, messages: valid.messages.slice(0, 1) },
  ])
    expect((await f.host.handle(post(input))).status).toBe(409);
  expect(f.host.approvedLookup.reads).toBe(0);
  expect(f.store.focused).toBeUndefined();
  expect(
    frontendCall(await decode(await f.host.handle(post(valid)))),
  ).toBeDefined();
});

test('a fresh host rejects the old approval instead of replaying create', async () => {
  const f = await suspended();
  const restarted = new Host(f.store, undefined, 'approval');
  expect((await restarted.handle(post(approval(f.waiting, true)))).status).toBe(
    409,
  );
  expect(restarted.approvedLookup.reads).toBe(0);
  expect(f.store.creates).toBe(1);
  expect(f.store.focused).toBeUndefined();
});

test('disconnect during an approved child read forbids replay and leaves create intact', async () => {
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let stopped!: () => void;
  const aborted = new Promise<void>((resolve) => {
    stopped = resolve;
  });
  const f = await suspended(async (signal) => {
    entered();
    await new Promise<void>((resolve) => {
      signal.addEventListener(
        'abort',
        () => {
          stopped();
          resolve();
        },
        { once: true },
      );
    });
  });
  const input = approval(f.waiting, true);
  const response = await f.host.handle(post(input));
  const reader = response.body!.getReader();
  const consuming = (async () => {
    while (!(await reader.read()).done) {}
  })();
  await ready;
  await reader.cancel();
  await consuming;
  await aborted;
  expect(f.host.approvedLookup.reads).toBe(0);
  expect(f.store.creates).toBe(1);
  expect(f.store.focused).toBeUndefined();
  expect((await f.host.handle(post(input))).status).toBe(409);
});
