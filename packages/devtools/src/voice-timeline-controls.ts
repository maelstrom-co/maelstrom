import type { IdentityAvailability } from './diagnostic-identity.js';
import { button, element } from './panel-elements.js';
import { humanize } from './panel-model.js';
import type { ViewContext } from './panel-views.js';
import type { VoiceLane } from './voice-timeline.js';

const availabilityLabels: Record<IdentityAvailability, string> = {
  reported: 'reported',
  'not-reported': 'not reported',
  redacted: 'redacted',
  truncated: 'truncated',
  unreadable: 'unreadable',
};

export interface VoiceViewState {
  sourceToken?: string;
  provider: string;
  generation: string;
  lane?: string;
  eventKey?: string;
  providerSearch?: string;
  generationSearch?: string;
}

export type VoiceStateChange = (
  next: VoiceViewState,
  resetPage?: boolean,
) => void;

export interface VoiceTimelineControls {
  element: HTMLElement;
  update(
    context: ViewContext,
    state: VoiceViewState,
    lanes: readonly VoiceLane[],
    change: VoiceStateChange,
  ): void;
  clear(): void;
}

export function voiceGenerationLabel(lane: VoiceLane): string {
  const scope =
    lane.scope === 'unreported'
      ? 'Generation'
      : `${humanize(lane.scope)} generation`;
  return `${scope} ${lane.generation ?? availabilityLabels[lane.generationAvailability]}`;
}

export function voiceLifetimeLabel(lane: VoiceLane): string {
  const id = lane.providerInstanceId;
  if (!id) return `Lifetime ${availabilityLabels[lane.providerAvailability]}`;
  return id.length <= 18 ? id : `${id.slice(0, 8)}…${id.slice(-6)}`;
}

function isFocused(node: HTMLElement): boolean {
  const root = node.getRootNode();
  return 'activeElement' in root && root.activeElement === node;
}

interface PickerUpdate {
  value: string;
  options: Map<string, string>;
  query: string;
  source?: string;
  pageSize: number;
  onChoice: (value: string) => void;
  onSearch: (value: string) => void;
  onMore: () => void;
}

function createPicker(name: string, searchLabel: string, items: string) {
  const picker = element('div', undefined, 'voice-picker');
  const searchField = element('label', searchLabel);
  const input = element('input');
  input.type = 'search';
  input.setAttribute('aria-label', searchLabel);
  input.dataset.focusKey = searchLabel;
  searchField.append(input);
  const field = element('label', name);
  const select = element('select');
  select.setAttribute('aria-label', name);
  select.dataset.focusKey = name;
  field.append(select);
  const result = element('span', undefined, 'muted small');
  let choose: (value: string) => void = () => {};
  let search: (value: string) => void = () => {};
  let loadMore = () => {};
  let sourceToken: string | undefined;
  let epoch = 0;
  let compositionEpoch = -1;
  let composing = false;
  let searchable = false;
  let queryValue = '';
  const more = button('', () => loadMore());
  more.dataset.focusKey = `voice-more:${name}`;
  picker.append(searchField, field, result, more);
  select.addEventListener('change', () => choose(select.value));
  input.addEventListener('compositionstart', () => {
    composing = true;
    compositionEpoch = epoch;
  });
  input.addEventListener('compositionend', () => {
    composing = false;
    if (compositionEpoch === epoch) search(input.value);
    else input.value = queryValue;
  });
  input.addEventListener('input', (event) => {
    if (!composing && !(event as InputEvent).isComposing) search(input.value);
  });
  return {
    element: picker,
    update({
      value,
      options,
      query,
      source,
      pageSize,
      onChoice,
      onSearch,
      onMore,
    }: PickerUpdate) {
      choose = onChoice;
      search = onSearch;
      loadMore = onMore;
      queryValue = query;
      if (sourceToken !== source) {
        sourceToken = source;
        epoch++;
        composing = false;
        searchable = false;
      }
      if (!composing && input.value !== query) input.value = query;
      const choices = [...options].filter(([key]) => key !== 'all');
      const queryText = query.trim().toLowerCase();
      const matches = queryText
        ? choices.filter(([key, label]) =>
            `${label} ${key}`.toLowerCase().includes(queryText),
          )
        : choices;
      const shown = matches.slice(0, pageSize);
      const visible = new Map([['all', options.get('all') ?? 'All'], ...shown]);
      if (!visible.has(value))
        visible.set(
          value,
          options.get(value) ?? 'Selection no longer retained',
        );
      const nodes = [...visible].map(([key, label]) => {
        const option = element('option', label);
        option.value = key;
        return option;
      });
      select.replaceChildren(...nodes);
      select.value = value;
      searchable ||= choices.length > 50 || query.length > 0;
      if (!searchable && isFocused(input))
        select.focus({ preventScroll: true });
      searchField.hidden = !searchable;
      result.hidden = !queryText;
      result.textContent = `${matches.length} matching ${items}`;
      more.textContent = `Show more ${items} (${shown.length} of ${matches.length})`;
      const hideMore = matches.length <= shown.length;
      if (hideMore && isFocused(more)) select.focus({ preventScroll: true });
      more.hidden = hideMore;
    },
    focus() {
      select.focus({ preventScroll: true });
    },
    clear() {
      choose = search = () => {};
      loadMore = () => {};
      epoch++;
      sourceToken = undefined;
      composing = searchable = false;
      queryValue = input.value = '';
      select.replaceChildren();
      searchField.hidden = result.hidden = more.hidden = true;
    },
  };
}

