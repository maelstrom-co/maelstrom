import { afterEach, expect, jest, test } from 'bun:test';
import {
  createDevtools,
  type DevtoolsOptions,
  mountDevtools,
} from '@maelstrom-co/devtools/production';
import { fireEvent } from '@testing-library/react';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function mount(options: DevtoolsOptions = {}) {
  const tools = createDevtools({ initialIsOpen: true, ...options });
  cleanups.push(() => tools.dispose());
  const unmount = mountDevtools(tools);
  cleanups.push(unmount);
  const shadow = document.querySelector('[data-maelstrom-devtools]')!
    .shadowRoot!;
  const click = (label: string) => {
    const button = Array.from(shadow.querySelectorAll('button')).find(
      (node) => node.textContent === label,
    );
    expect(button).toBeDefined();
    fireEvent.click(button!);
  };
  return { tools, shadow, click, unmount };
}

function snapshot() {
  return {
    state: 'active' as const,
    accepted: 12,
    delivered: 7,
    queued: 2,
    exporting: 1,
    dropped: {
      invalid: 1,
      overflow: 3,
      exportError: 2,
      timeout: 0,
      disabled: 0,
      disposed: 0,
    },
  };
}

test('telemetry health explains local delivery without claiming backend persistence or adding recording evidence', () => {
  const { tools, shadow, click } = mount({
    telemetry: { getSnapshot: snapshot },
  });
  const before = tools.exportCapture();
  click('Telemetry');
  const view = shadow.querySelector(
    '[aria-label="Telemetry delivery health"]',
  )!;
  const facts = Object.fromEntries(
    Array.from(view.querySelectorAll('dl > div')).map((item) => [
      item.querySelector('dt')?.textContent,
      item.querySelector('dd')?.textContent,
    ]),
  );
  expect(facts).toMatchObject({
    State: 'Active',
    Accepted: '12',
    'Exporter acknowledged': '7',
    Queued: '2',
    Exporting: '1',
    'Invalid facts': '1',
    'Capacity overflow': '3',
    'Exporter errors': '2',
  });
  expect(view.textContent).toContain('does not prove backend persistence');
  expect(view.textContent).toContain('not included in recordings');
  expect(tools.getSnapshot().activity).toHaveLength(0);
  expect(tools.exportCapture()).toBe(before);
});

test('health refreshes only while visible and never takes ownership of telemetry', () => {
  jest.useFakeTimers();
  cleanups.push(() => jest.useRealTimers());
  let reads = 0;
  let delivered = 7;
  const forbidden = () => {
    throw new Error('DevTools cannot manage telemetry');
  };
  const telemetry = {
    getSnapshot() {
      reads++;
      return { ...snapshot(), delivered };
    },
    record: forbidden,
    flush: forbidden,
    dispose: forbidden,
  };
  const { shadow, click, unmount } = mount({ telemetry, initialIsOpen: false });
  jest.advanceTimersByTime(2000);
  expect(reads).toBe(0);
  click('◉ Maelstrom');
  jest.advanceTimersByTime(2000);
  expect(reads).toBe(0);
  click('Telemetry');
  expect(reads).toBe(1);
  delivered = 9;
  jest.advanceTimersByTime(1000);
  expect(reads).toBe(2);
  expect(
    shadow.querySelector('[aria-label="Telemetry delivery health"]')!
      .textContent,
  ).toContain('9');
  click('Requests');
  jest.advanceTimersByTime(2000);
  expect(reads).toBe(2);
  click('Telemetry');
  expect(reads).toBe(3);
  click('Close');
  jest.advanceTimersByTime(2000);
  expect(reads).toBe(3);
  click('◉ Maelstrom');
  expect(reads).toBe(4);
  unmount();
  jest.advanceTimersByTime(2000);
  expect(reads).toBe(4);
});

test('an unavailable reader clears stale counts, hides error text, and recovers on the next refresh', () => {
  jest.useFakeTimers();
  cleanups.push(() => jest.useRealTimers());
  let broken = false;
  const { shadow, click } = mount({
    telemetry: {
      getSnapshot() {
        if (broken) throw new Error('private exporter endpoint');
        return snapshot();
      },
    },
  });
  click('Telemetry');
  const view = shadow.querySelector(
    '[aria-label="Telemetry delivery health"]',
  )!;
  broken = true;
  expect(() => jest.advanceTimersByTime(1000)).not.toThrow();
  expect(view.textContent).toContain('Telemetry health is unavailable');
  expect(view.textContent).not.toContain('private exporter endpoint');
  expect(view.querySelector('dl')).toBeNull();
  broken = false;
  jest.advanceTimersByTime(1000);
  expect(view.textContent).toContain('Exporter acknowledged');
  expect(view.textContent).not.toContain('unavailable');
});

test('custom readers cannot display arbitrary state text or malformed counters as health evidence', () => {
  jest.useFakeTimers();
  cleanups.push(() => jest.useRealTimers());
  let value: unknown = { ...snapshot(), state: 'private endpoint' };
  const { shadow, click } = mount({
    telemetry: {
      getSnapshot: () => value as ReturnType<typeof snapshot>,
    },
  });
  click('Telemetry');
  const view = shadow.querySelector(
    '[aria-label="Telemetry delivery health"]',
  )!;
  for (const invalid of [
    value,
    { ...snapshot(), queued: -1 },
    { ...snapshot(), accepted: Number.NaN },
    { ...snapshot(), exporting: 0.5 },
    { ...snapshot(), dropped: {} },
  ]) {
    value = invalid;
    jest.advanceTimersByTime(1000);
    expect(view.textContent).toContain('Telemetry health is unavailable');
    expect(view.textContent).not.toContain('private endpoint');
    expect(view.querySelector('dl')).toBeNull();
  }
  value = {
    ...snapshot(),
    get endpoint() {
      throw new Error('extra fields must not be read');
    },
  };
  jest.advanceTimersByTime(1000);
  expect(view.textContent).toContain('Exporter acknowledged');
});

