import {
  type EventQuery,
  eventFilterChoices,
  queryEvents,
} from './event-query.js';
import { button, element } from './panel-elements.js';
import type { PanelEvent } from './panel-model.js';

const presets: Record<string, EventQuery> = {
  all: {},
  voice: { family: 'voice' },
  engine: { family: 'engine' },
  actions: { family: 'actions' },
  failures: { outcome: 'failed' },
};

export function createEventFilterControls(
  change: (query: EventQuery, resetSearch?: boolean) => void,
) {
  let state: EventQuery = {};
  let previousReset = -1;
  const preset = element('select');
  preset.setAttribute('aria-label', 'Event preset');
  for (const [value, label] of [
    ['all', 'Preset: All events'],
    ['voice', 'Preset: Voice'],
    ['engine', 'Preset: Engine'],
    ['actions', 'Preset: Actions'],
    ['failures', 'Preset: Failures'],
    ['custom', 'Custom filters'],
  ]) {
    const option = element('option', label);
    option.value = value;
    option.disabled = value === 'custom';
    preset.append(option);
  }
  preset.addEventListener('change', () =>
    change({ ...presets[preset.value] }, true),
  );
  const reset = button('Reset', () => change({}, true), 'event-filter-reset');
  reset.setAttribute('aria-label', 'Reset event filters');
  const details = element('details', undefined, 'event-filters');
  const summary = element('summary', 'Event filters');
  const fields = element('div', undefined, 'event-filter-fields');
  function select(
    key: 'family' | 'kind' | 'outcome' | 'requestKey' | 'voiceKey',
    name: string,
    options: string[][],
  ) {
    const label = element('label', name);
    const input = element('select');
    input.setAttribute('aria-label', name);
    syncOptions(input, options, '');
    input.addEventListener('change', () =>
      change({ ...state, [key]: input.value || undefined }),
    );
    label.append(input);
    fields.append(label);
    return input;
  }
  const family = select('family', 'Event family', [
    ['', 'All families'],
    ['voice', 'Voice'],
    ['engine', 'Engine'],
    ['actions', 'Actions'],
    ['client', 'Client'],
    ['other', 'Other'],
  ]);
  const kind = select('kind', 'Event kind', [['', 'All event kinds']]);
  const outcome = select('outcome', 'Event outcome', [
    ['', 'All outcomes'],
    ['started', 'Started'],
    ['succeeded', 'Succeeded'],
    ['succeeded_with_issues', 'Succeeded with issues'],
    ['failed', 'Failed'],
    ['cancelled', 'Cancelled'],
    ['discarded', 'Discarded'],
    ['abandoned', 'Abandoned'],
    ['skipped', 'Skipped'],
    ['unknown', 'Unknown'],
    ['unreported', 'Not reported'],
  ]);
  const request = select('requestKey', 'Request filter', [
    ['', 'All requests'],
  ]);
  const voice = select('voiceKey', 'Voice connection filter', [
    ['', 'All voice connections'],
  ]);
  function time(key: 'from' | 'until', name: string) {
    const label = element('label', name);
    const input = element('input');
    input.type = 'datetime-local';
    input.step = '1';
    input.setAttribute('aria-label', name);
    input.addEventListener('change', () =>
      change({
        ...state,
        [key]: input.validity.badInput
          ? Number.NaN
          : input.value
            ? new Date(input.value).getTime()
            : undefined,
      }),
    );
    label.append(input);
    fields.append(label);
    return input;
  }
  const from = time('from', 'From reported time');
  const until = time('until', 'Until reported time');
  const timeError = element(
    'p',
    'The start must be before or equal to the end. Enter valid local dates.',
    'event-filter-error',
  );
  timeError.setAttribute('role', 'alert');
  const help = element(
    'p',
    'Times use your local time zone. Producer clocks can differ. Events without a valid timestamp do not match an active time bound.',
    'muted small',
  );
  details.append(summary, fields, timeError, help);
  return {
    preset,
    reset,
    element: details,
    update(
      query: EventQuery,
      externalCriteria: boolean,
      events: readonly PanelEvent[],
      appLabel: (id: string) => string,
      resetKey: number,
    ) {
      const forceReset = resetKey !== previousReset;
      previousReset = resetKey;
      state = query;
      family.value = query.family ?? '';
      outcome.value = query.outcome ?? '';
      const choices = eventFilterChoices(events);
      syncOptions(
        kind,
        [
          ['', 'All event kinds'],
          ...choices.kinds.map((value) => [value, value]),
        ],
        query.kind ?? '',
      );
      syncOptions(
        request,
        [
          ['', 'All requests'],
          ...choices.requests.map((value) => [
            value.key,
            `${appLabel(value.clientId)} · Request ${value.requestId}`,
          ]),
        ],
        query.requestKey ?? '',
      );
      syncOptions(
        voice,
        [
          ['', 'All voice connections'],
          ...choices.voices.map((value) => [
            value.key,
            `${appLabel(value.clientId)} · ${value.provider ?? 'Voice'} · ${value.scope} generation ${value.generation} · ${value.providerInstanceId}`,
          ]),
        ],
        query.voiceKey ?? '',
      );
      const invalid = queryEvents([], query).invalidTimeRange;
      timeError.hidden = !invalid;
      for (const [input, value] of [
        [from, query.from],
        [until, query.until],
      ] as const) {
        input.setAttribute('aria-invalid', String(invalid));
        const root = input.getRootNode();
        if (
          !forceReset &&
          'activeElement' in root &&
          root.activeElement === input
        )
          continue;
        if (value === undefined || !Number.isFinite(value)) {
          if (forceReset || input.value) input.value = '';
        } else if (
          value !== undefined &&
          Number.isFinite(value) &&
          new Date(input.value).getTime() !== value
        ) {
          const date = new Date(value);
          const pad = (part: number) => String(part).padStart(2, '0');
          input.value = `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
        }
      }
      summary.textContent = `Event filters${Object.values(query).some((value) => value !== undefined && value !== '') ? ' · active' : ''}`;
      preset.value = externalCriteria
        ? 'custom'
        : (Object.entries(presets).find(([, criteria]) =>
            (
              Object.keys({ ...query, ...criteria }) as (keyof EventQuery)[]
            ).every((key) => query[key] === criteria[key]),
          )?.[0] ?? 'custom');
    },
  };
}

function syncOptions(
  input: HTMLSelectElement,
  entries: string[][],
  selected: string,
) {
  if (selected && !entries.some(([value]) => value === selected))
    entries.push([
      selected,
      'Selection outside this app scope or no longer retained',
    ]);
  const current = new Map(
    Array.from(input.options, (option) => [option.value, option]),
  );
  const valid = new Set(entries.map(([value]) => value));
  for (const [value, option] of current) if (!valid.has(value)) option.remove();
  for (const [value, label] of entries) {
    let option = current.get(value);
    if (!option) {
      option = element('option');
      option.value = value;
      input.append(option);
    }
    if (option.textContent !== label) option.textContent = label;
  }
  if (input.value !== selected) input.value = selected;
}
