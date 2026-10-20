import { expect, test } from 'bun:test';
import { createDevtools } from '@maelstrom-co/devtools/production';
import { fireEvent } from '@testing-library/react';
import { createVoicePanelHarness } from '../test-utils/voice.js';

const { attach, event, mount } = createVoicePanelHarness();

test.each([
  ['redacted', { providerInstanceId: '[REDACTED]', generation: '[REDACTED]' }],
  [
    'truncated',
    { providerInstanceId: '[TRUNCATED]', generation: '[TRUNCATED]' },
  ],
  ['not reported', { providerInstanceId: undefined, generation: undefined }],
] as const)('voice filters name %s identities instead of conflating their availability', (availability, metadata) => {
  const tools = createDevtools({ initialIsOpen: true });
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [event('media', 'voice.media', metadata)],
      },
    }),
  );
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'imported');
  click('Voice');
  expect(
    shadow.querySelector('select[aria-label="Voice provider lifetime"]')
      ?.textContent,
  ).toContain(`Lifetime ${availability}`);
  expect(
    shadow.querySelector('select[aria-label="Voice generation"]')?.textContent,
  ).toContain(`Session generation ${availability}`);
  expect(shadow.querySelector('.voice-timeline')?.textContent).toContain(
    `Session generation ${availability}`,
  );
});

test('large voice evidence keeps navigation bounded and searchable without replacing the selected JSON', () => {
  const tools = createDevtools({ initialIsOpen: true });
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: Array.from({ length: 120 }, (_, index) =>
          event(`event-${index}`, 'voice.media', {
            providerInstanceId: `provider-${index}`,
          }),
        ),
      },
    }),
  );
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'imported');
  click('Voice');
  click('Raw JSON');
  const lanes = () =>
    Array.from(
      shadow.querySelectorAll<HTMLButtonElement>('[data-focus-key^="voice:"]'),
    );
  const providers = () =>
    shadow.querySelector<HTMLSelectElement>(
      'select[aria-label="Voice provider lifetime"]',
    )!;
  expect(lanes()).toHaveLength(50);
  expect(providers().options).toHaveLength(51);
  fireEvent.click(lanes().at(-1)!);
  expect(shadow.querySelector('.json-raw')?.textContent).toContain('event-70');
  click('Show more voice lanes (50 of 120)');
  expect(lanes()).toHaveLength(100);
  expect(shadow.querySelector('.json-raw')?.textContent).toContain('event-70');
  const search = () =>
    shadow.querySelector<HTMLInputElement>(
      'input[aria-label="Search voice providers"]',
    )!;
  fireEvent.input(search(), { target: { value: 'provider-75' } });
  expect(providers().options).toHaveLength(2);
  expect(shadow.querySelector('.json-raw')?.textContent).toContain('event-70');
  const key = Array.from(providers().options).find((option) =>
    option.textContent?.includes('provider-75'),
  )!.value;
  select('Voice provider lifetime', key);
  expect(shadow.querySelector('.json-raw')?.textContent).toContain('event-75');
  expect(providers().selectedOptions[0].textContent).toContain('provider-75');
  expect(providers().options.length).toBeLessThanOrEqual(52);
  fireEvent.input(search(), { target: { value: 'no matching provider' } });
  expect(providers().selectedOptions[0].textContent).toContain('provider-75');
  expect(shadow.querySelector('.json-raw')?.textContent).toContain('event-75');
});

test('unattributed observations remain separate and reachable through bounded provider choices', () => {
  const tools = createDevtools({ initialIsOpen: true });
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: Array.from({ length: 120 }, (_, index) =>
          event(`unattributed-${index}`, 'voice.media', {
            providerInstanceId: undefined,
          }),
        ),
      },
    }),
  );
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'imported');
  click('Voice');
  click('Raw JSON');
  expect(shadow.querySelectorAll('[data-focus-key^="voice:"]')).toHaveLength(
    50,
  );
  const search = shadow.querySelector<HTMLInputElement>(
    'input[aria-label="Search voice providers"]',
  )!;
  fireEvent.input(search, { target: { value: 'unattributed-0' } });
  const providers = shadow.querySelector<HTMLSelectElement>(
    'select[aria-label="Voice provider lifetime"]',
  )!;
  expect(providers.options).toHaveLength(2);
  select('Voice provider lifetime', providers.options[1].value);
  expect(shadow.querySelectorAll('[data-focus-key^="voice:"]')).toHaveLength(1);
  expect(shadow.querySelector('.json-raw')?.textContent).toContain(
    'unattributed-0',
  );
  expect(shadow.querySelector('.voice-events')?.textContent).toContain(
    'Not linked to a turn',
  );
});

