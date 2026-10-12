// PROTOTYPE (MAE-826): throwaway offline eval of the composed Planner's light tier, never merge.
// Kept outside every tsconfig include, like prototype-mae825: run it with bun.
// Feeds shop intents against fixture layouts through a real Engine running
// the composed Planner, with a stub in place of the LLM tier (no OpenAI
// calls). Uses TypeSafe Jev when TYPESAFE_API_KEY and JEV_MODEL are set,
// otherwise (or with --stub) a keyword stub decider.
// Usage, from the repo root:
//   bun --conditions=@maelstrom-co/source --env-file=.env apps/demo/prototype-mae826/composed-planner-eval.ts [--stub]
import {
  createEngine,
  type Logger,
  type PlannerCandidate,
  type PlanningInput,
  type Retryable,
  type Stage,
} from '@maelstrom-co/engine';
import {
  type ChartRequest,
  ChartRequestMessage,
  ChartRequestSchema,
  ok,
  SessionId,
  type TilingLayout,
} from '@maelstrom-co/protocol';
import { SEED_ORDERS } from '../src/lib/pet-shop-fixtures';
import { withActionOptions } from '../src/lib/vessel-options';
import {
  createComposedPlanner,
  type PlannerCallRecord,
} from '../src/server/composed-planner';
import {
  type ActionDecider,
  type DecisionReply,
  intentWithMetadata,
  type KeepLayoutHandoff,
  keepLayoutDeciderFromEnv,
  type RequiredActionSpec,
} from '../src/server/keep-layout-action-planner';
import { cartVessel } from '../src/vessels/cart.vessel.def';
import { catalogVessel } from '../src/vessels/catalog.vessel.def';
import { checkoutVessel } from '../src/vessels/checkout.vessel.def';
import { ordersVessel } from '../src/vessels/orders.vessel.def';

const USUAL_SKU = 'DOG-DRY-SUMMIT-ADULT-30';
const CART_SKUS = [USUAL_SKU];
const VESSELS = [
  withActionOptions(ordersVessel, {
    showOrderDetails: { orderId: SEED_ORDERS.map((order) => order.id) },
  }),
  catalogVessel,
  withActionOptions(cartVessel, {
    removeFromCart: { sku: CART_SKUS },
    updateCartQuantity: { sku: CART_SKUS },
  }),
  checkoutVessel,
];

type Variants = Record<'orders' | 'catalog' | 'cart' | 'checkout', string>;
interface Fixture {
  readonly rows: number;
  readonly columns: number;
  readonly tree: readonly string[];
  readonly variants: Variants;
}

const ALL_FOUR = [
  'V',
  'H',
  'ID:orders-main',
  'ID:catalog-main',
  'H',
  'ID:cart-main',
  'ID:checkout-main',
];
const FIXTURES: Record<string, Fixture> = {
  // The /shop starting screen: every Vessel visible at its default variant.
  full: {
    rows: 12,
    columns: 16,
    tree: ALL_FOUR,
    variants: {
      orders: 'list',
      catalog: 'results',
      cart: 'items',
      checkout: 'review',
    },
  },
  // Cart and checkout declared but hidden.
  browse: {
    rows: 12,
    columns: 16,
    tree: ['V', 'ID:orders-main', 'ID:catalog-main'],
    variants: {
      orders: 'list',
      catalog: 'results',
      cart: 'items',
      checkout: 'review',
    },
  },
  // Every Vessel past its default variant.
  deep: {
    rows: 12,
    columns: 16,
    tree: ALL_FOUR,
    variants: {
      orders: 'detail',
      catalog: 'product',
      cart: 'items',
      checkout: 'confirmation',
    },
  },
  // Catalog in a 4-column leaf: product (min 4 wide) fits, results (min 5) does not.
  narrow: {
    rows: 8,
    columns: 8,
    tree: ['V', 'ID:orders-main', 'ID:catalog-main'],
    variants: {
      orders: 'detail',
      catalog: 'product',
      cart: 'items',
      checkout: 'review',
    },
  },
};

interface ExpectedPick {
  readonly action: string;
  readonly params?: Readonly<Record<string, unknown>>;
  /** Extra parameters that are still correct, with their acceptable values. */
  readonly allowExtra?: Readonly<Record<string, readonly unknown[]>>;
}
type Expected =
  | { readonly light: readonly ExpectedPick[] }
  | { readonly handoff: readonly KeepLayoutHandoff[] | 'any' };

