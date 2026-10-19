import {
  createDevtools,
  mountDevtools,
} from '@maelstrom-co/devtools/production';

const tools = createDevtools({ initialIsOpen: true });
tools.importCapture(
  JSON.stringify({
    schemaVersion: 2,
    capture: {
      schemaVersion: 1,
      events: [
        {
          id: 'fixture-connection',
          sessionId: 'fixture',
          kind: 'client.connection.changed',
          metadata: { clientId: 'app', status: 'connected' },
        },
        {
          id: 'fixture-voice',
          sessionId: 'fixture',
          kind: 'voice.session.changed',
          metadata: {
            clientId: 'app',
            providerInstanceId: 'voice',
            state: 'connected',
          },
        },
      ],
    },
  }),
);
mountDevtools(tools);
