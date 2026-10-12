// PROTOTYPE (MAE-826): throwaway log parser, never merge.
// Kept outside every tsconfig include, like prototype-mae825: run it with bun.
// Turns the ws-server `[timing]` / `[planner-tier]` lines and the smoke's
// agent.ui frames of each journey run into markdown tables: time to each
// visible change, loop turns, Planner calls by tier, hand-off reasons, light
// tier latency, queue waits, the SKU added, and a per-screen breakdown.
// Usage, from apps/demo:
//   bun run prototype-mae826/parse-journey-logs.ts prototype-mae826/results/raw A-1 A-2 B-1 ...
// Each label reads <dir>/<label>.server.log and <dir>/<label>.smoke.log; the
// config is the label up to its first '-'.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { productBySku } from '../src/lib/pet-shop-fixtures';
import { findSimilarProducts } from '../src/vessels/catalog.store';

const USUAL_SKU = 'DOG-DRY-SUMMIT-ADULT-30';
const usual = productBySku(USUAL_SKU);
if (!usual) throw new Error(`${USUAL_SKU} missing from the fixtures`);
const LOWER_FAT_SKUS = new Set(
  findSimilarProducts(usual, { lowerFatOnly: true }).map((p) => p.sku),
);

type Fields = Record<string, string>;
interface TimingLine {
  readonly event: string;
  readonly fields: Fields;
}
interface TierRecord {
  readonly origin?: string;
  readonly tier: 'light' | 'llm' | 'failed';
  readonly via: string | null;
  readonly handoff: string | null;
  readonly handoffDetail: string | null;
  readonly action: string | null;
  readonly lightMs: number;
  readonly decisionMs: number | null;
  readonly llmMs: number | null;
  readonly totalMs: number;
}
interface Mark {
  readonly atMs: number;
  readonly event: string;
  readonly detail: string;
}
interface Applied {
  readonly origin: string;
  readonly ms: number;
}
interface Segment {
  readonly router: number;
  readonly loopTurns: number;
  readonly loop: number;
  readonly tool: number;
  readonly hold: number;
  readonly queue: number;
  readonly planner: number;
  readonly ack: number;
  readonly total: number;
}
interface Run {
  readonly label: string;
  readonly config: string;
  readonly screens: Record<ScreenName, number | null>;
  readonly applied: readonly Applied[];
  readonly modelTurns: number | null;
  readonly parallelToolTurns: number | null;
  readonly totalMs: number | null;
  readonly plannerCalls: readonly {
    origin: string;
    plannerMs: number;
    queueWaitMs: number;
  }[];
  readonly tiers: readonly TierRecord[];
  readonly toolOrder: readonly string[];
  readonly skusAdded: readonly string[];
  readonly orderPlaced: boolean;
  readonly ok: boolean;
  readonly reply: string;
  readonly breakdown: Partial<Record<ScreenName, Segment>>;
  readonly routerMs: number | null;
  readonly loopMs: readonly number[];
}

const SCREENS = ['order', 'lowerFat', 'cart', 'checkout'] as const;
type ScreenName = (typeof SCREENS)[number];
const SCREEN_TITLES: Record<ScreenName, string> = {
  order: 'latest order',
  lowerFat: 'lower-fat options',
  cart: 'cart',
  checkout: 'checkout',
};

const [dir, ...labels] = process.argv.slice(2);
if (!dir || labels.length === 0) {
  console.error('usage: parse-journey-logs.ts <dir> <label>...');
  process.exit(1);
}
const runs = labels.map((label) => parseRun(dir, label));
const configs = [...new Set(runs.map((run) => run.config))];

