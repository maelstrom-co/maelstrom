import {
  type TilingLayout,
  type TilingNode,
  tilingLeafInstanceId,
} from '@maelstrom-co/protocol';
import {
  computeTilingLayout,
  parseTilingTree,
} from '../../../client/src/lib/chart-manager/tiling.ts';
import type { ReportRecord } from './run.ts';

interface Data {
  summary: {
    mode: string;
    interpretation: string;
    completedTrials: number;
    failedExpectations: number;
    planned: number;
    deferred: number;
    p50Ms: number | null;
  };
  catalogs?: ReportRecord['input']['request']['vessels'][];
  records: (ReportRecord & { catalogIndex?: number })[];
}
const element = (id: string): HTMLElement => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing report element ${id}`);
  return found;
};
const data: Data = JSON.parse(element('data').textContent ?? '{}');
for (const record of data.records) {
  const vessels =
    record.catalogIndex === undefined
      ? record.input.request.vessels
      : data.catalogs?.[record.catalogIndex];
  if (!vessels) throw new Error('Report catalog is missing');
  record.input.request = { ...record.input.request, vessels };
}
let current = data.records[0];
let layout: TilingLayout;
let actions: unknown[] = [];

function json(id: string, value: unknown) {
  element(id).textContent = JSON.stringify(value, null, 2);
}

function renderBoard() {
  const board = element('board');
  board.replaceChildren();
  const tiles = computeTilingLayout(
    parseTilingTree(layout.tree),
    { x: 0, y: 0, width: 100, height: 100 },
    0,
  );
  for (const tile of tiles) {
    const instance = layout.instances.find(
      (i) => i.instanceId === tile.instanceId,
    );
    const card = document.createElement('div');
    card.className = 'tile';
    Object.assign(card.style, {
      left: `${tile.rect.x}%`,
      top: `${tile.rect.y}%`,
      width: `${tile.rect.width}%`,
      height: `${tile.rect.height}%`,
    });
    const content = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = instance?.vesselId ?? tile.instanceId;
    const identity = document.createElement('p');
    identity.textContent = tile.instanceId;
    const variant = document.createElement('small');
    variant.textContent = `Variant: ${instance?.variant ?? 'unknown'}`;
    content.append(title, identity, variant);
    card.append(content);
    board.append(card);
  }
  if (!tiles.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent =
      'No visible instances. Hidden instances remain in the layout declaration.';
    board.append(empty);
  }
  json('output', { layout, executionPlan: actions });
}

function before() {
  if (current.input.request.layout.type !== 'tiling')
    throw new Error('Expected tiling');
  layout = structuredClone(current.input.request.layout);
  actions = [];
  element('status').textContent = 'Starting state. No plan applied.';
  renderBoard();
}

function select(record: ReportRecord) {
  current = record;
  element('title').textContent = record.title;
  element('why').textContent = record.why;
  element('intent').textContent = record.input.request.context.updateReasons
    .map((r) => (r.type === 'user_intent' ? r.intent : r.type))
    .join('\n');
  json('judgments', {
    mode: data.summary.mode,
    requests: record.requests,
    elapsedMs: record.elapsedMs,
    usedConfidence:
      record.result.status === 'error' ? null : record.result.usedConfidence,
    traces: record.traces,
  });
  json('expected', {
    expected: record.expected,
    observed: record.result.status,
    failures: record.failures,
  });
  json('input', record.input);
  for (const button of element('cases').querySelectorAll('button'))
    button.setAttribute(
      'aria-pressed',
      String(
        button.dataset.id === record.id &&
          button.dataset.repeat === String(record.repeat),
      ),
    );
  before();
}

function apply() {
  const result = current.result;
  if (result.status !== 'planned') {
    before();
    element('status').textContent =
      result.status === 'deferred'
        ? `Deferred: ${result.reason}. The starting board remains unchanged; no partial actions.`
        : `Error: ${result.message}`;
    return;
  }
  layout = structuredClone(result.plan.layout);
  actions = [...result.plan.executionPlan];
  // Simulate only declared variant transitions; this report never executes Vessel callbacks.
  for (const action of result.plan.executionPlan) {
    layout = {
      ...layout,
      instances: layout.instances.map((instance) => {
        if (instance.instanceId !== action.instanceId) return instance;
        const vessel = current.input.request.vessels.find(
          (v) => v.id === instance.vesselId,
        );
        const definition = vessel?.variants[instance.variant]?.actions.find(
          (a) => a.name === action.action,
        );
        return definition?.transitionsTo
          ? { ...instance, variant: definition.transitionsTo }
          : instance;
      }),
    };
  }
  element('status').textContent =
    `${data.summary.mode === 'live' ? 'Live Jev' : 'Scripted offline'} plan applied to the preview. ${actions.length} ordered action(s); variant transitions simulated.`;
  renderBoard();
  json('output', result.plan);
}

function rearrange(kind: 'row' | 'column' | 'focus' | 'hide') {
  let leaves = layout.tree.filter(
    (node) => tilingLeafInstanceId(node) !== null,
  );
  if (kind === 'hide') leaves = leaves.slice(0, -1);
  let tree: TilingNode[] = leaves;
  if (leaves.length > 1) {
    if (kind === 'focus')
      tree = [
        'V:2,1',
        leaves[0],
        ...(leaves.length === 2
          ? [leaves[1]]
          : ([
              `H:${leaves
                .slice(1)
                .map(() => 1)
                .join(',')}`,
              ...leaves.slice(1),
            ] as TilingNode[])),
      ];
    else
      tree = [
        `${kind === 'column' ? 'H' : 'V'}:${leaves.map(() => 1).join(',')}`,
        ...leaves,
      ];
  }
  layout = { ...layout, tree };
  actions = [];
  element('status').textContent =
    'Manual preview only. No model judgment or evaluation result changed.';
  renderBoard();
}

function list(group: string) {
  const nav = element('cases');
  nav.replaceChildren();
  for (const record of data.records.filter(
    (r) => group === 'all' || r.group === group,
  )) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.id = record.id;
    button.dataset.repeat = String(record.repeat);
    button.textContent = `${record.failures.length ? 'FAIL' : 'PASS'} · ${record.title} · trial ${record.repeat}`;
    button.addEventListener('click', () => select(record));
    nav.append(button);
  }
}

element('notice').textContent =
  `${data.summary.mode === 'live' ? 'LIVE MODEL RUN' : 'NO LIVE MODEL RUN'} — ${data.summary.interpretation}`;
for (const [label, value] of Object.entries({
  'Completed cases': data.summary.completedTrials,
  'Failed expectations': data.summary.failedExpectations,
  'Plans compiled': data.summary.planned,
  'Requests deferred': data.summary.deferred,
  'Model-backed p50':
    data.summary.p50Ms === null
      ? 'Not measured'
      : `${Math.round(data.summary.p50Ms)} ms`,
})) {
  const metric = document.createElement('div');
  metric.className = 'metric';
  const number = document.createElement('strong');
  number.textContent = String(value);
  const name = document.createElement('span');
  name.textContent = label;
  metric.append(number, name);
  element('metrics').append(metric);
}
json('summary', data.summary);
element('before').addEventListener('click', before);
element('reset').addEventListener('click', before);
element('apply').addEventListener('click', apply);
for (const kind of ['row', 'column', 'focus', 'hide'] as const)
  element(kind).addEventListener('click', () => rearrange(kind));
element('group').addEventListener('change', (event) => {
  if (event.target instanceof HTMLSelectElement) list(event.target.value);
});
list('all');
select(current);
