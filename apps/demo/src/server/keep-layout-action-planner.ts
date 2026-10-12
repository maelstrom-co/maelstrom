// PROTOTYPE (MAE-826): throwaway composed Planner light tier, never merge.
/**
 * The light tier of the composed Planner: one constrained decision-model
 * call (TypeSafe Jev) picks a single Vessel action and its parameters, and
 * the current tiling layout is echoed with the post-transition variants and
 * a templated `userMessage`. No LLM call. Anything outside that shape hands
 * off with a `Deferred`, so `withFallback` runs the full LLM Planner.
 */
import {
  cancellationError,
  deferred,
  enumSnapshotFor,
  type PlannerCandidate,
  type PlanningInput,
  type Stage,
  type StageContext,
} from '@maelstrom-co/engine';
import { layoutFits } from '@maelstrom-co/planner-jev/_internal';
import {
  type ActionParameter,
  err,
  type InstanceId,
  isErr,
  ok,
  type TilingLayout,
  tilingLeafInstanceId,
  type Vessel,
  type VesselAction,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';
import { productBySku, SEED_ORDERS } from '../lib/pet-shop-fixtures';

export const DECISION_TIMEOUT_MS = 800;

const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const FACTS_PREFIX = 'Facts: ';
const REQUIRED_PREFIX = 'Required actions: ';
const NEEDS_SCREEN_CHANGE = 'needs_screen_change';
const STATED_OTHER = 'stated_other';
const NOT_STATED = 'not_stated';
const ACTION_QUESTION = 'action';
const SCOPE_QUESTION = 'scope';
const ONE_ACTION = 'one_action';
const MAX_OPTIONS = 250;

/**
 * Cart and order mutations. Like every non-idempotent action, they ship only
 * as required actions from the loop, never from a decision-model pick.
 */
export const SHOP_SIDE_EFFECT_ACTIONS: ReadonlySet<string> = new Set([
  'addToCart',
  'removeFromCart',
  'updateCartQuantity',
  'clearCart',
  'placeOrder',
]);

/** Structured facts the loop attaches to an intent, e.g. `{ latestOrderSku, similarSkus }`. */
export type IntentMetadata = Readonly<Record<string, unknown>>;

/** A side effect the loop decided on; the light tier ships it as given. */
export interface RequiredActionSpec {
  readonly vesselId: string;
  readonly action: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** What the light tier reads from one Planner call. */
export interface StructuredIntent {
  /** The intent in plain words. */
  readonly intent: string;
  readonly metadata: IntentMetadata;
  readonly requiredActions: readonly RequiredActionSpec[];
}

/**
 * Renders an intent the way the Engine facade does: the plain intent, then a
 * `Facts:` JSON line and a `Required actions:` line when present. The
 * `user_intent` reason only carries a string, so this is how facts reach the
 * LLM tier; the light tier prefers `intentOf` and parses this as a fallback.
 */
export function intentWithMetadata(
  intent: string,
  metadata: IntentMetadata | undefined,
  requiredActions: readonly RequiredActionSpec[] = [],
): string {
  const lines = [intent];
  if (metadata && Object.keys(metadata).length > 0)
    lines.push(`${FACTS_PREFIX}${JSON.stringify(metadata)}`);
  if (requiredActions.length > 0)
    lines.push(
      `${REQUIRED_PREFIX}${requiredActions
        .map(
          (required) =>
            `${required.vesselId}.${required.action} ${JSON.stringify(required.params)}`,
        )
        .join('; ')}`,
    );
  return lines.join('\n');
}

/**
 * Reads an intent rendered by {@link intentWithMetadata}. Null when it has a
 * `Required actions:` line this cannot parse: guessing a side effect is worse
 * than handing off.
 */
export function parseStructuredIntent(text: string): StructuredIntent | null {
  const kept: string[] = [];
  let metadata: IntentMetadata = {};
  let requiredActions: RequiredActionSpec[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith(FACTS_PREFIX)) {
      const parsed = parseJson(line.slice(FACTS_PREFIX.length));
      if (isRecord(parsed)) {
        metadata = parsed;
        continue;
      }
    }
    if (line.startsWith(REQUIRED_PREFIX)) {
      const parsed = parseRequiredActions(line.slice(REQUIRED_PREFIX.length));
      if (!parsed) return null;
      requiredActions = parsed;
      continue;
    }
    kept.push(line);
  }
  return { intent: kept.join('\n').trim(), metadata, requiredActions };
}

/** One answer of the decision model. */
export interface DecisionAnswer {
  readonly choice: string;
  readonly confidence: number;
}

/** A multiple-choice question; option keys are the criteria keys. */
export interface DecisionQuestion {
  readonly type: 'choice';
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string>>;
}

/** One decision-model request: shared state plus the questions about it. */
export interface DecisionRequest {
  readonly state: unknown;
  readonly questions: Readonly<Record<string, DecisionQuestion>>;
}

/** Answers keyed by question id. */
export type DecisionReply = Readonly<Record<string, DecisionAnswer>>;

/**
 * Asks the decision model. Rejects on transport failure or abort; the
 * light tier turns both into a hand-off.
 */
export type ActionDecider = (
  request: DecisionRequest,
  signal: AbortSignal,
) => Promise<DecisionReply>;

/** TypeSafe Jev as the decision model, called the same way as the Jev router. */
export function createJevActionDecider(options: {
  readonly apiKey: string;
  readonly model: string;
  readonly endpoint?: string;
}): ActionDecider {
  return async (request, signal) => {
    const response = await fetch(options.endpoint ?? JEV_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model,
        state: request.state,
        questions: request.questions,
      }),
      signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error(`Jev HTTP ${response.status}`);
    }
    const body = (await response.json()) as {
      answers?: Record<string, { choice?: unknown; confidence?: unknown }>;
    };
    const answers: Record<string, DecisionAnswer> = {};
    for (const [id, answer] of Object.entries(body.answers ?? {})) {
      if (typeof answer?.choice !== 'string') continue;
      answers[id] = {
        choice: answer.choice,
        confidence:
          typeof answer.confidence === 'number' ? answer.confidence : 0,
      };
    }
    return answers;
  };
}