interface Case {
  readonly fixture: keyof typeof FIXTURES;
  readonly intent: string;
  readonly metadata?: Record<string, unknown>;
  /** Side effects the loop requires, shipped without a decision call. */
  readonly requiredActions?: readonly RequiredActionSpec[];
  readonly expect: Expected;
}

const LATEST = { latestOrderId: 'ORD-10455', latestOrderSku: USUAL_SKU };
const SIMILAR = {
  latestOrderSku: USUAL_SKU,
  similarSkus: [
    'DOG-DRY-NORTHPAW-LEAN-28',
    'DOG-DRY-SUMMIT-HW-30',
    'DOG-DRY-HARVEST-SENS-30',
  ],
};
const ADD_HEALTHY_WEIGHT: RequiredActionSpec = {
  vesselId: 'cart',
  action: 'addToCart',
  params: { sku: 'DOG-DRY-SUMMIT-HW-30', quantity: 1 },
};
const PLACE_ORDER: RequiredActionSpec = {
  vesselId: 'checkout',
  action: 'placeOrder',
  params: {},
};
const light = (...picks: ExpectedPick[]): Expected => ({ light: picks });
const handoff = (...reasons: KeepLayoutHandoff[]): Expected => ({
  handoff: reasons,
});

const CASES: readonly Case[] = [
  {
    fixture: 'full',
    intent: 'Show me my most recent order',
    metadata: LATEST,
    expect: light(
      { action: 'orders.showMostRecentOrder' },
      { action: 'orders.showOrderDetails', params: { orderId: 'ORD-10455' } },
    ),
  },
  {
    fixture: 'full',
    intent: 'Open order ORD-10388',
    expect: light({
      action: 'orders.showOrderDetails',
      params: { orderId: 'ORD-10388' },
    }),
  },
  {
    fixture: 'full',
    intent: 'Show lower-fat options similar to the dog food Sam usually buys',
    metadata: SIMILAR,
    expect: light({
      action: 'catalog.findSimilarProducts',
      params: { sku: USUAL_SKU, lowerFatOnly: true },
    }),
  },
  {
    fixture: 'full',
    intent: 'Find dog food like Summit Trail Adult Chicken & Brown Rice',
    expect: light({
      action: 'catalog.findSimilarProducts',
      params: { sku: USUAL_SKU },
      allowExtra: { lowerFatOnly: [false] },
    }),
  },
  {
    fixture: 'full',
    intent: 'Show dry cat food',
    expect: light({
      action: 'catalog.searchProducts',
      params: { species: 'cat', foodType: 'dry' },
    }),
  },
  {
    fixture: 'full',
    intent: 'Show dog food with at most 12% fat',
    expect: light({
      action: 'catalog.searchProducts',
      params: { species: 'dog', maxFatPercent: 12 },
    }),
  },
  {
    fixture: 'full',
    intent: 'Show the details of Northpaw Lean Turkey & Oatmeal',
    expect: light({
      action: 'catalog.showProductDetails',
      params: { sku: 'DOG-DRY-NORTHPAW-LEAN-28' },
    }),
  },
  {
    fixture: 'full',
    intent: 'Add the Summit Trail Healthy Weight food to the cart',
    metadata: { sku: 'DOG-DRY-SUMMIT-HW-30', quantity: 1 },
    expect: light({
      action: 'cart.addToCart',
      params: { sku: 'DOG-DRY-SUMMIT-HW-30', quantity: 1 },
    }),
  },
  {
    fixture: 'full',
    intent: 'Add 2 bags of DOG-DRY-NORTHPAW-LEAN-28 to my cart',
    expect: light({
      action: 'cart.addToCart',
      params: { sku: 'DOG-DRY-NORTHPAW-LEAN-28', quantity: 2 },
    }),
  },
  {
    fixture: 'full',
    intent: 'Add the lean turkey kibble to my cart',
    expect: handoff('side_effect_param_not_explicit'),
  },
  {
    fixture: 'full',
    intent: 'Clear the search and list the whole catalog',
    expect: light({ action: 'catalog.clearSearch' }),
  },
  {
    fixture: 'full',
    intent: 'Empty my cart',
    expect: light({ action: 'cart.clearCart' }),
  },
  {
    fixture: 'full',
    intent: 'Place the order, the customer approved it',
    expect: light({ action: 'checkout.placeOrder' }),
  },
  {
    fixture: 'full',
    intent: 'Search the catalog for salmon',
    expect: handoff('parameter_needs_generated_text'),
  },
  {
    fixture: 'full',
    intent: 'Make the catalog bigger',
    expect: handoff('needs_screen_change'),
  },
  {
    fixture: 'full',
    intent: 'Hide the checkout',
    expect: handoff('needs_screen_change'),
  },
  {
    fixture: 'full',
    intent:
      'Open my last order and show lower-fat alternatives to what is in it',
    metadata: SIMILAR,
    expect: handoff('needs_screen_change'),
  },
  {
    fixture: 'full',
    intent: 'Show a map of pet stores near me',
    expect: handoff('needs_screen_change'),
  },
  {
    fixture: 'browse',
    intent: 'Add DOG-DRY-SUMMIT-HW-30 to my cart',
    metadata: { sku: 'DOG-DRY-SUMMIT-HW-30', quantity: 1 },
    expect: handoff('target_not_visible', 'needs_screen_change'),
  },
  {
    fixture: 'browse',
    intent: 'Take me to checkout',
    expect: { handoff: 'any' },
  },
  {
    fixture: 'browse',
    intent: 'Show lower-fat options similar to my usual dog food',
    metadata: SIMILAR,
    expect: light({
      action: 'catalog.findSimilarProducts',
      params: { sku: USUAL_SKU, lowerFatOnly: true },
    }),
  },
  {
    fixture: 'deep',
    intent: 'Go back to my list of orders',
    expect: light({ action: 'orders.backToOrderList' }),
  },
  {
    fixture: 'deep',
    intent: 'Back to the checkout review',
    expect: light({ action: 'checkout.returnToCheckoutReview' }),
  },
  {
    fixture: 'deep',
    intent: 'Show me my most recent order',
    metadata: LATEST,
    expect: light(
      { action: 'orders.showMostRecentOrder' },
      { action: 'orders.showOrderDetails', params: { orderId: 'ORD-10455' } },
    ),
  },
  {
    fixture: 'deep',
    intent: 'Place the order, the customer approved it',
    expect: handoff('action_not_offered_at_variant', 'needs_screen_change'),
  },
  {
    fixture: 'narrow',
    intent: `Show lower-fat options similar to ${USUAL_SKU}`,
    expect: handoff('layout_no_longer_fits'),
  },
  // Tool-bound side effects: the loop states the action, no decision call.
  {
    fixture: 'full',
    intent: 'Add Summit Trail Healthy Weight to the cart',
    requiredActions: [ADD_HEALTHY_WEIGHT],
    expect: light({
      action: 'cart.addToCart',
      params: ADD_HEALTHY_WEIGHT.params,
    }),
  },
  {
    fixture: 'browse',
    intent: 'Add Summit Trail Healthy Weight to the cart',
    requiredActions: [ADD_HEALTHY_WEIGHT],
    expect: handoff('target_not_visible'),
  },
  {
    fixture: 'full',
    intent: 'Place the order the customer approved',
    requiredActions: [PLACE_ORDER],
    expect: light({ action: 'checkout.placeOrder' }),
  },
  {
    fixture: 'deep',
    intent: 'Place the order the customer approved',
    requiredActions: [PLACE_ORDER],
    expect: handoff('action_not_offered_at_variant'),
  },
];

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