test('delivery states explain whether the application must configure or replace telemetry', () => {
  jest.useFakeTimers();
  cleanups.push(() => jest.useRealTimers());
  let state: 'active' | 'disabled' | 'timed_out' | 'disposed' = 'active';
  const { shadow, click } = mount({
    telemetry: {
      getSnapshot: () => ({ ...snapshot(), state }),
    },
  });
  click('Telemetry');
  const view = shadow.querySelector(
    '[aria-label="Telemetry delivery health"]',
  )!;
  for (const [next, label, explanation] of [
    ['active', 'Active', 'Accepting facts'],
    ['disabled', 'Disabled', 'No sink configured'],
    ['timed_out', 'Timed out', 'create a new instance'],
    ['disposed', 'Disposed', 'application disposed'],
  ] as const) {
    state = next;
    jest.advanceTimersByTime(1000);
    expect(view.querySelector('dd')!.textContent).toBe(label);
    expect(view.textContent).toContain(explanation);
  }
});

test('an accidentally async reader cannot leave a rejected promise unhandled', async () => {
  const telemetry = {
    getSnapshot: async () => {
      throw new Error('private async failure');
    },
  } as unknown as NonNullable<DevtoolsOptions['telemetry']>;
  const { shadow, click } = mount({ telemetry });
  click('Telemetry');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(
    shadow.querySelector('[aria-label="Telemetry delivery health"]')!
      .textContent,
  ).toContain('Telemetry health is unavailable');
});

test('live telemetry does not pretend to belong to an imported recording or erase its selection', () => {
  const { tools, shadow, click } = mount({
    telemetry: { getSnapshot: snapshot },
  });
  tools.capture.start('test');
  tools.capture.record('app.example', { detail: 'recorded evidence' });
  tools.capture.stop();
  tools.importCapture(tools.exportCapture());
  const source = shadow.querySelector<HTMLSelectElement>(
    '[aria-label="Evidence source"]',
  )!;
  fireEvent.change(source, { target: { value: 'imported' } });
  const selection = shadow.querySelector('.content-pane')!.textContent;
  click('Telemetry');
  expect(source.parentElement!.hidden).toBe(true);
  expect(
    shadow.querySelector('[aria-label="Telemetry delivery health"]')!
      .textContent,
  ).toContain('Live counters');
  click('Requests');
  expect(source.parentElement!.hidden).toBe(false);
  expect(source.value).toBe('imported');
  expect(shadow.querySelector('.content-pane')!.textContent).toBe(selection);
});

test('a missing reader remains distinct from disabled telemetry', () => {
  const { shadow, click } = mount();
  click('Telemetry');
  const view = shadow.querySelector(
    '[aria-label="Telemetry delivery health"]',
  )!;
  expect(view.textContent).toContain('No telemetry reader supplied');
  expect(view.querySelector('dl')).toBeNull();
});

test('duplicate mounts share one reader until the final mount releases it', () => {
  jest.useFakeTimers();
  cleanups.push(() => jest.useRealTimers());
  let reads = 0;
  const { tools, click, unmount } = mount({
    telemetry: {
      getSnapshot() {
        reads++;
        return snapshot();
      },
    },
  });
  const release = mountDevtools(tools);
  cleanups.push(release);
  click('Telemetry');
  jest.advanceTimersByTime(1000);
  expect(reads).toBe(2);
  unmount();
  jest.advanceTimersByTime(1000);
  expect(reads).toBe(3);
  release();
  jest.advanceTimersByTime(2000);
  expect(reads).toBe(3);
});

test('disabled tools never read the supplied telemetry', () => {
  const tools = createDevtools({
    enabled: false,
    telemetry: {
      getSnapshot() {
        throw new Error('disabled tools must not read telemetry');
      },
    },
  });
  const release = mountDevtools(tools);
  expect(document.querySelector('[data-maelstrom-devtools]')).toBeNull();
  release();
  tools.dispose();
});

test('loss exploration stays open across live refreshes and separates current work from lifetime totals', () => {
  jest.useFakeTimers();
  cleanups.push(() => jest.useRealTimers());
  let delivered = 7;
  const { shadow, click } = mount({
    telemetry: {
      getSnapshot: () => ({ ...snapshot(), delivered }),
    },
  });
  click('Telemetry');
  const view = shadow.querySelector(
    '[aria-label="Telemetry delivery health"]',
  )!;
  const reason = Array.from(view.querySelectorAll('dt')).find(
    (node) => node.textContent === 'Exporter deadline',
  )!.parentElement!;
  expect(reason.hidden).toBe(true);
  click('Show all loss counters');
  expect(reason.hidden).toBe(false);
  const scope = view.querySelector('details')!;
  scope.open = true;
  delivered = 9;
  jest.advanceTimersByTime(1000);
  expect(scope.isConnected).toBe(true);
  expect(scope.open).toBe(true);
  expect(reason.hidden).toBe(false);
  expect(view.textContent).toContain('Lifetime');
  expect(view.textContent).toContain('Now');
  expect(view.textContent).toContain('not a failure rate');
});
