import { Host } from './host.js';
import { decode, frontendCall, post, runRequest, toolHistory } from './wire.js';
import { FixtureStore, Workspace } from './workspace.js';

const approved = !process.argv.includes('--deny');
const store = new FixtureStore(() => 'record-37');
const workspace = new Workspace(store);
const host = new Host(store, undefined, 'approval');
let input = runRequest([
  {
    id: 'goal',
    role: 'user',
    content: 'Create a note and focus its new record.',
  },
]);
try {
  for (let run = 1; run <= 4; run++) {
    const events = await decode(await host.handle(post(input)));
    console.log(JSON.stringify({ run, events }));
    const terminal = events.at(-1);
    if (
      terminal?.type === 'RUN_FINISHED' &&
      terminal.outcome?.type === 'interrupt'
    ) {
      const interrupt = terminal.outcome.interrupts[0];
      if (!interrupt) throw new Error('Missing approval');
      console.log(
        JSON.stringify({
          checkpoint: 'paused',
          creates: store.creates,
          reads: host.approvedLookup.reads,
          focused: store.focused ?? null,
        }),
      );
      input = {
        ...runRequest(toolHistory(events), run + 1),
        resume: [
          { interruptId: interrupt.id, status: 'resolved', payload: approved },
        ],
      };
      continue;
    }
    const call = frontendCall(events);
    if (!call) break;
    const ack = await workspace.apply(call.id, call.input);
    console.log(JSON.stringify({ callId: call.id, ack }));
    input = runRequest(
      [
        ...toolHistory(events),
        {
          id: `result-${call.id}`,
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify(ack),
        },
      ],
      run + 1,
    );
  }
  console.log(
    JSON.stringify({
      checkpoint: 'finished',
      approved,
      creates: store.creates,
      reads: host.approvedLookup.reads,
      record: store.record,
      focused: store.focused ?? null,
      childIdentities: host.approvedLookup.identities,
      commands: workspace.commands,
    }),
  );
} finally {
  workspace.dispose();
}
