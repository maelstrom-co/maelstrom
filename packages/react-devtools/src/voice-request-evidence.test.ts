import { expect, test } from 'bun:test';
import { createDevtools } from '@maelstrom-co/devtools/production';
import { createVoicePanelHarness } from '../test-utils/voice.js';

const { attach, event, mount } = createVoicePanelHarness();

test('unsafe Voice history cannot turn missing session proof into a contradiction', () => {
  const tools = createDevtools({
    initialIsOpen: true,
    maxActivityEvents: 3,
    redact(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return value;
      const observation = value as Record<string, unknown>;
      if (observation.kind === 'client.response.applied')
        return { ...observation, sessionId: 'destination-session' };
      if (observation.kind === 'voice.tool.result')
        return { ...observation, sessionId: '[REDACTED]' };
      return value;
    },
  });
  const emit = attach(tools);
  let view = mount(tools);
  view.click('Voice');
  emit('voice.tool.called', { invocationId: 'collapsed' });
  emit('voice.tool.called', { invocationId: 'collapsed' });
  emit('voice.media');
  emit('client.response.applied', {}, 'request');
  emit('voice.tool.result', { invocationId: 'other' }, 'request');
  const expectUnconfirmed = () => {
    expect(view.shadow.querySelector('.voice-requests')?.textContent).toContain(
      'Related request ownership is unconfirmed.',
    );
    const link = Array.from(view.shadow.querySelectorAll('button')).find(
      (node) => node.textContent === 'Open request request',
    );
    expect(link?.disabled).toBe(true);
    expect(link?.title).toBe(
      'Retained session evidence does not establish request ownership.',
    );
  };
  expectUnconfirmed();
  emit('client.connection', { state: 'connected' });
  expectUnconfirmed();
  view.unmount();
  view = mount(tools);
  expectUnconfirmed();
});

test.each([
  3, 2,
])('retaining %s observations cannot make a contradictory request navigable after source-session eviction', (limit) => {
  const tools = createDevtools({
    initialIsOpen: true,
    maxActivityEvents: limit,
    redact(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return value;
      const observation = value as Record<string, unknown>;
      if (observation.kind === 'client.response.applied')
        return { ...observation, sessionId: 'contradictory-session' };
      if (observation.kind === 'voice.tool.result')
        return { ...observation, sessionId: '[REDACTED]' };
      return value;
    },
  });
  const emit = attach(tools);
  let view = mount(tools);
  view.click('Voice');
  emit('voice.tool.called', { invocationId: 'one' });
  emit('client.response.applied', {}, 'request');
  emit('voice.tool.result', { invocationId: 'one' }, 'request');
  const requestLink = () =>
    Array.from(view.shadow.querySelectorAll<HTMLButtonElement>('button')).find(
      (node) => node.textContent === 'Open request request',
    );

  expect(requestLink()?.disabled).toBe(true);
  expect(view.shadow.querySelector('.voice-requests')?.textContent).toContain(
    'Related request ownership is ambiguous.',
  );
  view.unmount();
  view = mount(tools);
  expect(requestLink()?.disabled).toBe(true);
});

test('remembered source context keeps a matching request usable after its readable Voice event expires', () => {
  const tools = createDevtools({
    initialIsOpen: true,
    maxActivityEvents: 2,
    redact(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return value;
      const observation = value as Record<string, unknown>;
      return observation.kind === 'voice.tool.result'
        ? { ...observation, sessionId: '[REDACTED]' }
        : value;
    },
  });
  const emit = attach(tools);
  const { shadow, click } = mount(tools);
  click('Voice');
  emit('voice.tool.called', { invocationId: 'one' });
  emit('client.response.applied', {}, 'request');
  emit('voice.tool.result', { invocationId: 'one' }, 'request');
  expect(
    Array.from(shadow.querySelectorAll('button')).find(
      (node) => node.textContent === 'Open request request',
    )?.disabled,
  ).toBe(false);
  click('Open request request');
  expect(shadow.querySelector('.request-outcome')?.textContent).toContain(
    'request',
  );
});

