import type { Message } from '@ag-ui/core';
import { Host } from './host.js';
import { decode, frontendCall, post, runRequest, toolHistory } from './wire.js';
import { FixtureStore, Workspace } from './workspace.js';

const store = new FixtureStore();
const workspace = new Workspace(store);
const host = new Host(store);
const messages: Message[] = [
  {
    id: 'goal-1',
    role: 'user',
    content: 'Create a note and focus the new record.',
  },
];
try {
  for (let run = 1; run <= 3; run++) {
    const events = await decode(
      await host.handle(post(runRequest(messages, run))),
    );
    for (const event of events)
      console.log(JSON.stringify({ lane: 'parent', ...event }));
    const call = frontendCall(events);
    if (!call) break;
    messages.splice(0, messages.length, ...toolHistory(events));
    const ack = await workspace.apply(call.id, call.input);
    console.log(JSON.stringify({ lane: 'frontend-result', ...ack }));
    messages.push({
      id: `result-${call.id}`,
      role: 'tool',
      toolCallId: call.id,
      content: JSON.stringify(ack),
      ...(ack.status === 'applied'
        ? {}
        : { error: 'Workspace did not confirm application' }),
    });
  }
  for (const event of host.childTrace)
    console.log(JSON.stringify({ lane: 'child', ...event }));
  console.log(
    JSON.stringify({
      commands: workspace.commands,
      record: store.record,
      focused: store.focused,
      snapshot: workspace.snapshot(),
    }),
  );
} finally {
  workspace.dispose();
}