/**
 * The Jev decider when `TYPESAFE_API_KEY` and `JEV_MODEL` are set, else
 * null. Takes the env as a parameter because the Worker has no
 * `process.env`.
 */
export function keepLayoutDeciderFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): ActionDecider | null {
  const apiKey = env.TYPESAFE_API_KEY?.trim();
  const model = env.JEV_MODEL?.trim();
  return apiKey && model ? createJevActionDecider({ apiKey, model }) : null;
}

/** Why the light tier handed the request to the LLM Planner. */
export type KeepLayoutHandoff =
  | 'decision_unconfigured'
  | 'not_a_single_user_intent'
  | 'not_tiling'
  | 'required_actions_unparsed'
  | 'decision_timeout'
  | 'decision_error'
  | 'needs_screen_change'
  | 'low_confidence'
  | 'target_not_visible'
  | 'ambiguous_target'
  | 'action_not_offered_at_variant'
  | 'parameter_missing'
  | 'parameter_needs_generated_text'
  | 'parameter_not_offered'
  | 'side_effect_not_required'
  | 'layout_no_longer_fits'
  | 'validation_rejected';

/** What the light tier did for one request, handed off or not. */
export interface KeepLayoutOutcome {
  readonly handoff: KeepLayoutHandoff | null;
  readonly detail: string | null;
  /** Where the action came from: the decision model or the loop's required actions. */
  readonly via: 'decision' | 'required_actions' | null;
  /** `vesselId.actionName` picked or required (`+`-joined when several), even on a hand-off. */
  readonly action: string | null;
  readonly params: Readonly<Record<string, unknown>> | null;
  readonly confidence: number | null;
  readonly decisionMs: number | null;
}