export function createVoiceTimelineControls(): VoiceTimelineControls {
  const root = element('div', undefined, 'voice-filters');
  const provider = createPicker(
    'Voice provider lifetime',
    'Search voice providers',
    'voice providers',
  );
  const generation = createPicker(
    'Voice generation',
    'Search voice generations',
    'voice generations',
  );
  let reset = () => {};
  const resetButton = button('Reset voice filters', () => reset());
  root.append(provider.element, generation.element, resetButton);
  return {
    element: root,
    update(context, state, lanes, change) {
      const providers = new Map([['all', 'All voice providers']]);
      for (const lane of lanes)
        providers.set(
          lane.providerKey,
          `${lane.clientId ? context.appLabel(lane.clientId) : 'App not reported'} · ${lane.provider ?? 'Voice'} · ${voiceLifetimeLabel(lane)}`,
        );
      provider.update({
        value: state.provider,
        options: providers,
        query: state.providerSearch ?? '',
        source: state.sourceToken,
        pageSize: context.pageSize,
        onChoice: (value) =>
          change({ provider: value, generation: 'all' }, true),
        onSearch: (providerSearch) => change({ ...state, providerSearch }),
        onMore: context.more,
      });
      const generations = new Map([['all', 'All generations']]);
      for (const lane of lanes)
        if (state.provider === 'all' || lane.providerKey === state.provider)
          generations.set(lane.generationKey, voiceGenerationLabel(lane));
      generation.update({
        value: state.generation,
        options: generations,
        query: state.generationSearch ?? '',
        source: state.sourceToken,
        pageSize: context.pageSize,
        onChoice: (value) =>
          change(
            {
              ...state,
              generation: value,
              lane: undefined,
              eventKey: undefined,
            },
            true,
          ),
        onSearch: (generationSearch) => change({ ...state, generationSearch }),
        onMore: context.more,
      });
      reset = () => change({ provider: 'all', generation: 'all' }, true);
      const hideReset =
        state.provider === 'all' &&
        state.generation === 'all' &&
        !state.providerSearch &&
        !state.generationSearch;
      if (hideReset && isFocused(resetButton)) provider.focus();
      resetButton.hidden = hideReset;
    },
    clear() {
      provider.clear();
      generation.clear();
      reset = () => {};
      resetButton.hidden = true;
    },
  };
}