// Stands in for the LLM tier so the eval spends nothing on OpenAI.
const stubLlmPlanner: Stage<
  Retryable<PlanningInput>,
  PlannerCandidate
> = async (input) => {
  const layout = input.request.layout as TilingLayout;
  return ok({
    userMessage: 'LLM tier stub.',
    rationale: 'eval stub',
    executionPlan: [],
    layout: { tree: layout.tree, instances: layout.instances },
  });
};

const useStub = process.argv.includes('--stub');
const jev = useStub ? null : keepLayoutDeciderFromEnv(process.env);
const decider = jev ?? stubDecider;
console.log(
  jev
    ? `Decision model: TypeSafe Jev ${process.env.JEV_MODEL} (real calls).`
    : 'Decision model: KEYWORD STUB (no TypeSafe credentials or --stub). Accuracy numbers say nothing about Jev.',
);

let lastRecord: PlannerCallRecord | null = null;
const engine = createEngine({
  planner: createComposedPlanner({
    decider,
    llmPlanner: stubLlmPlanner,
    log: false,
    onRecord: (record) => {
      lastRecord = record;
    },
  }),
  retry: false,
  logger: silentLogger,
});

interface Row {
  readonly index: number;
  readonly testCase: Case;
  readonly record: PlannerCallRecord;
  readonly verdict:
    | 'correct_light'
    | 'wrong_light'
    | 'missed_light'
    | 'correct_handoff'
    | 'wrong_reason';
}