/** The action the light tier is about to ship, for the `userMessage` template. */
export interface KeepLayoutPick {
  readonly vessel: Vessel;
  readonly action: VesselAction;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface KeepLayoutActionPlannerOptions {
  /** Null hands off every request without required actions (`decision_unconfigured`). */
  readonly decider: ActionDecider | null;
  /**
   * The structured intent behind a call, for example the Engine facade's
   * `plannerIntentOf`. When it returns undefined the tier parses the
   * `user_intent` text with {@link parseStructuredIntent}.
   */
  readonly intentOf?: (input: PlanningInput) => StructuredIntent | undefined;
  /** Hand off when the decision model has not answered by then. Defaults to 800 ms. */
  readonly timeoutMs?: number;
  /** Hand off when the action pick's confidence is below this. Defaults to 0 (off). */
  readonly minConfidence?: number;
  /** Writes the `userMessage`. Defaults to {@link shopUserMessage}. */
  readonly userMessage?: (pick: KeepLayoutPick) => string;
  /** How an enum value is described to the decision model. Defaults to {@link shopOptionLabel}. */
  readonly optionLabel?: (parameterName: string, value: unknown) => string;
  /**
   * Whether an action is a side effect a decision-model pick must never
   * ship. Defaults to non-idempotent actions plus {@link SHOP_SIDE_EFFECT_ACTIONS}.
   */
  readonly isSideEffect?: (action: VesselAction) => boolean;
  /** Called once per request with what the tier did. */
  readonly onOutcome?: (
    input: PlanningInput,
    outcome: KeepLayoutOutcome,
  ) => void;
}

/**
 * The light tier. Required actions from the loop ship as given with no model
 * call. Otherwise one decision call picks the action and its parameters.
 * Defers on: more than one update reason or a non-intent reason, a grid
 * layout, decision timeout or failure, `needs_screen_change` (screen change
 * or several steps), a side effect the decision model picked (side effects
 * ship only as required actions), a target Vessel that is not visible, an
 * action the Vessel's current variant does not offer, a parameter that is
 * missing or needs generated text, a layout that no longer fits after the
 * transition, or a candidate validation would heal.
 */
export function keepLayoutActionPlanner(
  options: KeepLayoutActionPlannerOptions,
): Stage<PlanningInput, PlannerCandidate> {
  const timeoutMs = options.timeoutMs ?? DECISION_TIMEOUT_MS;
  const minConfidence = options.minConfidence ?? 0;
  const writeMessage = options.userMessage ?? shopUserMessage;
  const optionLabel = options.optionLabel ?? shopOptionLabel;
  const isSideEffect = options.isSideEffect ?? isShopSideEffect;

  return async (input, ctx) => {
    let outcome: Omit<KeepLayoutOutcome, 'handoff' | 'detail'> = {
      via: null,
      action: null,
      params: null,
      confidence: null,
      decisionMs: null,
    };
    const handOff = (handoff: KeepLayoutHandoff, detail?: string) => {
      options.onOutcome?.(input, {
        ...outcome,
        handoff,
        detail: detail ?? null,
      });
      return err(
        deferred(`keep_layout/${handoff}${detail ? ` (${detail})` : ''}`),
      );
    };

    const { request } = input;
    const reasons = request.context.updateReasons;
    const reason = reasons[0];
    if (reasons.length !== 1 || reason?.type !== 'user_intent')
      return handOff('not_a_single_user_intent');
    if (request.layout.type !== 'tiling') return handOff('not_tiling');
    const layout = request.layout;
    const structured =
      options.intentOf?.(input) ?? parseStructuredIntent(reason.intent);
    if (!structured) return handOff('required_actions_unparsed');
    const { intent, metadata } = structured;
    const visible = visibleInstanceIds(layout);
    const declared = withHiddenInstances(request.instances, layout);

    const visibleTarget = (vesselId: string) => {
      const targets = request.instances.filter(
        (instance) =>
          instance.vesselId === vesselId && visible.has(instance.instanceId),
      );
      if (targets.length === 0) return 'target_not_visible' as const;
      if (targets.length > 1) return 'ambiguous_target' as const;
      return targets[0];
    };

    const ship = (steps: readonly PlannedStep[], rationale: string) => {
      const variants = new Map(
        declared.map((instance) => [instance.instanceId, instance.variant]),
      );
      const messages: string[] = [];
      const executionPlan: {
        instanceId: InstanceId;
        action: VesselAction['name'];
        paramsJson?: string;
      }[] = [];
      for (const step of steps) {
        const current =
          variants.get(step.target.instanceId) ?? step.target.variant;
        const definition = step.vessel.variants[current]?.actions.find(
          (action) => action.name === step.actionName,
        );
        if (!definition)
          return handOff(
            'action_not_offered_at_variant',
            `${step.vessel.id}.${step.actionName} at ${current}`,
          );
        if (definition.transitionsTo)
          variants.set(step.target.instanceId, definition.transitionsTo);
        messages.push(
          writeMessage({
            vessel: step.vessel,
            action: definition,
            params: step.params,
          }),
        );
        executionPlan.push({
          instanceId: step.target.instanceId,
          action: definition.name,
          ...(Object.keys(step.params).length > 0 && {
            paramsJson: JSON.stringify(step.params),
          }),
        });
      }
      const after = declared.map((instance) => ({
        ...instance,
        variant: variants.get(instance.instanceId) ?? instance.variant,
      }));
      if (
        !layoutFits(
          request,
          layout.tree,
          after.filter((instance) => visible.has(instance.instanceId)),
        )
      )
        return handOff('layout_no_longer_fits');

      const candidate: PlannerCandidate = {
        userMessage: messages.join(' '),
        rationale: `keep-layout light tier: ${rationale}.`,
        executionPlan,
        layout: { tree: layout.tree, instances: after },
      };
      const report = ctx.validate(candidate);
      if (isErr(report))
        return handOff('validation_rejected', report.error.message);
      const { diagnostics } = report.value;
      if (
        diagnostics.retryHint.recommend ||
        diagnostics.counts.skippedActions > 0 ||
        diagnostics.counts.droppedLayoutEntries > 0
      )
        return handOff(
          'validation_rejected',
          diagnostics.feedback.slice(0, 200),
        );
      options.onOutcome?.(input, { ...outcome, handoff: null, detail: null });
      return ok(candidate);
    };

    if (structured.requiredActions.length > 0) {
      const required = structured.requiredActions;
      outcome = {
        ...outcome,
        via: 'required_actions',
        action: required
          .map((entry) => `${entry.vesselId}.${entry.action}`)
          .join('+'),
        params: required.length === 1 ? required[0].params : null,
      };
      const steps: PlannedStep[] = [];
      for (const entry of required) {
        const vessel = request.vessels.find(
          (candidate) => candidate.id === entry.vesselId,
        );
        if (!vessel) return handOff('target_not_visible', entry.vesselId);
        const target = visibleTarget(entry.vesselId);
        if (typeof target === 'string') return handOff(target, entry.vesselId);
        steps.push({
          vessel,
          target,
          actionName: entry.action,
          params: entry.params,
        });
      }
      return ship(steps, 'required actions from the loop');
    }

    if (!options.decider) return handOff('decision_unconfigured');
    const actions = actionOptions(request.vessels, isSideEffect);
    const parameters = parameterQuestions(
      request.vessels,
      ctx,
      intent,
      metadata,
      optionLabel,
    );
    const decisionRequest: DecisionRequest = {
      state: {
        latestRequest: intent,
        ...(Object.keys(metadata).length > 0 && { facts: metadata }),
        screen: request.instances.map((instance) => ({
          vessel: instance.vesselId,
          view: instance.variant,
          onScreen: visible.has(instance.instanceId),
        })),
      },
      questions: {
        [SCOPE_QUESTION]: SCOPE,
        [ACTION_QUESTION]: actionQuestion(actions),
        ...Object.fromEntries(
          [...parameters].map(([id, slot]) => [id, slot.question]),
        ),
      },
    };

    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = ctx.signal
      ? AbortSignal.any([ctx.signal, timeout])
      : timeout;
    const decisionStarted = performance.now();
    let reply: DecisionReply;
    try {
      reply = await options.decider(decisionRequest, signal);
    } catch (error) {
      outcome = { ...outcome, decisionMs: since(decisionStarted) };
      if (ctx.signal?.aborted)
        return err(
          cancellationError(
            'keep-layout decision cancelled',
            ctx.signal.reason,
          ),
        );
      if (timeout.aborted)
        return handOff('decision_timeout', `${timeoutMs} ms`);
      return handOff(
        'decision_error',
        error instanceof Error ? error.message : String(error),
      );
    }
    const pickAnswer = reply[ACTION_QUESTION];
    outcome = {
      ...outcome,
      via: 'decision',
      decisionMs: since(decisionStarted),
      action: pickAnswer?.choice ?? null,
      confidence: pickAnswer?.confidence ?? null,
    };
    if (!pickAnswer) return handOff('decision_error', 'no action answer');
    const scope = reply[SCOPE_QUESTION]?.choice;
    if (scope !== undefined && scope !== ONE_ACTION)
      return handOff('needs_screen_change', scope);
    if (pickAnswer.choice === NEEDS_SCREEN_CHANGE)
      return handOff('needs_screen_change');
    if (pickAnswer.confidence < minConfidence)
      return handOff('low_confidence', pickAnswer.confidence.toFixed(2));
    const picked = actions.get(pickAnswer.choice);
    if (!picked) return handOff('decision_error', 'unknown action option');
    if (picked.sideEffect)
      return handOff('side_effect_not_required', pickAnswer.choice);

    const target = visibleTarget(picked.vessel.id);
    if (typeof target === 'string') return handOff(target);
    const definition = picked.vessel.variants[target.variant]?.actions.find(
      (action) => action.name === picked.actionName,
    );
    if (!definition)
      return handOff('action_not_offered_at_variant', target.variant);

    const params: Record<string, unknown> = {};
    for (const parameter of definition.parameters ?? []) {
      const bound = bindParameter(
        parameter,
        metadata,
        reply[parameterQuestionId(parameter.name)],
        parameters.get(parameterQuestionId(parameter.name)),
        ctx,
        request.vessels,
      );
      if (bound.kind === 'handoff') {
        outcome = { ...outcome, params };
        return handOff(bound.handoff, parameter.name);
      }
      if (bound.kind === 'value') params[parameter.name] = bound.value;
    }
    outcome = { ...outcome, params };
    return ship(
      [{ vessel: picked.vessel, target, actionName: definition.name, params }],
      `${pickAnswer.choice} on ${target.instanceId} (decision confidence ${pickAnswer.confidence.toFixed(2)})`,
    );
  };
}

/** Templated `userMessage` for the pet-food shop Vessels, generic otherwise. */
export function shopUserMessage(pick: KeepLayoutPick): string {
  const { params } = pick;
  const product = (sku: unknown) =>
    productBySku(String(sku))?.name ?? String(sku);
  switch (`${pick.vessel.id}.${pick.action.name}`) {
    case 'orders.showMostRecentOrder':
      return 'Here is your most recent order.';
    case 'orders.showOrderDetails':
      return `Here is order ${String(params.orderId)}.`;
    case 'orders.backToOrderList':
      return 'Here are your past orders.';
    case 'catalog.findSimilarProducts':
      return params.lowerFatOnly === true
        ? `Here are lower-fat options similar to ${product(params.sku)}.`
        : `Here are products similar to ${product(params.sku)}.`;
    case 'catalog.searchProducts':
      return 'Here are the matching products.';
    case 'catalog.showProductDetails':
      return `Here are the details for ${product(params.sku)}.`;
    case 'catalog.clearSearch':
      return 'Here is the whole catalog.';
    case 'catalog.backToResults':
      return 'Back to the search results.';
    case 'cart.addToCart':
      return `Added ${Number(params.quantity ?? 1)} x ${product(params.sku)} to your cart.`;
    case 'cart.removeFromCart':
      return `Removed ${product(params.sku)} from your cart.`;
    case 'cart.updateCartQuantity':
      return `Your cart now has ${Number(params.quantity)} x ${product(params.sku)}.`;
    case 'cart.clearCart':
      return 'Your cart is empty now.';
    case 'checkout.placeOrder':
      return 'Your order is placed.';
    case 'checkout.returnToCheckoutReview':
      return 'Back to the checkout review.';
    default:
      return `Done: ${words(pick.action.name)} on ${pick.vessel.name}.`;
  }
}

/** Describes shop SKUs and order ids so the decision model can resolve names. */
export function shopOptionLabel(parameterName: string, value: unknown): string {
  if (typeof value === 'string') {
    const product = productBySku(value);
    if (product)
      return `${value}: ${product.name} (${product.species}, ${product.foodType}, ${product.fatPercent}% fat)`;
    const order = SEED_ORDERS.find((entry) => entry.id === value);
    if (order)
      return `${value}: order placed ${order.placedOn} (${order.items.map((item) => item.name).join(', ')})`;
  }
  return parameterName === 'quantity' ? String(value) : JSON.stringify(value);
}

interface PlannedStep {
  readonly vessel: Vessel;
  readonly target: VesselInstanceSnapshot;
  readonly actionName: string;
  readonly params: Readonly<Record<string, unknown>>;
}

interface ActionOption {
  readonly vessel: Vessel;
  readonly actionName: VesselAction['name'];
  readonly description: string;
  readonly sideEffect: boolean;
}

interface ParameterSlot {
  readonly question: DecisionQuestion;
  /** Option key to the value it stands for. */
  readonly values: ReadonlyMap<string, unknown>;
}

type Binding =
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'omit' }
  | { readonly kind: 'handoff'; readonly handoff: KeepLayoutHandoff };

