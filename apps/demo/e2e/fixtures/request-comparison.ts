import {
  createDevtools,
  mountDevtools,
} from '@maelstrom-co/devtools/production';

const tools = createDevtools({ initialIsOpen: true });
const event = (
  app: string,
  kind: string,
  id: string,
  metadata: Record<string, unknown> = {},
  content?: unknown,
) => ({
  id,
  sessionId: 'fixture-session',
  requestId: `request-${app}`,
  kind,
  metadata: { clientId: `app-${app}`, ...metadata },
  content,
});
const events = ['a', 'b'].flatMap((app) => [
  event(
    app,
    'client.request.started',
    `${app}-start`,
    {},
    {
      request: {
        context: {
          updateReasons: [
            {
              type: 'user_intent',
              intent:
                app === 'a' ? 'Show the calendar' : 'Show the calendar again',
            },
          ],
        },
      },
    },
  ),
  ...Array.from({ length: 205 }, (_, index) =>
    event(
      app,
      index % 2 ? 'engine.stage.completed' : 'engine.stage.failed',
      `${app}-stage-${index}`,
      {
        stage: 'plan',
        outcome: index % 2 ? 'succeeded' : 'failed',
        durationMs: index + 1,
      },
    ),
  ),
  event(app, 'client.response.received', `${app}-receipt`, {
    source: 'request',
    durationMs: app === 'a' ? 90 : 340,
  }),
  event(app, 'client.action.completed', `${app}-action`, {
    action: 'open',
    instanceId: 'calendar',
    outcome: app === 'a' ? 'succeeded' : 'failed',
    durationMs: 4,
  }),
  event(app, 'client.response.applied', `${app}-end`, {
    durationMs: app === 'a' ? 12 : 48,
    actionFailures: app === 'a' ? 0 : 1,
    skippedActions: 0,
  }),
]);
tools.importCapture(
  JSON.stringify({ schemaVersion: 2, capture: { schemaVersion: 1, events } }),
);
mountDevtools(tools);