const rows: Row[] = [];
for (const [index, testCase] of CASES.entries()) {
  lastRecord = null;
  const result = await engine.handle(
    ChartRequestMessage({
      sessionId: SessionId(`eval-${index}`),
      request: chartRequest(testCase),
    }),
  );
  const record = lastRecord as PlannerCallRecord | null;
  if (!record)
    throw new Error(
      `case ${index}: no planner record (${result.ok ? 'ok' : result.error.message})`,
    );
  const verdict = judge(testCase.expect, record);
  rows.push({ index, testCase, record, verdict });
  const got =
    record.tier === 'light'
      ? `LIGHT via ${record.via} ${record.action} ${JSON.stringify(record.params)} confidence=${record.confidence?.toFixed(2) ?? '-'}`
      : `HANDOFF ${record.handoff}${record.handoffDetail ? ` (${record.handoffDetail})` : ''} [picked ${record.action ?? '-'} ${record.params ? JSON.stringify(record.params) : ''}]`;
  console.log(
    `${String(index + 1).padStart(2)} ${verdict.padEnd(15)} ${String(record.decisionMs ?? '-').padStart(4)}ms ${testCase.fixture.padEnd(6)} "${testCase.intent}"\n     expected ${describe(testCase.expect)}\n     got      ${got}`,
  );
}

const count = (verdict: Row['verdict']) =>
  rows.filter((row) => row.verdict === verdict).length;
const answered = rows.filter((row) => row.record.tier === 'light');
const expectedLight = rows.filter((row) => 'light' in row.testCase.expect);
const handedOff = rows.filter((row) => row.record.tier !== 'light');
const decided = rows.filter((row) => row.record.via === 'decision');
const lightMs = answered
  .filter((row) => row.record.via === 'decision')
  .map((row) => row.record.lightMs);
const requiredMs = answered
  .filter((row) => row.record.via === 'required_actions')
  .map((row) => row.record.lightMs);
const decisionMs = decided
  .map((row) => row.record.decisionMs)
  .filter((ms): ms is number => ms !== null);
const reasons = new Map<string, number>();
for (const row of handedOff)
  reasons.set(
    row.record.handoff ?? 'none',
    (reasons.get(row.record.handoff ?? 'none') ?? 0) + 1,
  );

console.log(`
Summary (${rows.length} intents, ${jev ? 'Jev' : 'STUB'})
  light answered        ${answered.length}/${rows.length}
  light accuracy        ${count('correct_light')}/${answered.length} answered correctly (${pct(count('correct_light'), answered.length)})
  wrong light answers   ${count('wrong_light')} (shipped a wrong action or parameter, or should have handed off)
  light recall          ${count('correct_light')}/${expectedLight.length} light-expected intents answered correctly
  missed light          ${count('missed_light')} (handed off although the light tier should answer)
  handoff rate          ${handedOff.length}/${rows.length} (${pct(handedOff.length, rows.length)}), expected ${rows.length - expectedLight.length}/${rows.length}
  handoff reason wrong  ${count('wrong_reason')} (handed off correctly, unexpected reason)
  handoff reasons       ${[...reasons].map(([reason, n]) => `${reason}=${n}`).join(', ')}
  light tier latency    p50 ${percentile(lightMs, 0.5)}ms, max ${Math.max(...lightMs, 0)}ms (answered via decision call, decision + validation)
  decision call latency p50 ${percentile(decisionMs, 0.5)}ms, max ${Math.max(...decisionMs, 0)}ms (all ${decisionMs.length} decision calls)
  required-action path  p50 ${percentile(requiredMs, 0.5)}ms, max ${Math.max(...requiredMs, 0)}ms (answered, no model call)`);

function chartRequest(testCase: Case): ChartRequest {
  const fixture = FIXTURES[testCase.fixture];
  const instances = (
    Object.entries(fixture.variants) as [keyof Variants, string][]
  ).map(([vesselId, variant]) => ({
    instanceId: `${vesselId}-main`,
    vesselId,
    variant,
  }));
  return ChartRequestSchema.parse({
    type: 'chart_request',
    context: {
      updateReasons: [
        {
          type: 'user_intent',
          intent: intentWithMetadata(
            testCase.intent,
            testCase.metadata,
            testCase.requiredActions,
          ),
        },
      ],
      chartDimensions: { rows: fixture.rows, columns: fixture.columns },
      layoutMode: 'tiling',
    },
    instances,
    vessels: VESSELS,
    layout: { type: 'tiling', tree: fixture.tree, instances },
  }) as unknown as ChartRequest;
}