function actionOptions(
  vessels: readonly Vessel[],
  isSideEffect: (action: VesselAction) => boolean,
): Map<string, ActionOption> {
  const options = new Map<string, ActionOption>();
  for (const vessel of vessels)
    for (const variant of Object.values(vessel.variants))
      for (const action of variant.actions) {
        const key = `${vessel.id}.${action.name}`;
        if (options.has(key)) continue;
        options.set(key, {
          vessel,
          actionName: action.name,
          description: `${vessel.name}: ${action.description}`,
          sideEffect: isSideEffect(action),
        });
      }
  return options;
}

// Asked beside the action pick: a forced action choice alone maps "make the
// catalog bigger" or two-step requests onto the nearest single action.
const SCOPE: DecisionQuestion = {
  type: 'choice',
  instructions: 'What kind of change does the latest request ask for?',
  criteria: {
    [ONE_ACTION]:
      'Exactly one thing done inside one Vessel: one search, one item opened, one cart change, one step back.',
    several_actions:
      'Two or more things, for example joined by "and" or "then", each needing its own step.',
    screen_change:
      'A change to the screen itself: making a Vessel bigger or smaller, showing, hiding, adding, moving or rearranging Vessels.',
  },
};

function actionQuestion(
  actions: ReadonlyMap<string, ActionOption>,
): DecisionQuestion {
  return {
    type: 'choice',
    instructions:
      'Which single Vessel action carries out the latest request? A request to "show" or "open" something counts when one listed action shows it inside its Vessel. Pick the action even if its Vessel is not on screen right now. Use the facts to resolve references such as "my usual food".',
    criteria: {
      ...Object.fromEntries(
        [...actions].map(([key, option]) => [key, option.description]),
      ),
      [NEEDS_SCREEN_CHANGE]:
        'Not one action inside a Vessel: the request asks to show, hide, add, enlarge, shrink or rearrange Vessels on screen, needs two or more actions, or no listed action does it.',
    },
  };
}