console.log('## Per run\n');
console.log(
  `| run | ${SCREENS.map((s) => SCREEN_TITLES[s]).join(' | ')} | loop turns | parallel tool turns | Planner calls (light/llm) | hand-offs | light ms | max queue wait | SKU added | ok |`,
);
console.log(`|${' --- |'.repeat(SCREENS.length + 10)}`);
for (const run of runs) {
  const light = run.tiers.filter((t) => t.tier === 'light').length;
  const llm = run.plannerCalls.length - light;
  console.log(
    `| ${run.label} | ${SCREENS.map((s) => ms(run.screens[s])).join(' | ')} | ${run.modelTurns ?? '-'} | ${run.parallelToolTurns ?? '-'} | ${run.plannerCalls.length} (${light}/${llm}) | ${handoffs(run.tiers) || '-'} | ${lightLatencies(run.tiers).join(', ') || '-'} | ${Math.max(0, ...run.plannerCalls.map((c) => c.queueWaitMs))} | ${run.skusAdded.map(skuVerdict).join(', ') || 'none'} | ${run.ok && run.orderPlaced ? 'placed' : run.ok ? 'done' : 'FAILED'} |`,
  );
}

console.log('\n## Per config (seconds since input: median [min-max])\n');
console.log(
  `| config | ${SCREENS.map((s) => SCREEN_TITLES[s]).join(' | ')} | loop turns | loop turn ms (p50, max) | router ms (p50) | Planner calls light/llm | hand-off reasons | light tier ms (p50, max) | Planner call ms (p50, max) | queue wait ms (p50, max) | correct SKU |`,
);
console.log(`|${' --- |'.repeat(SCREENS.length + 10)}`);
for (const config of configs) {
  const group = runs.filter((run) => run.config === config);
  const tiers = group.flatMap((run) => run.tiers);
  const light = tiers.filter((t) => t.tier === 'light').length;
  const calls = group.flatMap((run) => run.plannerCalls);
  const lightMs = tiers
    .filter((t) => t.tier === 'light' && t.via === 'decision')
    .map((t) => t.lightMs);
  const waits = calls.map((c) => c.queueWaitMs);
  const loops = group.flatMap((run) => run.loopMs);
  const routers = group
    .map((run) => run.routerMs)
    .filter((v): v is number => v !== null);
  const plannerMs = calls.map((c) => c.plannerMs);
  const correct = group.filter(
    (run) =>
      run.skusAdded.length === 1 && LOWER_FAT_SKUS.has(run.skusAdded[0] ?? ''),
  ).length;
  console.log(
    `| ${config} | ${SCREENS.map((s) => summary(group.map((run) => run.screens[s]))).join(' | ')} | ${summary(
      group.map((run) => run.modelTurns),
      '',
    )} | ${median(loops)}, ${Math.max(0, ...loops)} | ${median(routers)} | ${light}/${calls.length - light} | ${handoffReasons(tiers) || '-'} | ${lightMs.length ? `${median(lightMs)}, ${Math.max(...lightMs)}` : '-'} | ${median(plannerMs)}, ${Math.max(0, ...plannerMs)} | ${median(waits)}, ${Math.max(0, ...waits)} | ${correct}/${group.length} |`,
  );
}

console.log('\n## Where the time goes, first two screens (ms since input)\n');
console.log(
  '| run | screen | router | loop (turns) | tool | held | queue wait | Planner | ack | visible at |',
);
console.log(`|${' --- |'.repeat(10)}`);
for (const run of runs)
  for (const screen of ['order', 'lowerFat'] as const) {
    const s = run.breakdown[screen];
    if (!s) continue;
    console.log(
      `| ${run.label} | ${SCREEN_TITLES[screen]} | ${s.router} | ${s.loop} (${s.loopTurns}) | ${s.tool} | ${s.hold} | ${s.queue} | ${s.planner} | ${s.ack} | ${s.total} |`,
    );
  }

console.log('\n## Screen changes and tool calls, in order\n');
for (const run of runs)
  console.log(
    `- ${run.label}: tools ${run.toolOrder.join(' > ')}; screens ${run.applied.map((a) => `${a.origin}@${a.ms}`).join(', ')}; Planner ${run.tiers.length ? run.tiers.map((t) => `${t.origin}:${t.tier}${t.handoff ? `(${t.handoff})` : ''}`).join(', ') : run.plannerCalls.map((c) => `${c.origin}:llm`).join(', ')}; reply ${JSON.stringify(run.reply)}`,
  );

