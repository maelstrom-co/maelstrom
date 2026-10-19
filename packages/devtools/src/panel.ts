import { createEffect, createSignal, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { captureImportFileBytes } from './capture-import.js';
import { createJsonInspector } from './json-inspector.js';
import {
  countUnreadableEvents,
  errorCategories,
  type Fields,
  groupRequests,
  identity,
  MAX_VIEW_EVENTS,
  type PanelApp,
  type PanelEvidence,
  panelEvents,
  recordingEvidence,
  text,
} from './panel-model.js';
import { panelStyle } from './panel-style.js';
import {
  button,
  connectionsView,
  element,
  factList,
  inspectorView,
  type RenderedView,
  type RequestComparisonSelection,
  requestsView,
  type ViewContext,
} from './panel-views.js';
import { telemetryView } from './telemetry-view.js';
import type { Devtools, DevtoolsSnapshot } from './types.js';

type Source = 'live' | 'recording' | 'imported';
const tabs = [
  'Requests',
  'Inspector',
  'Connections',
  'Recordings',
  'Telemetry',
] as const;
type Tab = (typeof tabs)[number];
interface PanelPreferences {
  open: boolean;
  tab: Tab;
  selected: string;
  query: string;
  issueCategory?: string;
  requestKey: string;
  eventKey: string;
  instanceKey: string;
  allEvents: boolean;
  source: Source;
  recordingTarget?: string;
  overlays: boolean;
  highlight: boolean;
  json: boolean;
  jsonMode?: 'tree' | 'raw';
  phaseBars?: boolean;
  phasePage?: ViewContext['phasePage'];
  stageTimingLimit?: ViewContext['stageTimingLimit'];
  layoutView?: ViewContext['layoutView'];
  height?: number;
  labels: Map<string, string>;
  nextLabel: number;
  importedName?: string;
  liveEventKeys: WeakMap<Fields, string>;
}
const preferencesByTools = new WeakMap<Devtools, PanelPreferences>();
const mountedPanels = new WeakMap<
  Devtools,
  { references: number; dispose: () => void }
>();

function Panel(tools: Devtools): HTMLElement {
  const preferences: PanelPreferences = preferencesByTools.get(tools) ?? {
    open: tools.options.initialIsOpen ?? false,
    tab: 'Requests',
    selected: 'all',
    query: '',
    requestKey: '',
    eventKey: '',
    instanceKey: '',
    allEvents: false,
    source: 'live',
    overlays: false,
    highlight: true,
    json: true,
    labels: new Map(),
    nextLabel: 1,
    liveEventKeys: new WeakMap(),
  };
  preferencesByTools.set(tools, preferences);
  const [snapshot, setSnapshot] = createSignal(tools.getSnapshot());
  const [captureStatus, setCaptureStatus] = createSignal(
    tools.capture.getSnapshot(),
  );
  const [open, setOpen] = createSignal(preferences.open);
  const [tab, setTab] = createSignal<Tab>(preferences.tab);
  const [selected, setSelected] = createSignal(preferences.selected);
  const [query, setQuery] = createSignal(preferences.query);
  const [source, setSource] = createSignal<Source>(preferences.source);
  const [recordingTarget, setRecordingTarget] = createSignal(
    preferences.recordingTarget ?? 'all',
  );
  const [revision, setRevision] = createSignal(0);
  const [error, setError] = createSignal('');
  let pinnedRequest: string | undefined;
  let comparison: RequestComparisonSelection | undefined;
  let captureEpoch = 0;
  let previousCapture = tools.capture.getSnapshot();
  let previousEvidenceRevision = tools.capture.getEvidenceRevision?.() ?? 0;
  let headerMetadata: Fields | undefined;
  let cachedRecording: PanelEvidence | undefined;
  let recordingKey = '';
  let importedReference: unknown;
  let previousImport = snapshot().imported;
  let cachedImport: PanelEvidence | undefined;
  let liveReference: DevtoolsSnapshot | undefined;
  let cachedLive: PanelEvidence | undefined;
  const inspections = new Map<
    string,
    { baseline: unknown; inspection: unknown }
  >();
  const refresh = () => setRevision((value) => value + 1);
  const update = () => {
    const nextSnapshot = tools.getSnapshot();
    if (nextSnapshot.imported !== previousImport) {
      if (source() === 'imported') clearRequestSelection();
      previousImport = nextSnapshot.imported;
      cachedImport = undefined;
      importedReference = undefined;
    }
    const next = tools.capture.getSnapshot();
    const evidenceRevision = tools.capture.getEvidenceRevision?.() ?? 0;
    if (evidenceRevision !== previousEvidenceRevision) {
      cachedRecording = undefined;
      recordingKey = '';
      if (
        next.count < previousCapture.count ||
        (next.count === previousCapture.count &&
          next.dropped === previousCapture.dropped)
      ) {
        headerMetadata = undefined;
        if (source() === 'recording' && comparison) clearRequestSelection();
      }
    }
    if (
      (next.active && !previousCapture.active) ||
      (next.count === 0 && previousCapture.count > 0)
    ) {
      captureEpoch++;
      if (source() === 'recording') {
        clearRequestSelection();
      }
      headerMetadata = undefined;
      cachedRecording = undefined;
      recordingKey = '';
    }
    previousCapture = next;
    previousEvidenceRevision = evidenceRevision;
    setSnapshot(nextSnapshot);
    setCaptureStatus(next);
  };
  onCleanup(tools.subscribe(update));
  onCleanup(tools.capture.subscribe(update));
  onCleanup(() => tools.setHighlightedInstance?.());

  function safe(operation: () => void): void {
    try {
      operation();
      setError('');
    } catch {
      setError(
        'DevTools could not complete this action. Check the recording format, configured limits, and app redaction policy.',
      );
    }
  }
  function readRecording(): PanelEvidence | undefined {
    const status = captureStatus();
    if (status.count === 0) return undefined;
    const key = JSON.stringify([
      captureEpoch,
      status.count,
      status.dropped,
      status.mode,
    ]);
    if (!status.active && cachedRecording && recordingKey === key)
      return { ...cachedRecording, note: status.outcome || undefined };
    try {
      const evidence = recordingEvidence(JSON.parse(tools.capture.export()));
      headerMetadata = evidence.metadata;
      if (!status.active) {
        cachedRecording = evidence;
        recordingKey = key;
      }
      return evidence;
    } catch {
      return undefined;
    }
  }
  function recordingMetadata(): Fields {
    if (!headerMetadata && captureStatus().count > 0) readRecording();
    return headerMetadata ?? {};
  }
  function liveEvidence(state: DevtoolsSnapshot): PanelEvidence {
    if (liveReference !== state || !cachedLive) {
      liveReference = state;
      cachedLive = {
        events: panelEvents(state.activity, preferences.liveEventKeys),
        requestEvents: panelEvents(
          state.requestActivity,
          preferences.liveEventKeys,
        ),
        droppedRequestEvents: state.droppedRequestEvents,
        omittedRequestEvents: Math.max(
          0,
          state.requestActivity.length - MAX_VIEW_EVENTS,
        ),
        apps: state.sessions.map((session) => ({
          id: session.id,
          active: session.active,
          inspection: session.snapshot,
        })),
        dropped: state.droppedActivityEvents,
        omitted: Math.max(0, state.activity.length - MAX_VIEW_EVENTS),
        unreadableEvents:
          countUnreadableEvents(state.activity) +
          countUnreadableEvents(state.requestActivity),
        metadata: {},
      };
    }
    return cachedLive;
  }
  function importedEvidence(value: unknown): PanelEvidence {
    if (value !== importedReference || !cachedImport) {
      importedReference = value;
      cachedImport = recordingEvidence(value);
    }
    return cachedImport;
  }
  function evidence(): PanelEvidence {
    const state = snapshot();
    if (source() === 'imported') return importedEvidence(state.imported);
    if (source() === 'recording')
      return (
        readRecording() ?? { events: [], apps: [], omitted: 0, metadata: {} }
      );
    return liveEvidence(state);
  }
  function appLabel(id: string): string {
    let label = preferences.labels.get(id);
    if (!label) {
      label = `App instance ${preferences.nextLabel++}`;
      preferences.labels.set(id, label);
    }
    return label;
  }
  function recordingScope(metadata: Fields = recordingMetadata()): string {
    if (metadata.scope === 'all-providers') return 'All app instances';
    if (metadata.scope === 'provider') {
      const id = identity(metadata.providerInstanceId);
      const known =
        id &&
        (snapshot().sessions.some((session) => session.id === id) ||
          cachedRecording?.apps.some((app) => app.id === id) ||
          cachedImport?.apps.some((app) => app.id === id));
      return id && known
        ? appLabel(id)
        : 'Selected scope · app identity unavailable';
    }
    return 'Scope not reported';
  }
  function inspect(app: PanelApp): unknown {
    if (source() !== 'live') return app.inspection;
    if (app.active !== true) {
      inspections.delete(app.id);
      return tools.inspect(app.id);
    }
    const previous = inspections.get(app.id);
    if (!previous || previous.baseline !== app.inspection) {
      const inspection = tools.inspect(app.id);
      inspections.set(app.id, { baseline: app.inspection, inspection });
      return inspection;
    }
    return previous.inspection;
  }
  function clearRequestSelection(): void {
    pinnedRequest = undefined;
    comparison = undefined;
    preferences.requestKey = '';
    preferences.eventKey = '';
    preferences.phasePage = undefined;
    preferences.stageTimingLimit = undefined;
    preferences.layoutView = undefined;
  }
  function switchSource(next: Source): void {
    clearRequestSelection();
    preferences.issueCategory = 'all';
    preferences.instanceKey = '';
    setSelected('all');
    setSource(next);
    setQuery('');
    pageSize = 50;
    const candidate =
      next === 'imported'
        ? importedEvidence(snapshot().imported)
        : next === 'recording'
          ? readRecording()
          : liveEvidence(snapshot());
    preferences.allEvents =
      next !== 'live' &&
      candidate !== undefined &&
      groupRequests(candidate.events).length === 0;
    refresh();
  }

  const root = element('div');
  const trigger = button(
    '◉ Maelstrom',
    () => {
      setOpen(true);
      queueMicrotask(() => close.focus());
    },
    'trigger',
  );
  trigger.setAttribute('aria-label', 'Open Maelstrom Devtools');
  if ((tools.options.position ?? '').startsWith('top')) {
    trigger.style.top = '18px';
    trigger.style.bottom = 'auto';
  }
  if ((tools.options.position ?? '').endsWith('left')) {
    trigger.style.left = '18px';
    trigger.style.right = 'auto';
  }
  const panel = element('section', undefined, 'panel');
  panel.setAttribute('aria-label', 'Maelstrom Devtools');
  if (preferences.height) panel.style.height = `${preferences.height}px`;
  const resize = element('div', undefined, 'resize');
  resize.tabIndex = 0;
  resize.setAttribute('role', 'separator');
  resize.setAttribute('aria-label', 'Resize devtools');
  resize.setAttribute('aria-orientation', 'horizontal');
  resize.setAttribute('aria-valuemin', '260');
  resize.setAttribute(
    'aria-valuemax',
    String(Math.round(window.innerHeight * 0.9)),
  );
  resize.setAttribute(
    'aria-valuenow',
    String(preferences.height ?? Math.min(620, window.innerHeight * 0.72)),
  );
  function resizeTo(height: number): void {
    const bounded = Math.min(window.innerHeight * 0.9, Math.max(260, height));
    panel.style.height = `${bounded}px`;
    preferences.height = bounded;
    resize.setAttribute('aria-valuenow', String(Math.round(bounded)));
  }
  resize.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      resizeTo(
        panel.getBoundingClientRect().height +
          (event.key === 'ArrowUp' ? 24 : -24),
      );
    }
  });
  resize.addEventListener('pointerdown', (event) =>
    resize.setPointerCapture(event.pointerId),
  );
  resize.addEventListener('pointermove', (event) => {
    if (resize.hasPointerCapture(event.pointerId))
      resizeTo(window.innerHeight - event.clientY);
  });
  const header = element('div', undefined, 'header');
  const brand = element('div', undefined, 'brand');
  brand.append(
    element('span', 'Maelstrom'),
    document.createTextNode(' Devtools'),
  );
  const sourceLabel = element('label', 'Evidence '),
    sourceSelect = element('select');
  sourceSelect.setAttribute('aria-label', 'Evidence source');
  const liveOption = element('option', 'Live activity');
  liveOption.value = 'live';
  const recordedOption = element('option', 'Current recording');
  recordedOption.value = 'recording';
  const importedOption = element('option', 'Imported recording');
  importedOption.value = 'imported';
  sourceSelect.append(liveOption, recordedOption, importedOption);
  sourceLabel.append(sourceSelect);
  sourceSelect.addEventListener('change', () =>
    switchSource(sourceSelect.value as Source),
  );
  const scopeLabel = element('label', 'App instance '),
    selector = element('select');
  selector.setAttribute('aria-label', 'App instance');
  scopeLabel.append(selector);
  const singleScope = element('span', undefined, 'muted small');
  selector.addEventListener('change', () => {
    clearRequestSelection();
    setSelected(selector.value);
    preferences.instanceKey = '';
    pageSize = 50;
  });
  const close = button('Close', () => {
    setOpen(false);
    trigger.focus();
  });
  close.classList.add('header-close');
  const headerControls = element('div', undefined, 'header-controls');
  headerControls.append(sourceLabel, scopeLabel, singleScope);
  const tabList = element('div', undefined, 'tabs');
  tabList.setAttribute('role', 'tablist');
  tabList.setAttribute('aria-label', 'Diagnostic views');
  const id = `maelstrom-tools-${crypto.randomUUID()}`;
  const tabButtons = tabs.map((name) => {
    const node = button(name, () => {
      setTab(name);
      pageSize = 50;
    });
    node.id = `${id}-${name}`;
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-controls', `${id}-body`);
    tabList.append(node);
    return node;
  });
  tabList.addEventListener('keydown', (event) => {
    const current = tabs.indexOf(tab());
    const next =
      event.key === 'ArrowRight'
        ? (current + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (current + tabs.length - 1) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    setTab(tabs[next]);
    tabButtons[next].focus();
  });
  header.append(brand, tabList, headerControls, close);
  const body = element('div', undefined, 'body');
  body.id = `${id}-body`;
  body.setAttribute('role', 'tabpanel');
  const title = element('h2'),
    description = element('p', undefined, 'muted');
  const help = element('details', undefined, 'help');
  help.append(
    element('summary', 'Using DevTools'),
    description,
    element(
      'p',
      'Live activity keeps recent metadata. Requests groups it by request. All events also shows connection, voice, and other events.',
    ),
    element(
      'p',
      'Start a recording before reproducing a problem to capture supported content. Stop to inspect or export it. Earlier prompts and arguments cannot be recovered.',
    ),
    element(
      'p',
      'Each attached client is an app instance. React creates one per mounted Provider. Recent history can include ended instances. Connections also shows voice providers.',
    ),
  );
  const sourceBanner = element('div', undefined, 'source-banner');
  const activeNotice = element('div', undefined, 'source-banner');
  const activeNoticeText = element('span');
  activeNotice.append(
    activeNoticeText,
    button('Stop live recording', () => safe(() => tools.stopCapture())),
  );
  const warning = element('p', undefined, 'warning');
  const toolbar = element('div', undefined, 'toolbar'),
    filter = element('input');
  filter.type = 'search';
  filter.placeholder = 'Search request, event, or identifier';
  filter.setAttribute('aria-label', 'Filter diagnostic evidence');
  filter.value = preferences.query;
  filter.addEventListener('input', () => {
    if (!pinnedRequest) preferences.requestKey = '';
    preferences.eventKey = '';
    setQuery(filter.value);
  });
  const issueCategory = element('select');
  issueCategory.setAttribute('aria-label', 'Issue category');
  for (const [value, label] of [
    ['all', 'All issue categories'],
    ...Object.entries(errorCategories).map(([key, category]) => [
      key,
      category.label,
    ]),
    ['unreported', 'Category not reported'],
  ]) {
    const option = element('option', label);
    option.value = value;
    issueCategory.append(option);
  }
  issueCategory.addEventListener('change', () => {
    preferences.issueCategory = issueCategory.value;
    if (!pinnedRequest) preferences.requestKey = '';
    preferences.eventKey = '';
    pageSize = 50;
    refresh();
  });
  const mode = element('select');
  mode.setAttribute('aria-label', 'Activity view');
  const grouped = element('option', 'Requests');
  grouped.value = 'requests';
  const all = element('option', 'All events');
  all.value = 'events';
  mode.append(grouped, all);
  mode.addEventListener('change', () => {
    preferences.allEvents = mode.value === 'events';
    preferences.eventKey = '';
    pageSize = 50;
    refresh();
  });
  const overlayLabel = element('label', ' Chart outlines'),
    overlay = element('input');
  overlay.type = 'checkbox';
  overlay.checked = preferences.overlays;
  overlay.setAttribute('aria-label', 'Chart outlines');
  overlayLabel.prepend(overlay);
  overlay.addEventListener('change', () => {
    preferences.overlays = overlay.checked;
    safe(() => tools.setOverlays(overlay.checked));
  });
  const highlightLabel = element('label', ' Highlight selection'),
    highlight = element('input');
  highlight.type = 'checkbox';
  highlight.checked = preferences.highlight;
  highlightLabel.prepend(highlight);
  highlight.addEventListener('change', () => {
    preferences.highlight = highlight.checked;
    refresh();
  });
  const jsonLabel = element('label', ' Show JSON'),
    jsonToggle = element('input');
  jsonToggle.type = 'checkbox';
  jsonToggle.checked = preferences.json;
  jsonLabel.prepend(jsonToggle);
  jsonToggle.addEventListener('change', () => {
    preferences.json = jsonToggle.checked;
    refresh();
  });
  const activityStatus = element('span', undefined, 'muted small');
  toolbar.append(
    mode,
    filter,
    issueCategory,
    overlayLabel,
    highlightLabel,
    jsonLabel,
    activityStatus,
    help,
  );
  const errorView = element('p', undefined, 'error');
  errorView.setAttribute('role', 'alert');
  const workspace = element('div', undefined, 'workspace'),
    navigation = element('aside', undefined, 'list-pane'),
    content = element('div', undefined, 'content-pane');
  navigation.tabIndex = content.tabIndex = 0;
  navigation.setAttribute('aria-label', 'Diagnostic list');
  content.setAttribute('aria-label', 'Diagnostic details');
  content.setAttribute('role', 'region');
  const jsonInspector = createJsonInspector(
    preferences.jsonMode ?? 'tree',
    (mode) => {
      preferences.jsonMode = mode;
    },
  );
  const jsonPane = jsonInspector.element;
  const comparisonInspectors = {
    a: createJsonInspector('tree', () => {}, 'A event JSON'),
    b: createJsonInspector('tree', () => {}, 'B event JSON'),
  };
  for (const inspector of Object.values(comparisonInspectors))
    inspector.element.classList.add('comparison-json');
  function clearJsonEvidence(): void {
    jsonInspector.clear();
    for (const inspector of Object.values(comparisonInspectors))
      inspector.clear();
  }
  onCleanup(clearJsonEvidence);
  workspace.append(navigation, content, jsonPane);

  const recording = element('section', undefined, 'recording'),
    recordingStatus = element('div', undefined, 'source-banner'),
    recordingFacts = element('div');
  const steps = element('ol', undefined, 'steps');
  for (const [heading, detail] of [
    ['Start recording', 'Choose which app instances to record.'],
    [
      'Reproduce the problem',
      'Use the app. Supported content is captured from this point.',
    ],
    [
      'Stop and inspect',
      'Inspect the requests, add a note, and export JSON to share.',
    ],
  ]) {
    const step = element('li');
    step.append(document.createTextNode(heading), element('span', detail));
    steps.append(step);
  }
  const recordingActions = element('div', undefined, 'recording-actions');
  const recordScopeLabel = element('label', undefined, 'recording-note');
  const recordScopeText = element('span', 'Recording scope ');
  const recordScopeSelect = element('select');
  recordScopeSelect.setAttribute('aria-label', 'Recording scope');
  recordScopeLabel.append(recordScopeText, recordScopeSelect);
  recordScopeSelect.addEventListener('change', () => {
    if (!captureStatus().active) setRecordingTarget(recordScopeSelect.value);
  });
  const start = button('Start recording', () =>
    safe(() => {
      tools.startCapture(
        recordingTarget() === 'all' ? undefined : recordingTarget(),
      );
    }),
  );
  const stop = button('Stop', () =>
    safe(() => {
      tools.stopCapture();
      switchSource('recording');
    }),
  );
  const inspectRecording = button('Inspect recording', () => {
    if (source() !== 'imported') switchSource('recording');
    setTab('Requests');
  });
  const clear = button('Clear recording', () =>
    safe(() => {
      tools.capture.clear();
      if (source() === 'recording') switchSource('live');
    }),
  );
  const download = button('Export JSON', () =>
    safe(() => {
      const url = URL.createObjectURL(
        new Blob([tools.exportCapture()], { type: 'application/json' }),
      );
      const link = element('a');
      link.href = url;
      link.download = `maelstrom-recording-${Date.now()}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }),
  );
  const input = element('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.hidden = true;
  const upload = button('Open recording', () => input.click());
  let mounted = true;
  let fileRead = 0;
  onCleanup(() => {
    mounted = false;
  });
  input.addEventListener('change', async () => {
    const currentRead = ++fileRead;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (
        file.size >
        captureImportFileBytes(tools.capture.getLimits().maxCharacters)
      )
        throw new Error('Recording is too large');
      const value = await file.text();
      if (!mounted || currentRead !== fileRead) return;
      tools.importCapture(value);
      preferences.importedName = file.name.slice(0, 256);
      switchSource('imported');
      setTab('Requests');
      setError('');
    } catch {
      if (mounted)
        setError(
          'Could not open this file. Choose a Maelstrom recording within the configured size limit.',
        );
    }
    input.value = '';
  });
  const closeImport = button('Close imported recording', () => {
    tools.closeImport();
    preferences.importedName = undefined;
    switchSource('live');
  });
  recordingActions.append(
    start,
    stop,
    inspectRecording,
    download,
    clear,
    upload,
    closeImport,
    input,
  );
  const noteLabel = element(
    'label',
    'What did you expect? What happened?',
    'recording-note',
  );
  const note = element('textarea');
  note.id = `${id}-note`;
  noteLabel.htmlFor = note.id;
  note.placeholder = 'What did you expect, and what happened?';
  note.addEventListener('input', () => {
    if (source() !== 'imported')
      safe(() => tools.capture.setOutcome(note.value));
  });
  const recordInfo = element(
    'p',
    'Recordings stay in memory until you clear them or reload the page. Redaction and size limits apply. Opening a recording does not run its commands.',
    'muted small',
  );
  const recordingSetup = element('div', undefined, 'recording-setup');
  const recordingReview = element('div', undefined, 'recording-review');
  recordingSetup.append(steps, recordScopeLabel, recordingActions);
  recordingReview.append(recordingFacts, noteLabel, note, recordInfo);
  recording.append(recordingStatus, recordingSetup, recordingReview);
  const controls = element('div', undefined, 'panel-controls');
  const viewHeading = element('div', undefined, 'view-heading');
  const viewIntro = element('div');
  viewIntro.append(title);
  viewHeading.append(viewIntro);
  controls.append(
    viewHeading,
    sourceBanner,
    activeNotice,
    warning,
    toolbar,
    errorView,
  );
  const telemetry = telemetryView(
    tools.options.telemetry,
    () => open() && tab() === 'Telemetry',
  );
  body.append(controls, recording, workspace, telemetry);
  panel.append(resize, header, body);
  root.append(trigger, panel);
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open()) {
      setOpen(false);
      trigger.focus();
    }
  });

  let pageSize = 50;
  let previousSignature: unknown[] = [];
  let lastRendered: RenderedView | undefined;
  const scopeOptions = new Map<string, HTMLOptionElement>();
  const recordingOptions = new Map<string, HTMLOptionElement>();
  const purpose: Record<Tab, readonly [string, string]> = {
    Requests: [
      'Request activity',
      'Follow a request from start to outcome. All events shows events from the selected Evidence source. To inspect a recording, select it under Evidence, then choose All events.',
    ],
    Inspector: [
      'Layout inspector',
      'Select an Instance to see its Vessel, Variant, and available Actions.',
    ],
    Connections: [
      'Connections',
      'Check Engine and voice connections. Each app and voice provider has its own lifetime.',
    ],
    Recordings: [
      'Recordings',
      'Record a problem, or inspect a saved recording. Live activity keeps metadata only.',
    ],
    Telemetry: [
      'Is telemetry being delivered?',
      'Inspect local queue, exporter acknowledgements, and lost facts from the application-owned telemetry instance.',
    ],
  };
  createEffect(() => {
    revision();
    const state = snapshot(),
      status = captureStatus(),
      currentTab = tab(),
      currentSource = source();
    if (
      (currentSource === 'recording' &&
        (status.active || status.count === 0)) ||
      (currentSource === 'imported' && state.imported === null)
    ) {
      switchSource('live');
      return;
    }
    preferences.open = open();
    preferences.tab = currentTab;
    preferences.selected = selected();
    preferences.query = query();
    preferences.source = currentSource;
    preferences.recordingTarget = recordingTarget();
    trigger.hidden = open();
    trigger.setAttribute('aria-expanded', String(open()));
    panel.hidden = !open();
    if (!open()) {
      tools.setHighlightedInstance?.();
      inspections.clear();
      cachedRecording = undefined;
      cachedImport = undefined;
      importedReference = undefined;
      previousSignature = [];
      lastRendered = undefined;
      navigation.replaceChildren();
      content.replaceChildren();
      clearJsonEvidence();
      return;
    }
    const viewingTelemetry = currentTab === 'Telemetry';
    viewHeading.hidden = viewingTelemetry;
    telemetry.hidden = !viewingTelemetry;
    sourceLabel.hidden = viewingTelemetry;
    help.hidden = viewingTelemetry;
    title.hidden = viewingTelemetry;
    description.hidden = viewingTelemetry;
    for (const node of tabButtons) {
      const active = node.textContent === currentTab;
      node.setAttribute('aria-selected', String(active));
      node.tabIndex = active ? 0 : -1;
    }
    body.setAttribute(
      'aria-labelledby',
      tabButtons[tabs.indexOf(currentTab)].id,
    );
    title.textContent = purpose[currentTab][0];
    description.textContent = purpose[currentTab][1];
    if (viewingTelemetry) {
      for (const node of [
        scopeLabel,
        singleScope,
        sourceBanner,
        activeNotice,
        warning,
        toolbar,
        errorView,
        recording,
        workspace,
      ])
        node.hidden = true;
      tools.setHighlightedInstance?.();
      inspections.clear();
      previousSignature = [];
      lastRendered = undefined;
      navigation.replaceChildren();
      content.replaceChildren();
      clearJsonEvidence();
      return;
    }
    if (state.imported === null) {
      cachedImport = undefined;
      importedReference = undefined;
    }
    if (currentTab !== 'Inspector' || currentSource !== 'live')
      inspections.clear();
    const data = evidence();
    const requestView = currentTab === 'Requests' && !preferences.allEvents;
    const comparing = requestView && Boolean(comparison);
    const viewedEvents = requestView
      ? (data.requestEvents ?? data.events)
      : data.events;
    const droppedEvents = requestView
      ? (data.droppedRequestEvents ?? data.dropped)
      : data.dropped;
    const omittedEvents = requestView
      ? (data.omittedRequestEvents ?? data.omitted)
      : data.omitted;
    const currentIds = new Set([
      ...state.sessions.map((session) => session.id),
      ...data.apps.map((app) => app.id),
      ...[...data.events, ...(data.requestEvents ?? [])].flatMap((event) =>
        event.clientId ? [event.clientId] : [],
      ),
      ...(state.imported === null
        ? []
        : (cachedImport?.apps.map((app) => app.id) ?? [])),
      ...(status.count === 0
        ? []
        : (cachedRecording?.apps.map((app) => app.id) ?? [])),
    ]);
    const recordingId = text(recordingMetadata().providerInstanceId);
    for (const slot of [comparison?.a, comparison?.b])
      if (slot) currentIds.add((JSON.parse(slot.key) as [string, string])[0]);
    if (recordingId) currentIds.add(recordingId);
    if (recordingTarget() !== 'all') currentIds.add(recordingTarget());
    for (const key of preferences.labels.keys())
      if (!currentIds.has(key)) preferences.labels.delete(key);
    for (const key of inspections.keys())
      if (
        !state.sessions.some((session) => session.id === key && session.active)
      )
        inspections.delete(key);
    if (
      selected() !== 'all' &&
      !data.apps.some((app) => app.id === selected())
    ) {
      setSelected('all');
      return;
    }
    const options = [
      { value: 'all', label: 'All app instances' },
      ...data.apps.map((app) => ({
        value: app.id,
        label: `${appLabel(app.id)} · ${app.active === undefined ? 'recorded' : app.active ? 'active' : 'ended, retained'}`,
      })),
    ];
    const valid = new Set(options.map((option) => option.value));
    for (const [key, option] of scopeOptions)
      if (!valid.has(key)) {
        option.remove();
        scopeOptions.delete(key);
      }
    for (const item of options) {
      let option = scopeOptions.get(item.value);
      if (!option) {
        option = element('option');
        option.value = item.value;
        scopeOptions.set(item.value, option);
        selector.append(option);
      }
      option.textContent = item.label;
    }
    selector.value = selected();
    const targets = [
      {
        value: 'all',
        label: 'All app instances, including new ones',
        disabled: false,
      },
      ...state.sessions.map((session) => ({
        value: session.id,
        label: `${appLabel(session.id)} · ${session.active ? 'active' : 'ended'}`,
        disabled: !session.active,
      })),
    ];
    const activeScope =
      status.active && recordingMetadata().scope === 'provider'
        ? (identity(recordingMetadata().providerInstanceId) ?? 'unknown-scope')
        : status.active
          ? 'all'
          : recordingTarget();
    if (!targets.some((target) => target.value === activeScope))
      targets.push({
        value: activeScope,
        label: 'Previous scope · no active app identity',
        disabled: true,
      });
    const targetIds = new Set(targets.map((target) => target.value));
    for (const [key, option] of recordingOptions)
      if (!targetIds.has(key)) {
        option.remove();
        recordingOptions.delete(key);
      }
    for (const target of targets) {
      let option = recordingOptions.get(target.value);
      if (!option) {
        option = element('option');
        option.value = target.value;
        recordingOptions.set(target.value, option);
        recordScopeSelect.append(option);
      }
      option.textContent = target.label;
      option.disabled = target.disabled;
    }
    recordScopeSelect.value = activeScope;
    recordScopeSelect.disabled = status.active;
    recordScopeText.textContent =
      status.count > 0 && !status.active
        ? 'Next recording scope '
        : 'Recording scope ';
    const unknownApps = new Set(
      viewedEvents.flatMap((event) =>
        event.clientId && !data.apps.some((app) => app.id === event.clientId)
          ? [event.clientId]
          : [],
      ),
    );
    scopeLabel.hidden = data.apps.length <= 1 && unknownApps.size === 0;
    singleScope.hidden = data.apps.length > 1 || unknownApps.size > 0;
    singleScope.textContent = data.apps[0]
      ? `${appLabel(data.apps[0].id)} · ${data.apps[0].active === undefined ? 'recorded' : data.apps[0].active ? 'active' : 'ended, retained'}`
      : currentSource === 'live'
        ? 'No app instance attached'
        : 'App identity not retained';
    recordedOption.disabled = status.active || status.count === 0;
    importedOption.disabled = state.imported === null;
    sourceSelect.value = currentSource;
    mode.hidden = currentTab !== 'Requests';
    mode.value = preferences.allEvents ? 'events' : 'requests';
    filter.hidden = currentTab !== 'Requests';
    if (filter.value !== query()) filter.value = query();
    issueCategory.hidden = currentTab !== 'Requests';
    issueCategory.value = preferences.issueCategory ?? 'all';
    overlayLabel.hidden =
      currentSource !== 'live' || currentTab === 'Recordings';
    highlightLabel.hidden =
      currentTab !== 'Inspector' || currentSource !== 'live';
    highlight.disabled = !tools.setHighlightedInstance;
    jsonLabel.hidden = currentTab === 'Recordings';
    activityStatus.hidden = currentTab === 'Recordings';
    activityStatus.textContent = `${viewedEvents.length} ${currentSource === 'live' ? (requestView ? 'request metadata' : 'recent metadata') : 'recorded'} events${droppedEvents ? ` · ${droppedEvents} dropped or evicted` : ''}`;
    sourceBanner.hidden = currentSource === 'live' && !status.active;
    if (currentSource !== 'live')
      sourceBanner.textContent = `${currentSource === 'imported' ? (preferences.importedName ?? 'Imported recording') : 'Current recording'} · Read-only evidence${data.note ? ` · Note: ${data.note.slice(0, 500)}` : ''}`;
    else
      sourceBanner.textContent = `Recording content for ${recordingScope()} · ${status.count} events · ${status.dropped} dropped. Changing this view does not change recording scope.`;
    activeNotice.hidden = currentSource === 'live' || !status.active;
    activeNoticeText.textContent = `Live recording continues for ${recordingScope()} · ${status.count} events. `;
    warning.hidden = !(droppedEvents || omittedEvents || unknownApps.size);
    warning.textContent = `${droppedEvents ? `${droppedEvents} older ${requestView ? 'request ' : ''}events were dropped or evicted. ` : ''}${omittedEvents ? `This view shows the latest ${MAX_VIEW_EVENTS} events; ${omittedEvents} earlier events are omitted from the view. ` : ''}${unknownApps.size ? 'Some app state is no longer retained; its events remain inspectable. ' : ''}Observed stages may be incomplete.`;
    errorView.textContent = error();
    errorView.hidden = !error();
    recording.hidden = currentTab !== 'Recordings';
    workspace.hidden = currentTab === 'Recordings';
    toolbar.hidden = false;
    start.disabled =
      currentSource !== 'live' ||
      status.active ||
      status.count > 0 ||
      !state.sessions.some(
        (session) =>
          session.active &&
          (recordingTarget() === 'all' || session.id === recordingTarget()),
      );
    stop.disabled = !status.active;
    clear.disabled = status.active || status.count === 0;
    download.disabled = status.active || status.count === 0;
    inspectRecording.disabled = status.active || status.count === 0;
    closeImport.hidden = state.imported === null;
    const viewingImport = currentSource === 'imported';
    recording.dataset.source = currentSource;
    start.hidden = viewingImport;
    stop.hidden = viewingImport;
    clear.hidden = viewingImport;
    download.hidden = viewingImport;
    steps.hidden = viewingImport;
    recordScopeLabel.hidden = viewingImport;
    inspectRecording.textContent = viewingImport
      ? 'Inspect imported recording'
      : 'Inspect recording';
    if (viewingImport) inspectRecording.disabled = false;
    recordingStatus.textContent = status.active
      ? `Recording ${recordingScope()} · ${status.count} events · ${status.dropped} dropped`
      : status.count > 0
        ? `Stopped · ${status.count} retained events · ${recordingScope()}`
        : 'Ready to record. Choose Live activity and an active app scope before starting.';
    if (viewingImport) {
      recordingStatus.textContent = 'Imported recording · read-only evidence';
      recordingFacts.replaceChildren(
        factList([
          ['Recorded scope', recordingScope(data.metadata)],
          ['Events shown', String(data.events.length)],
          [
            'Reported dropped events',
            data.dropped?.toString() ?? 'Not reported',
          ],
          ['Mode', 'Read-only'],
        ]),
      );
    } else
      recordingFacts.replaceChildren(
        factList([
          [
            'Recording scope',
            status.count ? recordingScope() : 'Selected when recording starts',
          ],
          [
            'Events / limit',
            `${status.count} / ${tools.capture.getLimits().maxEvents}`,
          ],
          ['Dropped events', String(status.dropped)],
          [
            'Retained content',
            status.count ? 'Explicit recording only' : 'None',
          ],
        ]),
      );
    const noteValue = viewingImport ? (data.note ?? '') : status.outcome;
    if (note.value !== noteValue) note.value = noteValue;
    note.readOnly = viewingImport;
    note.disabled = !viewingImport && status.count === 0;
    noteLabel.textContent = viewingImport
      ? 'Recorded note (read-only)'
      : 'What did you expect? What happened?';
    if (currentTab === 'Recordings') {
      tools.setHighlightedInstance?.();
      previousSignature = [];
      lastRendered = undefined;
      navigation.replaceChildren();
      content.replaceChildren();
      clearJsonEvidence();
      return;
    }
    const context: ViewContext = {
      evidence: data,
      appLabel,
      clientId: selected(),
      query: query(),
      issueCategory: preferences.issueCategory,
      requestKey: preferences.requestKey,
      pinnedRequest,
      comparison,
      setComparison: (selection) => {
        if (selection && !comparison) {
          pinnedRequest = undefined;
          selection = {
            ...selection,
            a: {
              ...selection.a,
              phaseBars: preferences.phaseBars ?? true,
              stageTimingLimit: preferences.stageTimingLimit,
              layoutView: preferences.layoutView,
            },
          };
        }
        if (!selection && comparison) {
          const slot = comparison[comparison.lastSelectedSide] ?? comparison.a;
          preferences.requestKey = slot.key;
          preferences.eventKey = slot.eventKey ?? '';
          preferences.phasePage = slot.phasePage;
          preferences.phaseBars = slot.phaseBars ?? preferences.phaseBars;
          preferences.stageTimingLimit = slot.stageTimingLimit;
          preferences.layoutView = slot.layoutView;
        }
        comparison = selection;
        refresh();
      },
      phaseBars: preferences.phaseBars ?? true,
      phasePage: preferences.phasePage,
      stageTimingLimit: preferences.stageTimingLimit,
      setStageTimingLimit: (limit) => {
        preferences.stageTimingLimit = limit;
      },
      layoutView: preferences.layoutView,
      setLayoutView: (view, eventKey) => {
        preferences.layoutView = view;
        if (eventKey) {
          preferences.eventKey = eventKey;
          preferences.phasePage = undefined;
        }
        refresh();
      },
      selectPhasePage: (page) => {
        preferences.phasePage = page;
        refresh();
      },
      setPhaseBars: (enabled) => {
        preferences.phaseBars = enabled;
      },
      pinRequest: (key) => {
        pinnedRequest = key;
        preferences.requestKey = key ?? '';
        preferences.eventKey = '';
        refresh();
      },
      eventKey: preferences.eventKey,
      instanceKey: preferences.instanceKey,
      allEvents: preferences.allEvents,
      pageSize,
      live: currentSource === 'live',
      inspect,
      selectRequest: (key) => {
        if (comparison) {
          const other = comparison.choosing === 'a' ? 'b' : 'a';
          if (comparison[other]?.key === key) return;
          comparison = {
            ...comparison,
            [comparison.choosing]: { key },
            lastSelectedSide: comparison.choosing,
          };
          refresh();
          return;
        }
        preferences.layoutView = undefined;
        preferences.phasePage = undefined;
        preferences.stageTimingLimit = undefined;
        if (pinnedRequest !== key) pinnedRequest = undefined;
        preferences.requestKey = key;
        preferences.eventKey = '';
        refresh();
      },
      selectEvent: (key) => {
        preferences.phasePage = undefined;
        preferences.eventKey = key;
        refresh();
      },
      selectInstance: (clientId, instanceId) => {
        if (!data.apps.some((app) => app.id === clientId)) {
          setError(
            'App state is no longer available for this event. You can still inspect its JSON.',
          );
          return;
        }
        clearRequestSelection();
        preferences.instanceKey = JSON.stringify([clientId, instanceId]);
        setSelected(clientId);
        setTab('Inspector');
        refresh();
      },
      selectApp: (clientId) => {
        clearRequestSelection();
        setSelected(clientId);
        refresh();
      },
      more: () => {
        pageSize += 50;
        refresh();
      },
    };
    let inspectionSignature: unknown[] = [];
    if (currentTab === 'Inspector')
      inspectionSignature = data.apps
        .filter((app) => selected() === 'all' || app.id === selected())
        .flatMap((app) => [app.id, app.active, app.inspection]);
    const signature = [
      currentTab,
      currentSource,
      currentTab === 'Inspector'
        ? null
        : currentSource === 'recording'
          ? cachedRecording
          : data,
      ...inspectionSignature,
      selected(),
      query(),
      preferences.issueCategory,
      preferences.requestKey,
      pinnedRequest,
      comparison,
      preferences.eventKey,
      preferences.phasePage,
      preferences.layoutView,
      preferences.instanceKey,
      preferences.allEvents,
      pageSize,
    ];
    if (
      signature.length !== previousSignature.length ||
      signature.some((value, index) => value !== previousSignature[index])
    ) {
      previousSignature = signature;
      const shadow = root.getRootNode() as ShadowRoot;
      const focused = shadow.activeElement as HTMLElement | null;
      const focusKey = focused?.dataset.focusKey;
      const previousRendered = lastRendered;
      const scrollPositions = new Map(
        Array.from(
          content.querySelectorAll<HTMLElement>('[data-scroll-key]'),
          (node) => [
            node.dataset.scrollKey,
            [node.scrollTop, node.scrollLeft] as const,
          ],
        ),
      );
      const disclosures = new Map(
        Array.from(
          content.querySelectorAll<HTMLDetailsElement>(
            'details[data-disclosure-key]',
          ),
          (node) => [node.dataset.disclosureKey, node.open],
        ),
      );
      lastRendered =
        currentTab === 'Requests'
          ? requestsView(context)
          : currentTab === 'Inspector'
            ? inspectorView(context)
            : connectionsView(
                context,
                currentSource === 'live'
                  ? panelEvents(state.transportHistory)
                  : [],
              );
      navigation.replaceChildren(
        ...(lastRendered.navigation
          ? Array.from(lastRendered.navigation.childNodes)
          : []),
      );
      if (lastRendered.selectedRequestKey)
        preferences.requestKey = lastRendered.selectedRequestKey;
      const contentIdentity = lastRendered.contentIdentity;
      if (
        !contentIdentity ||
        contentIdentity.length !== previousRendered?.contentIdentity?.length ||
        contentIdentity.some(
          (value, index) =>
            value !== previousRendered?.contentIdentity?.[index],
        )
      ) {
        for (const node of lastRendered.content.querySelectorAll<HTMLDetailsElement>(
          'details[data-disclosure-key]',
        ))
          node.open = disclosures.get(node.dataset.disclosureKey) ?? node.open;
        content.replaceChildren(lastRendered.content);
        for (const node of content.querySelectorAll<HTMLElement>(
          '[data-scroll-key]',
        )) {
          const position = scrollPositions.get(node.dataset.scrollKey);
          if (position) {
            node.scrollTop = position[0];
            node.scrollLeft = position[1];
          }
        }
      }
      workspace.dataset.list = String(Boolean(lastRendered.navigation));
      navigation.hidden = !lastRendered.navigation;
      if (comparing) jsonInspector.clear();
      else jsonInspector.set(lastRendered.raw, lastRendered.rawTitle);
      for (const side of ['a', 'b'] as const) {
        const inspector = comparisonInspectors[side];
        const placeholder = content.querySelector<HTMLElement>(
          `[data-comparison-evidence="${side}"]`,
        );
        if (!placeholder) {
          inspector.clear();
          continue;
        }
        if (!placeholder.contains(inspector.element))
          placeholder.append(inspector.element);
        inspector.set(
          lastRendered.comparisonEvents?.[side],
          currentSource === 'live'
            ? 'Live event metadata. Content requires an explicit recording.'
            : 'Full selected event, including any retained content.',
          'The selected event is no longer retained. Choose another event.',
        );
      }
      if (focused && shadow.activeElement !== focused)
        queueMicrotask(() => {
          const currentFocus = document.activeElement;
          if (
            currentFocus &&
            currentFocus !== document.body &&
            currentFocus !== shadow.host
          )
            return;
          if (shadow.activeElement && shadow.activeElement !== focused) return;
          const replacement = focused.isConnected
            ? focused
            : Array.from(
                root.querySelectorAll<HTMLElement>('[data-focus-key]'),
              ).find((node) => node.dataset.focusKey === focusKey);
          replacement?.focus({ preventScroll: true });
        });
    }
    workspace.dataset.json = String(preferences.json && !comparing);
    workspace.dataset.comparison = String(comparing);
    workspace.dataset.comparisonJson = String(preferences.json);
    jsonPane.hidden = !preferences.json || comparing;
    const highlighted =
      currentTab === 'Inspector' &&
      currentSource === 'live' &&
      preferences.highlight
        ? lastRendered?.selectedInstance
        : undefined;
    const live =
      highlighted &&
      state.sessions.some(
        (session) => session.id === highlighted.clientId && session.active,
      );
    tools.setHighlightedInstance?.(
      live ? highlighted?.clientId : undefined,
      live ? highlighted?.instanceId : undefined,
    );
  });
  return root;
}

/** Mounts the shared Solid panel in an isolated shadow root. Returns complete UI cleanup. */
export function mountDevtools(
  tools: Devtools,
  container?: HTMLElement,
): () => void {
  if (typeof document === 'undefined' || tools.options.enabled === false)
    return () => {};
  const existing = mountedPanels.get(tools);
  if (existing) {
    existing.references++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--existing.references === 0) {
        existing.dispose();
        mountedPanels.delete(tools);
      }
    };
  }
  const host = element('div');
  host.dataset.maelstromDevtools = '';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.append(element('style', panelStyle));
  (container ?? document.body).append(host);
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const theme = () => {
    host.dataset.theme =
      !tools.options.theme || tools.options.theme === 'system'
        ? media.matches
          ? 'dark'
          : 'light'
        : tools.options.theme;
  };
  theme();
  media.addEventListener('change', theme);
  const dispose = render(() => Panel(tools), shadow);
  const entry = {
    references: 1,
    dispose: () => {
      dispose();
      media.removeEventListener('change', theme);
      host.remove();
    },
  };
  mountedPanels.set(tools, entry);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--entry.references === 0) {
      entry.dispose();
      mountedPanels.delete(tools);
    }
  };
}