function parameterQuestionId(name: string): string {
  return `param_${name}`;
}

/**
 * One question per parameter name, shared by every action declaring it, so
 * a single decision call answers the action and its parameters together.
 */
function parameterQuestions(
  vessels: readonly Vessel[],
  ctx: StageContext,
  intent: string,
  metadata: IntentMetadata,
  optionLabel: (parameterName: string, value: unknown) => string,
): Map<string, ParameterSlot> {
  const byName = new Map<string, ActionParameter[]>();
  const siblings = new Map<string, Map<string, string>>();
  for (const vessel of vessels)
    for (const variant of Object.values(vessel.variants))
      for (const action of variant.actions)
        for (const parameter of action.parameters ?? []) {
          const list = byName.get(parameter.name) ?? [];
          list.push(parameter);
          byName.set(parameter.name, list);
          const others = siblings.get(parameter.name) ?? new Map();
          for (const other of action.parameters ?? [])
            if (other.name !== parameter.name)
              others.set(other.name, other.description);
          siblings.set(parameter.name, others);
        }

  const slots = new Map<string, ParameterSlot>();
  for (const [name, definitions] of byName) {
    const type = definitions[0].type;
    if (definitions.some((definition) => definition.type !== type)) continue;
    const enumerated = uniqueValues(
      definitions.flatMap((definition) =>
        enumValuesOf(definition, ctx, vessels),
      ),
    );
    const candidates =
      type === 'boolean'
        ? []
        : enumerated.length > 0
          ? enumerated
          : type === 'number'
            ? numbersIn(intent, metadata)
            : [];
    if (candidates.length > MAX_OPTIONS) continue;
    const values = new Map<string, unknown>();
    const criteria: Record<string, string> = {};
    if (type === 'boolean') {
      values.set('true', true);
      values.set('false', false);
      criteria.true = 'The request asks for it (yes).';
      criteria.false = 'The request asks for the opposite (no).';
    }
    candidates.forEach((value, index) => {
      values.set(`v${index}`, value);
      criteria[`v${index}`] = optionLabel(name, value);
    });
    const freeText = type === 'string' && enumerated.length === 0;
    criteria[STATED_OTHER] = freeText
      ? 'Yes: some words for it remain.'
      : 'The request gives a value, but none of the listed options matches it.';
    criteria[NOT_STATED] = freeText
      ? 'No: nothing remains beyond what the other parameters handle and generic words such as show, search, find or food.'
      : 'The request does not give a value for it.';
    const descriptions = [
      ...new Set(definitions.map((definition) => definition.description)),
    ].join(' / ');
    // Free text is asked as "what is left over": asked for its value
    // directly, Jev reads "salmon" and "dry cat food" alike.
    const others = [...(siblings.get(name) ?? [])]
      .map(([other, description]) => `${other} (${description})`)
      .join('; ');
    const instructions = freeText
      ? `Parameter "${name}" (string): ${descriptions}${others ? ` Other parameters handle: ${others}.` : ''} Does the latest request contain words for "${name}" that are left over after removing what the other parameters handle?`
      : `For an action parameter "${name}" (${type}: ${descriptions}), which value does the latest request give? Resolve references such as "my usual food" or "my last order" with the facts.`;
    slots.set(parameterQuestionId(name), {
      question: { type: 'choice', instructions, criteria },
      values,
    });
  }
  return slots;
}