function parseRun(directory: string, label: string): Run {
  const server = readFileSync(join(directory, `${label}.server.log`), 'utf8');
  const smoke = readFileSync(join(directory, `${label}.smoke.log`), 'utf8');
  const timings: TimingLine[] = [];
  const tiers: TierRecord[] = [];
  const marks: Mark[] = [];
  let inTimeline = false;
  for (const line of server.split('\n')) {
    if (line.startsWith('[planner-tier] ')) {
      tiers.push(JSON.parse(line.slice('[planner-tier] '.length)));
      continue;
    }
    const timing = /^\[timing\] (?:conn=\S+ )?(\S+)(.*)$/.exec(line);
    if (timing) {
      timings.push({
        event: timing[1] ?? '',
        fields: parseFields(timing[2] ?? ''),
      });
      continue;
    }
    if (line.startsWith('[agent-session] turn ')) {
      inTimeline = true;
      continue;
    }
    const mark = /^\s+(\d+)ms (\S+)(?: (.*))?$/.exec(line);
    if (inTimeline && mark)
      marks.push({
        atMs: Number(mark[1]),
        event: mark[2] ?? '',
        detail: mark[3] ?? '',
      });
    else if (inTimeline && !mark) inTimeline = false;
  }

  const applied = timings
    .filter((t) => t.event === 'ui.applied')
    .map((t) => ({
      origin: t.fields.origin ?? '?',
      ms: Number(t.fields.sinceInputMs),
    }));
  const first = (origins: readonly string[], after = -1) =>
    applied.find((a) => origins.includes(a.origin) && a.ms > after)?.ms ?? null;
  const cart = first(['add_to_cart']);
  const screens: Record<ScreenName, number | null> = {
    order: first(['get_past_orders']),
    lowerFat: first(['find_similar_products']) ?? first(['search_products']),
    cart,
    checkout: cart === null ? null : first(['place_order', 'show_ui'], cart),
  };
  const done = timings.find((t) => t.event === 'turn.done')?.fields;
  const router = timings.find((t) => t.event === 'router')?.fields;
  const plannerCalls = timings
    .filter((t) => t.event === 'planner')
    .map((t) => ({
      origin: t.fields.origin ?? '?',
      plannerMs: Number(t.fields.plannerMs),
      queueWaitMs: Number(t.fields.queueWaitMs),
    }));
  const uiFrames = smoke
    .split('\n')
    .filter((line) => line.includes(' agent.ui planner'));
  const skusAdded = uiFrames.flatMap((line) =>
    [...line.matchAll(/addToCart\{\\"sku\\":\\"([^\\]+)\\"/g)].map(
      (match) => match[1] ?? '',
    ),
  );
  const doneLine = smoke
    .split('\n')
    .find((line) => line.includes(' agent.done '));
  const breakdown: Partial<Record<ScreenName, Segment>> = {};
  const order = segment(marks, 'get_past_orders');
  if (order) breakdown.order = order;
  const lowerFat =
    segment(marks, 'find_similar_products') ??
    segment(marks, 'search_products');
  if (lowerFat) breakdown.lowerFat = lowerFat;
  return {
    label,
    config: label.split('-')[0] ?? label,
    screens,
    applied,
    modelTurns: done?.modelTurns ? Number(done.modelTurns) : null,
    parallelToolTurns: done?.parallelToolTurns
      ? Number(done.parallelToolTurns)
      : null,
    totalMs: done?.totalMs ? Number(done.totalMs) : null,
    plannerCalls,
    tiers,
    toolOrder: marks
      .filter((m) => /^tool\.[a-z_]+\.start$/.test(m.event))
      .map((m) => m.event.split('.')[1] ?? '?'),
    skusAdded,
    orderPlaced: uiFrames.some((line) => line.includes('placeOrder')),
    ok: done?.ok === 'true',
    reply: replyOf(doneLine ?? ''),
    breakdown,
    routerMs: router?.ms ? Number(router.ms) : null,
    loopMs: marks
      .filter((m) => /^loop\d+\.end$/.test(m.event))
      .map((m) => Number.parseInt(m.detail, 10)),
  };
}

// The show a data tool queued, from the turn timeline: router, loop turns
// up to the tool, the tool, held until the tool phase ended, queue wait,
// Planner call, and the browser ack.
function segment(marks: readonly Mark[], tool: string): Segment | null {
  const at = (predicate: (m: Mark) => boolean, from = 0) =>
    marks.slice(from).findIndex(predicate) + from;
  const routerIndex = at((m) => m.event === 'router.decided');
  const toolStart = at((m) => m.event === `tool.${tool}.start`);
  if (toolStart < 0 || marks[toolStart] === undefined) return null;
  const toolEnd = at((m) => m.event === `tool.${tool}.end`, toolStart);
  const enqueue = at(
    (m) => m.event === 'planner.enqueue' && m.detail.startsWith(tool),
    toolStart,
  );
  const dequeue = at(
    (m) => m.event === 'planner.dequeue' && m.detail === tool,
    Math.max(enqueue, 0),
  );
  const end = at((m) => m.event === 'planner.end', Math.max(dequeue, 0));
  const ack = at((m) => m.event === 'ui.ack', Math.max(end, 0));
  const ms = (index: number) => marks[index]?.atMs ?? Number.NaN;
  const routerAt = routerIndex >= 0 ? ms(routerIndex) : 0;
  const loopTurns = marks
    .slice(0, toolStart)
    .filter((m) => /^loop\d+\.start$/.test(m.event)).length;
  return {
    router: routerAt,
    loopTurns,
    loop: ms(toolStart) - routerAt,
    tool: ms(toolEnd) - ms(toolStart),
    hold: ms(enqueue) - ms(toolEnd),
    queue: ms(dequeue) - ms(enqueue),
    planner: ms(end) - ms(dequeue),
    ack: ms(ack) - ms(end),
    total: ms(ack),
  };
}

function replyOf(doneLine: string): string {
  const quoted = / (?:true|false) ("(?:[^"\\]|\\.)*")/.exec(doneLine)?.[1];
  return quoted ? JSON.parse(quoted) : '';
}

