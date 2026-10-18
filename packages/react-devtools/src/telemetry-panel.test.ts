import { afterEach, expect, jest, test } from 'bun:test';
import {
  createDevtools,
  type DevtoolsOptions,
  mountDevtools,
} from '@maelstrom-co/devtools/production';
import { fireEvent, isInaccessible } from '@testing-library/react';

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

type SnapshotState = ReturnType<
  NonNullable<DevtoolsOptions['telemetry']>['getSnapshot']
>['state'];

function snapshot() {
  return {
    state: 'active' as SnapshotState,
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

function observe(telemetry: NonNullable<DevtoolsOptions['telemetry']>) {
  jest.useFakeTimers();
  cleanups.push(() => jest.useRealTimers());
  let elapsed = 0;
  const clock = jest
    .spyOn(performance, 'now')
    .mockImplementation(() => elapsed);
  cleanups.push(() => clock.mockRestore());
  return {
    ...mount({ telemetry }),
    advanceTo(time: number, timerMs = 1000) {
      elapsed = time;
      jest.advanceTimersByTime(timerMs);
    },
  };
}

test('delivery trends use actual elapsed time and expose the exact sampled counters', () => {
  let current = snapshot();
  const { shadow, click, advanceTo } = observe({ getSnapshot: () => current });
  click('Telemetry');
  const trends = shadow.querySelector(
    '[aria-label="Telemetry delivery trends"]',
  );
  expect(trends).not.toBeNull();
  current = {
    ...current,
    accepted: 19,
    delivered: 14,
    queued: 4,
    dropped: { ...current.dropped, overflow: 5 },
  };
  advanceTo(3500);
  const totals = trends!.querySelector(
    '[aria-label="Observed interval totals"]',
  )!;
  const values = Object.fromEntries(
    Array.from(totals.querySelectorAll('div')).map((item) => [
      item.querySelector('dt')?.textContent,
      item.querySelector('dd')?.textContent,
    ]),
  );
  expect(values).toEqual({
    'Accepted in window': '+7 · 2/s',
    'Acknowledged in window': '+7 · 2/s',
    'Lost in window': '+2 · 0.57/s',
  });
  const selected = trends!.querySelector(
    '[aria-label="Selected telemetry sample"]',
  )!;
  expect(JSON.parse(selected.querySelector('pre')!.textContent!)).toEqual(
    current,
  );
  expect(trends!.textContent).toContain('3.5 s observed');
});

test('selected samples explain their own elapsed intervals beside exact lifetime counters', () => {
  let current = snapshot();
  const { shadow, click, advanceTo } = observe({ getSnapshot: () => current });
  click('Telemetry');
  current = {
    ...current,
    accepted: 19,
    delivered: 14,
    dropped: { ...current.dropped, overflow: 5 },
  };
  const second = current;
  advanceTo(3500);
  const details = shadow.querySelector(
    '[aria-label="Selected telemetry sample"]',
  )!;
  const interval = details.querySelector(
    '[aria-label="Selected sample interval"]',
  );
  expect(interval).not.toBeNull();
  const values = () =>
    Object.fromEntries(
      Array.from(interval!.querySelectorAll('div')).map((item) => [
        item.querySelector('dt')!.textContent,
        item.querySelector('dd')!.textContent,
      ]),
    );
  expect(values()).toEqual({
    'Elapsed time': '3.5 s',
    Accepted: '+7 · 2/s',
    Acknowledged: '+7 · 2/s',
    Lost: '+2 · 0.57/s',
  });
  current = {
    ...current,
    accepted: 24,
    delivered: 15,
    dropped: { ...current.dropped, overflow: 6 },
  };
  advanceTo(4750);
  expect(values()).toEqual({
    'Elapsed time': '1.25 s',
    Accepted: '+5 · 4/s',
    Acknowledged: '+1 · 0.8/s',
    Lost: '+1 · 0.8/s',
  });
  fireEvent.click(
    shadow.querySelector('[aria-label="Select telemetry sample 2"]')!,
  );
  expect(values()['Elapsed time']).toBe('3.5 s');
  expect(values().Accepted).toBe('+7 · 2/s');
  expect(JSON.parse(details.querySelector('pre')!.textContent!)).toEqual(
    second,
  );
});

test('returning to telemetry preserves history without attributing unobserved work to the window', () => {
  let accepted = 12;
  const { shadow, click, advanceTo } = observe({
    getSnapshot: () => ({ ...snapshot(), accepted }),
  });
  click('Telemetry');
  accepted = 14;
  advanceTo(1000);
  click('Requests');
  accepted = 100;
  advanceTo(6000, 5000);
  click('Telemetry');
  const trends = shadow.querySelector(
    '[aria-label="Telemetry delivery trends"]',
  )!;
  expect(trends.textContent).toContain('View was hidden');
  expect(trends.textContent).toContain('3 samples · 1 s observed');
  expect(trends.textContent).toContain('+2 · 2/s');
  accepted = 104;
  advanceTo(7000);
  expect(trends.textContent).toContain('4 samples · 2 s observed');
  expect(trends.textContent).toContain('+6 · 3/s');
  const queue = trends.querySelector(
    'svg[aria-label="Queue depth and exporter activity"] path[data-series="Queued"]',
  )!;
  expect(queue.getAttribute('d')!.match(/M/g)).toHaveLength(2);
});

test.each([
  'accepted',
  'delivered',
  'overflow',
] as const)('a reset of %s starts a new interval instead of inventing a negative rate', (counter) => {
  let current = snapshot();
  const { shadow, click, advanceTo } = observe({ getSnapshot: () => current });
  click('Telemetry');
  current = {
    ...current,
    accepted: 16,
    delivered: 9,
    dropped: { ...current.dropped, overflow: 4 },
  };
  advanceTo(1000);
  current = {
    ...current,
    accepted: counter === 'accepted' ? 0 : 116,
    delivered: counter === 'delivered' ? 0 : 109,
    dropped: {
      ...current.dropped,
      invalid: 51,
      overflow: counter === 'overflow' ? 0 : 54,
    },
  };
  advanceTo(2000);
  const trends = shadow.querySelector(
    '[aria-label="Telemetry delivery trends"]',
  )!;
  expect(trends.textContent).toContain('Counters reset');
  expect(trends.textContent).toContain('3 samples · 1 s observed');
  expect(trends.textContent).toContain('+4 · 4/s');
  expect(trends.textContent).toContain('+2 · 2/s');
  expect(trends.textContent).toContain('+1 · 1/s');
});

test('a replacement reader cannot turn another telemetry lifetime into a delivery spike', () => {
  const telemetry = { getSnapshot: snapshot };
  const { shadow, click, advanceTo } = observe(telemetry);
  click('Telemetry');
  let accepted = 120;
  telemetry.getSnapshot = () => ({ ...snapshot(), accepted });
  advanceTo(1000);
  const trends = shadow.querySelector(
    '[aria-label="Telemetry delivery trends"]',
  )!;
  expect(trends.textContent).toContain('Reader changed');
  expect(trends.textContent).toContain('2 samples · 0 s observed');
  accepted = 124;
  advanceTo(2000);
  expect(trends.textContent).toContain('+4 · 4/s');
  expect(trends.textContent).toContain('3 samples · 1 s observed');
});

test('failed reads remain visible and recovery cannot bridge missing delivery evidence', () => {
  let broken = false;
  let accepted = 12;
  const { shadow, click, advanceTo } = observe({
    getSnapshot() {
      if (broken) throw new Error('private exporter endpoint');
      return { ...snapshot(), accepted };
    },
  });
  click('Telemetry');
  accepted = 13;
  advanceTo(1000);
  broken = true;
  advanceTo(2000);
  const trends = shadow.querySelector(
    '[aria-label="Telemetry delivery trends"]',
  );
  expect(trends).not.toBeNull();
  expect(trends!.textContent).toContain('Read unavailable');
  expect(trends!.textContent).toContain('Counters unavailable for this sample');
  expect(
    isInaccessible(
      trends!.querySelector('[aria-label="Selected sample interval"]')!,
    ),
  ).toBe(true);
  expect(shadow.querySelector('[aria-label="Delivery flow"]')).toBeNull();
  expect(shadow.textContent).not.toContain('private exporter endpoint');
  broken = false;
  accepted = 100;
  advanceTo(3000);
  expect(trends!.textContent).toContain('4 samples · 1 s observed');
  expect(trends!.textContent).toContain('+1 · 1/s');
  expect(trends!.textContent).toContain(
    'No comparable interval: Read unavailable.',
  );
  accepted = 102;
  advanceTo(4000);
  expect(trends!.textContent).toContain('5 samples · 2 s observed');
  expect(trends!.textContent).toContain('+3 · 1.5/s');
  const queue = trends!.querySelector(
    'svg[aria-label="Queue depth and exporter activity"] path[data-series="Queued"]',
  )!;
  expect(queue.getAttribute('d')!.match(/M/g)).toHaveLength(2);
});

test.each([
  ['Queue depth and exporter activity', false, 2],
  ['Local delivery rates', true, 3],
] as const)('%s keeps an isolated observation visible after a failed read', (title, needsInterval, seriesCount) => {
  let broken = false;
  let accepted = 12;
  const { shadow, click, advanceTo } = observe({
    getSnapshot() {
      if (broken) throw new Error('unavailable');
      return { ...snapshot(), accepted };
    },
  });
  click('Telemetry');
  if (needsInterval) {
    accepted = 19;
    advanceTo(1000);
  }
  broken = true;
  advanceTo(2000);
  const chart = shadow.querySelector(`svg[aria-label="${title}"]`)!;
  expect(chart.querySelectorAll('circle')).toHaveLength(seriesCount);
  for (const path of chart.querySelectorAll('path')) {
    expect(path.getAttribute('d')).toContain('M');
    expect(path.getAttribute('d')).not.toContain('L');
  }
});

test.each([
  false,
  true,
])('trend retention bounds successful and unavailable reads (unavailable: %s)', (unavailable) => {
  let accepted = 12;
  const { shadow, click, advanceTo } = observe({
    getSnapshot() {
      if (unavailable) throw new Error('unavailable');
      return { ...snapshot(), accepted };
    },
  });
  click('Telemetry');
  for (let index = 1; index <= 130; index++) {
    accepted = 12 + index;
    advanceTo(index * 1000);
  }
  const trends = shadow.querySelector(
    '[aria-label="Telemetry delivery trends"]',
  )!;
  expect(trends.textContent).toContain('120 samples');
  expect(trends.textContent).toContain('11 older samples expired');
  if (!unavailable) {
    expect(trends.textContent).toContain('119 s observed');
    expect(trends.textContent).toContain('+119 · 1/s');
  }
});

test('sample exploration keeps its evidence and keyboard focus while live telemetry grows', () => {
  let current = snapshot();
  const { shadow, click, advanceTo } = observe({ getSnapshot: () => current });
  click('Telemetry');
  const table = shadow.querySelector('[aria-label="Telemetry samples"]');
  expect(table).not.toBeNull();
  expect(
    shadow.querySelector('svg[aria-label="Queue depth and exporter activity"]'),
  ).not.toBeNull();
  expect(
    shadow.querySelector('svg[aria-label="Local delivery rates"]'),
  ).not.toBeNull();
  const first = table!.querySelector<HTMLButtonElement>(
    '[aria-label="Select telemetry sample 1"]',
  )!;
  fireEvent.click(first);
  first.focus();
  current.dropped.overflow = 99;
  current = { ...current, accepted: 19 };
  advanceTo(1000);
  const counters = () =>
    JSON.parse(
      shadow.querySelector('[aria-label="Selected telemetry sample"] pre')!
        .textContent!,
    );
  expect(counters().accepted).toBe(12);
  expect(counters().dropped.overflow).toBe(3);
  expect(shadow.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  const second = table!.querySelector(
    '[aria-label="Select telemetry sample 2"]',
  );
  expect(shadow.activeElement).toBe(second);
  expect(counters().accepted).toBe(19);
  click('Follow latest');
  current = { ...current, accepted: 23 };
  advanceTo(2000);
  expect(counters().accepted).toBe(23);
  expect(table!.querySelectorAll('tbody tr')).toHaveLength(3);
});

test('arrow navigation starts at the focused row when follow mode advances without activation', () => {
  const { shadow, click, advanceTo } = observe({ getSnapshot: snapshot });
  click('Telemetry');
  const first = shadow.querySelector<HTMLButtonElement>(
    '[aria-label="Select telemetry sample 1"]',
  )!;
  first.focus();
  advanceTo(1000);
  advanceTo(2000);
  expect(shadow.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  expect(shadow.activeElement?.getAttribute('aria-label')).toBe(
    'Select telemetry sample 2',
  );
});

test('rates exclude an expired baseline even when it would dominate the retained chart', () => {
  let accepted = 12;
  const { shadow, click, advanceTo } = observe({
    getSnapshot: () => ({ ...snapshot(), accepted }),
  });
  click('Telemetry');
  for (let index = 1; index <= 130; index++) {
    accepted = index < 11 ? 12 + index : 10000 + index - 11;
    advanceTo(index * 1000);
  }
  const rates = shadow.querySelector('svg[aria-label="Local delivery rates"]')!;
  expect(
    Array.from(rates.querySelectorAll('text')).map(
      (label) => label.textContent,
    ),
  ).toEqual(['0', '0.5', '1']);
  fireEvent.click(
    shadow.querySelector('[aria-label="Select telemetry sample 12"]')!,
  );
  const details = shadow.querySelector(
    '[aria-label="Selected telemetry sample"]',
  )!;
  expect(details.textContent).toContain('The previous observation expired');
  expect(
    isInaccessible(
      details.querySelector('[aria-label="Selected sample interval"]')!,
    ),
  ).toBe(true);
});

test.each([
  'invalid',
  'overflow',
  'exportError',
  'timeout',
  'disabled',
  'disposed',
] as const)('%s losses remain visible even without newly accepted facts', (reason) => {
  let current = snapshot();
  const { shadow, click, advanceTo } = observe({ getSnapshot: () => current });
  click('Telemetry');
  current = {
    ...current,
    state:
      reason === 'disposed'
        ? 'disposed'
        : reason === 'timeout' || reason === 'disabled'
          ? 'timed_out'
          : 'active',
    dropped: { ...current.dropped, [reason]: current.dropped[reason] + 4 },
  };
  advanceTo(1000);
  const totals = shadow.querySelector(
    '[aria-label="Observed interval totals"]',
  )!;
  expect(totals.textContent).toContain('Lost in window+4 · 4/s');
  expect(totals.textContent).toContain('Accepted in window+0 · 0/s');
  const json = shadow.querySelector(
    '[aria-label="Selected telemetry sample"] pre',
  )!;
  expect(JSON.parse(json.textContent!).dropped[reason]).toBe(
    current.dropped[reason],
  );
});

test('an expired selection reports missing evidence and restores a usable keyboard target', () => {
  let accepted = 12;
  const { shadow, click, advanceTo } = observe({
    getSnapshot: () => ({ ...snapshot(), accepted }),
  });
  click('Telemetry');
  const first = shadow.querySelector<HTMLButtonElement>(
    '[aria-label="Select telemetry sample 1"]',
  )!;
  fireEvent.click(first);
  first.focus();
  for (let index = 1; index <= 130; index++) {
    accepted = 12 + index;
    advanceTo(index * 1000);
  }
  const details = shadow.querySelector(
    '[aria-label="Selected telemetry sample"]',
  )!;
  expect(details.textContent).toContain('Selected sample expired');
  expect(details.querySelector('pre')!.textContent).toBe('');
  expect(shadow.activeElement?.textContent).toBe('Follow latest');
  const latest = shadow.querySelector<HTMLButtonElement>(
    '[aria-label="Select telemetry sample 131"]',
  )!;
  expect(latest.tabIndex).toBe(0);
  expect(latest.getAttribute('aria-pressed')).toBe('false');
  expect(
    shadow
      .querySelector('.telemetry-trend-heading button')!
      .getAttribute('aria-pressed'),
  ).toBe('false');
  latest.focus();
  fireEvent.keyDown(latest, { key: 'Home' });
  expect(shadow.activeElement?.getAttribute('aria-label')).toBe(
    'Select telemetry sample 12',
  );
  expect(JSON.parse(details.querySelector('pre')!.textContent!).accepted).toBe(
    23,
  );
  click('Follow latest');
  expect(JSON.parse(details.querySelector('pre')!.textContent!).accepted).toBe(
    142,
  );
});

test('returning from telemetry restores the view heading and help to the accessibility tree', () => {
  const { shadow, click } = mount({ telemetry: { getSnapshot: snapshot } });
  const heading = Array.from(shadow.querySelectorAll('h2')).find(
    (node) => node.textContent === 'Request activity',
  )!;
  const help = Array.from(shadow.querySelectorAll('summary')).find(
    (node) => node.textContent === 'Using DevTools',
  )!;
  expect(heading).toBeDefined();
  expect(help).toBeDefined();
  expect(isInaccessible(heading)).toBe(false);
  expect(isInaccessible(help)).toBe(false);
  click('Telemetry');
  expect(isInaccessible(heading)).toBe(true);
  expect(isInaccessible(help)).toBe(true);
  click('Requests');
  expect(isInaccessible(heading)).toBe(false);
  expect(isInaccessible(help)).toBe(false);
});

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
    Array.from(view.querySelectorAll('dl > div'))
      .filter(
        (item) => !item.closest('[aria-label="Telemetry delivery trends"]'),
      )
      .map((item) => [
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
  expect(view.querySelector('[aria-label="Delivery flow"]')).toBeNull();
  broken = false;
  jest.advanceTimersByTime(1000);
  expect(view.textContent).toContain('Exporter acknowledged');
  expect(view.textContent).not.toContain('Telemetry health is unavailable');
  expect(view.querySelector('[aria-label="Delivery flow"]')).not.toBeNull();
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
    expect(view.querySelector('[aria-label="Delivery flow"]')).toBeNull();
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