function bindParameter(
  parameter: ActionParameter,
  metadata: IntentMetadata,
  answer: DecisionAnswer | undefined,
  slot: ParameterSlot | undefined,
  ctx: StageContext,
  vessels: readonly Vessel[],
): Binding {
  const allowed = enumValuesOf(parameter, ctx, vessels);
  const optional = parameter.required === false;
  if (Object.hasOwn(metadata, parameter.name)) {
    const value = metadata[parameter.name];
    return accepts(parameter, allowed, value)
      ? { kind: 'value', value }
      : { kind: 'handoff', handoff: 'parameter_not_offered' };
  }
  if (!answer || !slot)
    return optional
      ? { kind: 'omit' }
      : { kind: 'handoff', handoff: 'parameter_missing' };
  if (answer.choice === NOT_STATED)
    return optional
      ? { kind: 'omit' }
      : { kind: 'handoff', handoff: 'parameter_missing' };
  if (answer.choice === STATED_OTHER)
    return { kind: 'handoff', handoff: 'parameter_needs_generated_text' };
  if (!slot.values.has(answer.choice))
    return { kind: 'handoff', handoff: 'parameter_not_offered' };
  const value = slot.values.get(answer.choice);
  if (!accepts(parameter, allowed, value))
    return { kind: 'handoff', handoff: 'parameter_not_offered' };
  return { kind: 'value', value };
}