test('generation search reaches evidence beyond its initial choice page', () => {
  const tools = createDevtools({ initialIsOpen: true });
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: Array.from({ length: 120 }, (_, index) =>
          event(`generation-${index}`, 'voice.media', { generation: index }),
        ),
      },
    }),
  );
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'imported');
  click('Voice');
  click('Raw JSON');
  const generations = () =>
    shadow.querySelector<HTMLSelectElement>(
      'select[aria-label="Voice generation"]',
    )!;
  expect(generations().options).toHaveLength(51);
  const search = shadow.querySelector<HTMLInputElement>(
    'input[aria-label="Search voice generations"]',
  )!;
  fireEvent.input(search, { target: { value: 'Session generation 75' } });
  expect(generations().options).toHaveLength(2);
  select('Voice generation', generations().options[1].value);
  expect(shadow.querySelector('.json-raw')?.textContent).toContain(
    'generation-75',
  );
  expect(generations().selectedOptions[0].textContent).toBe(
    'Session generation 75',
  );
});

test('live updates keep the selected retained lane visible beyond the newest page', () => {
  const tools = createDevtools({ initialIsOpen: true, maxActivityEvents: 200 });
  const emit = attach(tools);
  for (let index = 0; index < 60; index++)
    emit('voice.media', {
      providerInstanceId: `provider-${index}`,
      marker: `retained-${index}`,
    });
  const { shadow, click } = mount(tools);
  click('Voice');
  click('Raw JSON');
  const lanes = () =>
    Array.from(
      shadow.querySelectorAll<HTMLButtonElement>('[data-focus-key^="voice:"]'),
    );
  fireEvent.click(lanes().at(-1)!);
  expect(shadow.querySelector('.json-raw')?.textContent).toContain(
    'retained-10',
  );
  for (let index = 60; index < 120; index++)
    emit('voice.media', {
      providerInstanceId: `provider-${index}`,
      marker: `retained-${index}`,
    });
  expect(lanes()).toHaveLength(51);
  expect(
    lanes().filter((lane) => lane.getAttribute('aria-pressed') === 'true'),
  ).toHaveLength(1);
  expect(shadow.querySelector('.json-raw')?.textContent).toContain(
    'retained-10',
  );
});

test('voice search keeps the caret and selected text when its query refreshes', async () => {
  const tools = createDevtools({ initialIsOpen: true });
  const emit = attach(tools);
  for (let index = 0; index < 60; index++)
    emit('voice.media', { providerInstanceId: `provider-${index}` });
  const { shadow, click } = mount(tools);
  click('Voice');
  const search = shadow.querySelector<HTMLInputElement>(
    'input[aria-label="Search voice providers"]',
  )!;
  search.focus();
  search.value = 'provider-5';
  search.setSelectionRange(2, 6, 'backward');
  fireEvent.input(search);
  await Promise.resolve();
  const current = shadow.querySelector<HTMLInputElement>(
    'input[aria-label="Search voice providers"]',
  )!;
  expect(shadow.activeElement).toBe(current);
  expect(current.selectionStart).toBe(2);
  expect(current.selectionEnd).toBe(6);
  expect(current.selectionDirection).toBe('backward');
  emit('voice.media', { providerInstanceId: 'provider-new' });
  await Promise.resolve();
  expect(
    shadow.querySelector('input[aria-label="Search voice providers"]'),
  ).toBe(current);
  expect(current.selectionStart).toBe(2);
  expect(current.selectionEnd).toBe(6);
});