function parseFields(text: string): Fields {
  const fields: Fields = {};
  for (const match of text.matchAll(/(\w+)=("(?:[^"\\]|\\.)*"|\S+)/g)) {
    const raw = match[2] ?? '';
    fields[match[1] ?? ''] = raw.startsWith('"') ? JSON.parse(raw) : raw;
  }
  return fields;
}

function handoffs(tiers: readonly TierRecord[]): string {
  return tiers
    .filter((t) => t.handoff)
    .map((t) => `${t.origin}: ${t.handoff}`)
    .join('; ');
}

function handoffReasons(tiers: readonly TierRecord[]): string {
  const counts = new Map<string, number>();
  for (const t of tiers)
    if (t.handoff) {
      const key = `${t.handoff} (${t.origin})`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  return [...counts].map(([key, n]) => `${key} x${n}`).join('; ');
}

function lightLatencies(tiers: readonly TierRecord[]): number[] {
  return tiers
    .filter((t) => t.via === 'decision' || t.handoff)
    .map((t) => t.lightMs);
}

function skuVerdict(sku: string): string {
  return `${sku}${LOWER_FAT_SKUS.has(sku) ? '' : ' (WRONG)'}`;
}

function summary(values: readonly (number | null)[], unit = 's'): string {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return '-';
  const missing = values.length - present.length;
  const fmt = (v: number) => (unit === '' ? String(v) : (v / 1000).toFixed(1));
  const body =
    present.length === 1
      ? fmt(present[0] ?? 0)
      : `${fmt(median(present))} [${fmt(Math.min(...present))}-${fmt(Math.max(...present))}]`;
  return `${body}${missing ? ` (${missing} run${missing > 1 ? 's' : ''} without)` : ''}`;
}

function ms(value: number | null): string {
  return value === null ? '-' : `${(value / 1000).toFixed(1)} s`;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] ?? 0)
    : Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}