function isShopSideEffect(action: VesselAction): boolean {
  return !action.idempotent || SHOP_SIDE_EFFECT_ACTIONS.has(action.name);
}

function enumValuesOf(
  parameter: ActionParameter,
  ctx: StageContext,
  vessels: readonly Vessel[],
): readonly unknown[] {
  const snapshot = enumSnapshotFor(ctx, vessels);
  if (snapshot) return snapshot.get(parameter).map((entry) => entry.value);
  return parameter.enum ?? [];
}

function accepts(
  parameter: ActionParameter,
  allowed: readonly unknown[],
  value: unknown,
): boolean {
  if (parameter.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  } else if (parameter.type === 'object') {
    if (!isRecord(value)) return false;
  } else if (typeof value !== parameter.type) return false;
  if (allowed.length === 0) return true;
  const json = JSON.stringify(value);
  return allowed.some((entry) => JSON.stringify(entry) === json);
}

function uniqueValues(values: readonly unknown[]): unknown[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function numbersIn(intent: string, metadata: IntentMetadata): number[] {
  const fromText = [...intent.matchAll(/\d+(?:\.\d+)?/g)].map((match) =>
    Number(match[0]),
  );
  const fromFacts = Object.values(metadata).filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value),
  );
  return uniqueValues([...fromText, ...fromFacts]) as number[];
}

function visibleInstanceIds(layout: TilingLayout): Set<InstanceId> {
  const ids = new Set<InstanceId>();
  for (const node of layout.tree) {
    const id = tilingLeafInstanceId(node);
    if (id) ids.add(id);
  }
  return ids;
}

// Hidden instances live only in the tiling layout's declarations; echoing
// them keeps them alive, since a candidate's instance list is the full set.
function withHiddenInstances(
  instances: readonly VesselInstanceSnapshot[],
  layout: TilingLayout,
): VesselInstanceSnapshot[] {
  const known = new Set(instances.map((instance) => instance.instanceId));
  return [
    ...instances,
    ...layout.instances.filter((instance) => !known.has(instance.instanceId)),
  ];
}

function parseRequiredActions(text: string): RequiredActionSpec[] | null {
  const specs: RequiredActionSpec[] = [];
  for (const part of text.split('; ')) {
    const match = /^([^.\s]+)\.(\S+) (\{.*\})$/.exec(part.trim());
    const params = match ? parseJson(match[3]) : undefined;
    if (!match || !isRecord(params)) return null;
    specs.push({ vesselId: match[1], action: match[2], params });
  }
  return specs;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function words(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function since(started: number): number {
  return Math.round(performance.now() - started);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