test.each([
  ['session', 'ambiguous'],
  ['legacy', 'unconfirmed'],
] as const)('a full Voice gap and remount keep %s ownership evidence from becoming stronger', (scope, reason) => {
  const tools = createDevtools({
    initialIsOpen: true,
    maxActivityEvents: 2,
    redact(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return value;
      const observation = value as Record<string, unknown>;
      if (observation.kind === 'client.response.applied')
        return { ...observation, sessionId: 'contradictory-session' };
      if (observation.kind === 'voice.tool.result')
        return { ...observation, sessionId: '[REDACTED]' };
      return value;
    },
  });
  const emit = attach(tools);
  let view = mount(tools);
  view.click('Voice');
  emit('voice.tool.called', { invocationId: 'one', generationScope: scope });
  emit('client.connection', { state: 'connecting' });
  emit('client.connection', { state: 'connected' });
  view.unmount();
  view = mount(tools);
  emit('client.response.applied', {}, 'request');
  emit(
    'voice.tool.result',
    { invocationId: 'one', generationScope: scope },
    'request',
  );
  expect(
    Array.from(view.shadow.querySelectorAll('button')).find(
      (node) => node.textContent === 'Open request request',
    )?.disabled,
  ).toBe(true);
  expect(view.shadow.querySelector('.voice-requests')?.textContent).toContain(
    `Related request ownership is ${reason}.`,
  );
});

test('a directly proven request stays usable as unrelated colliding lane context expires', () => {
  const tools = createDevtools({
    initialIsOpen: true,
    maxActivityEvents: 3,
    redact(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return value;
      const observation = value as Record<string, unknown>;
      return observation.kind === 'client.response.applied' ||
        observation.kind === 'voice.tool.result'
        ? { ...observation, sessionId: 'direct-session' }
        : value;
    },
  });
  const emit = attach(tools);
  let view = mount(tools);
  view.click('Voice');
  emit('voice.media');
  emit('client.response.applied', {}, 'request');
  emit('voice.tool.result', { invocationId: 'one' }, 'request');
  const link = () =>
    Array.from(view.shadow.querySelectorAll('button')).find(
      (node) => node.textContent === 'Open request request',
    );
  expect(link()?.disabled).toBe(false);
  emit('client.connection', { state: 'connected' });
  expect(link()?.disabled).toBe(false);
  view.unmount();
  view = mount(tools);
  expect(link()?.disabled).toBe(false);
});

test.each([
  ['[REDACTED]', 'redacted'],
  ['[TRUNCATED]', 'truncated'],
  ['[MAX_DEPTH]', 'unreadable'],
] as const)('a %s request identity explains the missing link without becoming a navigation target', (marker, reason) => {
  const tools = createDevtools({ initialIsOpen: true });
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [
          event('result', 'voice.tool.result', { invocationId: 'one' }, marker),
        ],
      },
    }),
  );
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'imported');
  click('Voice');
  click('Raw JSON');
  expect(shadow.querySelector('.voice-requests')?.textContent ?? '').toContain(
    `Request identity is ${reason}.`,
  );
  expect(shadow.querySelector('.voice-timeline')?.textContent).not.toContain(
    'No Engine request link was reported',
  );
  expect(shadow.querySelector('.voice-requests button')).toBeNull();
  expect(shadow.querySelector('.json-raw')?.textContent).toContain(marker);
});

test.each([
  undefined,
  null,
  '',
])('an absent request identity stays distinct from withheld evidence (%s)', (requestId) => {
  const tools = createDevtools({ initialIsOpen: true });
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [{ ...event('result', 'voice.tool.result'), requestId }],
      },
    }),
  );
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'imported');
  click('Voice');
  expect(shadow.querySelector('.voice-timeline')?.textContent).toContain(
    'No Engine request link was reported for this observation.',
  );
  expect(shadow.querySelector('.voice-requests')).toBeNull();
});