function judge(expect: Expected, record: PlannerCallRecord): Row['verdict'] {
  if ('light' in expect) {
    if (record.tier !== 'light') return 'missed_light';
    return expect.light.some((pick) => matches(pick, record))
      ? 'correct_light'
      : 'wrong_light';
  }
  if (record.tier === 'light') return 'wrong_light';
  if (expect.handoff === 'any') return 'correct_handoff';
  return record.handoff && expect.handoff.includes(record.handoff)
    ? 'correct_handoff'
    : 'wrong_reason';
}

function matches(pick: ExpectedPick, record: PlannerCallRecord): boolean {
  if (record.action !== pick.action) return false;
  const params = record.params ?? {};
  const expected = pick.params ?? {};
  for (const [name, value] of Object.entries(params)) {
    if (Object.hasOwn(expected, name)) {
      if (JSON.stringify(expected[name]) !== JSON.stringify(value))
        return false;
    } else if (
      !pick.allowExtra?.[name]?.some(
        (allowed) => JSON.stringify(allowed) === JSON.stringify(value),
      )
    )
      return false;
  }
  return Object.keys(expected).every((name) => Object.hasOwn(params, name));
}

function describe(expect: Expected): string {
  if ('light' in expect)
    return `LIGHT ${expect.light.map((pick) => `${pick.action} ${JSON.stringify(pick.params ?? {})}`).join(' | ')}`;
  return `HANDOFF ${expect.handoff === 'any' ? 'any reason' : expect.handoff.join(' | ')}`;
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function pct(part: number, whole: number): string {
  return whole === 0 ? '-' : `${Math.round((100 * part) / whole)}%`;
}

// Keyword rules standing in for Jev when no credentials are set.
async function stubDecider(
  request: Parameters<ActionDecider>[0],
): Promise<DecisionReply> {
  const state = request.state as {
    latestRequest: string;
    facts?: Record<string, unknown>;
  };
  const text = state.latestRequest.toLowerCase();
  const rules: [RegExp, string][] = [
    [/ and |bigger|smaller|hide|map|take me/, 'needs_screen_change'],
    [/most recent|last order|latest order/, 'orders.showMostRecentOrder'],
    [/open order/, 'orders.showOrderDetails'],
    [/back to .*orders|list of orders/, 'orders.backToOrderList'],
    [/back to .*checkout/, 'checkout.returnToCheckoutReview'],
    [/place the order/, 'checkout.placeOrder'],
    [/similar|like /, 'catalog.findSimilarProducts'],
    [/details/, 'catalog.showProductDetails'],
    [/clear the search|whole catalog/, 'catalog.clearSearch'],
    [/empty my cart/, 'cart.clearCart'],
    [/add .*cart/, 'cart.addToCart'],
    [/show|search/, 'catalog.searchProducts'],
  ];
  const action =
    rules.find(([pattern]) => pattern.test(text))?.[1] ?? 'needs_screen_change';
  const answers: Record<string, { choice: string; confidence: number }> = {
    action: { choice: action, confidence: 0.5 },
    scope: {
      choice: action === 'needs_screen_change' ? 'screen_change' : 'one_action',
      confidence: 0.5,
    },
  };
  for (const [id, question] of Object.entries(request.questions)) {
    if (id === 'action' || id === 'scope') continue;
    const options = Object.entries(question.criteria);
    const literal = options.find(
      ([key, label]) =>
        key.startsWith('v') &&
        text.includes(label.split(':')[0].replaceAll('"', '').toLowerCase()),
    );
    const usual =
      id === 'param_sku' && /usual|similar/.test(text)
        ? options.find(([, label]) =>
            label.startsWith(String(state.facts?.latestOrderSku)),
          )
        : undefined;
    const choice =
      id === 'param_lowerFatOnly'
        ? /lower-fat|less fat/.test(text)
          ? 'true'
          : 'not_stated'
        : id === 'param_query' && /salmon/.test(text)
          ? 'stated_other'
          : ((usual ?? literal)?.[0] ?? 'not_stated');
    answers[id] = { choice, confidence: 0.5 };
  }
  return answers;
}