test('voice composition survives live updates and publishes its query only when composition ends', () => {
  const tools = createDevtools({ initialIsOpen: true, maxActivityEvents: 100 });
  const emit = attach(tools);
  for (let index = 0; index < 60; index++)
    emit('voice.media', { providerInstanceId: `provider-${index}` });
  const { shadow, click } = mount(tools);
  click('Voice');
  const input = shadow.querySelector<HTMLInputElement>(
    'input[aria-label="Search voice providers"]',
  )!;
  input.focus();
  fireEvent.compositionStart(input);
  input.value = 'provider-5';
  fireEvent.input(input, { isComposing: true });
  emit('voice.media', { providerInstanceId: 'provider-later' });
  expect(input.isConnected).toBe(true);
  expect(shadow.activeElement).toBe(input);
  expect(input.value).toBe('provider-5');
  fireEvent.compositionEnd(input);
  expect(
    shadow.querySelector('input[aria-label="Search voice providers"]'),
  ).toBe(input);
  expect(
    shadow
      .querySelector('select[aria-label="Voice provider lifetime"]')
      ?.querySelectorAll('option'),
  ).toHaveLength(12);
});

test('retention does not remove an active empty voice search at the page threshold', () => {
  const tools = createDevtools({ initialIsOpen: true, maxActivityEvents: 51 });
  const emit = attach(tools);
  for (let index = 0; index < 51; index++)
    emit('voice.media', { providerInstanceId: `provider-${index}` });
  const { shadow, click } = mount(tools);
  click('Voice');
  const input = shadow.querySelector<HTMLInputElement>(
    'input[aria-label="Search voice providers"]',
  )!;
  input.focus();
  emit('voice.media', { providerInstanceId: 'provider-1' });
  expect(
    shadow.querySelector('input[aria-label="Search voice providers"]'),
  ).toBe(input);
  expect(input.isConnected).toBe(true);
  expect(shadow.activeElement).toBe(input);
});

test.each([
  ['Show more voice providers (50 of 51)', 'Voice provider lifetime'],
  ['Show more voice generations (50 of 51)', 'Voice generation'],
  ['Show more voice lanes (50 of 51)', 'Voice provider lifetime'],
  ['Reset voice filters', 'Voice provider lifetime'],
] as const)('finishing %s preserves keyboard focus on a related control', async (action, fallback) => {
  const tools = createDevtools({ initialIsOpen: true });
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: Array.from({ length: 51 }, (_, index) =>
          event(`event-${index}`, 'voice.media', {
            providerInstanceId: `provider-${index}`,
            generation: index,
          }),
        ),
      },
    }),
  );
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'imported');
  click('Voice');
  if (action === 'Reset voice filters') {
    const providers = shadow.querySelector<HTMLSelectElement>(
      'select[aria-label="Voice provider lifetime"]',
    )!;
    select('Voice provider lifetime', providers.options[1].value);
  }
  const target = Array.from(
    shadow.querySelectorAll<HTMLButtonElement>('button'),
  ).find((node) => node.textContent === action)!;
  target.focus();
  fireEvent.click(target);
  await Promise.resolve();
  expect(shadow.activeElement?.getAttribute('aria-label')).toBe(fallback);
});

test('a composition from a replaced import cannot restore the old query or event selection', () => {
  const tools = createDevtools({ initialIsOpen: true });
  const recording = (prefix: string) =>
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: Array.from({ length: 60 }, (_, index) =>
          event(`${prefix}-${index}`, 'voice.media', {
            providerInstanceId: `provider-${index}`,
          }),
        ),
      },
    });
  tools.importCapture(recording('old-source'));
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'imported');
  click('Voice');
  click('Raw JSON');
  const input = shadow.querySelector<HTMLInputElement>(
    'input[aria-label="Search voice providers"]',
  )!;
  input.focus();
  fireEvent.compositionStart(input);
  input.value = 'provider-0';
  fireEvent.input(input, { isComposing: true });
  tools.importCapture(recording('new-source'));
  input.value = 'provider-0';
  fireEvent.compositionEnd(input);
  expect(input.value).toBe('');
  expect(shadow.querySelector('.json-raw')?.textContent).toContain(
    'new-source-59',
  );
  expect(shadow.querySelector('.json-raw')?.textContent).not.toContain(
    'old-source',
  );
});
