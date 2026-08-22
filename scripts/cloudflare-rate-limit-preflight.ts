import {
  DESIRED_WAITLIST_RATE_LIMIT_EXPRESSION,
  LEGACY_WAITLIST_RATE_LIMIT_EXPRESSION,
  PRODUCTION_RATE_LIMIT,
  PRODUCTION_RATE_LIMIT_RULES,
} from '../infra/platform/src/RateLimitContract.js';

const toApiRule = (rule: (typeof PRODUCTION_RATE_LIMIT_RULES)[number]) => ({
  id: rule.id,
  ref: rule.ref,
  action: rule.action,
  description: rule.description,
  enabled: rule.enabled,
  expression: rule.expression,
  ratelimit: {
    characteristics: [...rule.ratelimit.characteristics],
    mitigation_timeout: rule.ratelimit.mitigationTimeout,
    period: rule.ratelimit.period,
    requests_per_period: rule.ratelimit.requestsPerPeriod,
  },
});

const desiredApiRules = PRODUCTION_RATE_LIMIT_RULES.map(toApiRule);
const legacyApiRules = desiredApiRules.map((rule, index) =>
  index === 1
    ? { ...rule, expression: LEGACY_WAITLIST_RATE_LIMIT_EXPRESSION }
    : rule,
);

const legacyBaseline = {
  errors: [],
  messages: [],
  result: {
    description: PRODUCTION_RATE_LIMIT.description,
    id: PRODUCTION_RATE_LIMIT.rulesetId,
    kind: PRODUCTION_RATE_LIMIT.kind,
    name: PRODUCTION_RATE_LIMIT.name,
    phase: PRODUCTION_RATE_LIMIT.phase,
    rules: legacyApiRules,
    source: 'rate_limit',
  },
  success: true,
} as const;

const desiredBaseline = {
  ...legacyBaseline,
  result: {
    ...legacyBaseline.result,
    rules: desiredApiRules,
  },
};

const apiVolatileFields = new Set(['last_updated', 'version']);
const stateVolatileFields = new Set(['lastUpdated', 'version']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const withoutFields = (
  value: Record<string, unknown>,
  fields: ReadonlySet<string>,
) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !fields.has(key)));

const apiSemanticValue = (value: unknown): unknown => {
  if (!isRecord(value) || !isRecord(value.result)) return value;

  const result = withoutFields(value.result, apiVolatileFields);
  if (Array.isArray(value.result.rules)) {
    result.rules = value.result.rules.map((rule) =>
      isRecord(rule) ? withoutFields(rule, apiVolatileFields) : rule,
    );
  }
  return { ...value, result };
};

const firstDifference = (
  actual: unknown,
  expected: unknown,
  path = '',
): string | undefined => {
  if (Object.is(actual, expected)) return undefined;
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) return path;
    if (actual.length !== expected.length) return path;
    for (let index = 0; index < actual.length; index++) {
      const difference = firstDifference(
        actual[index],
        expected[index],
        `${path}[${index}]`,
      );
      if (difference) return difference;
    }
    return undefined;
  }
  if (isRecord(actual) || isRecord(expected)) {
    if (!isRecord(actual) || !isRecord(expected)) return path;
    const actualKeys = Object.keys(actual).sort();
    const expectedKeys = Object.keys(expected).sort();
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, index) => key !== expectedKeys[index])
    ) {
      return path || 'response';
    }
    for (const key of expectedKeys) {
      const difference = firstDifference(
        actual[key],
        expected[key],
        path ? `${path}.${key}` : key,
      );
      if (difference) return difference;
    }
    return undefined;
  }
  return path;
};

/**
 * Rejects a live rate-limit phase unless it is the legacy baseline or the exact
 * owned state. Unknown semantic fields fail because Alchemy replaces the full
 * rule list and would otherwise erase them.
 */
export const assertRateLimitPhaseBaseline = (value: unknown): void => {
  const actual = apiSemanticValue(value);
  const legacyDifference = firstDifference(actual, legacyBaseline);
  if (!legacyDifference) return;
  const desiredDifference = firstDifference(actual, desiredBaseline);
  if (!desiredDifference) return;

  const actualExpression = isRecord(value)
    ? (value.result as { rules?: Array<{ expression?: unknown }> } | undefined)
        ?.rules?.[1]?.expression
    : undefined;
  const difference =
    actualExpression === DESIRED_WAITLIST_RATE_LIMIT_EXPRESSION
      ? desiredDifference
      : legacyDifference;
  throw new Error(
    `Production rate-limit phase drift detected at ${difference || 'response'}`,
  );
};

export const assertDesiredRateLimitPhase = (value: unknown): void => {
  const difference = firstDifference(apiSemanticValue(value), desiredBaseline);
  if (difference) {
    throw new Error(
      `Live production rate-limit phase differs at ${difference}`,
    );
  }
};

const desiredStateAttributes = {
  rulesetId: PRODUCTION_RATE_LIMIT.rulesetId,
  zoneId: PRODUCTION_RATE_LIMIT.zoneId,
  kind: PRODUCTION_RATE_LIMIT.kind,
  name: PRODUCTION_RATE_LIMIT.name,
  phase: PRODUCTION_RATE_LIMIT.phase,
  description: PRODUCTION_RATE_LIMIT.description,
  rules: PRODUCTION_RATE_LIMIT_RULES,
};

export const assertRateLimitRulesetState = (value: unknown): void => {
  const attributes = isRecord(value) ? value.attr : undefined;
  const actual = isRecord(attributes)
    ? withoutFields(attributes, stateVolatileFields)
    : attributes;
  const difference = firstDifference(actual, desiredStateAttributes, 'attr');
  if (difference) {
    throw new Error(
      `Persisted production rate-limit Ruleset differs at ${difference}`,
    );
  }
};

const fetchRateLimitPhase = async (
  apiToken: string,
  request: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response> = fetch,
): Promise<unknown> => {
  const response = await request(
    `https://api.cloudflare.com/client/v4/zones/${PRODUCTION_RATE_LIMIT.zoneId}/rulesets/phases/${PRODUCTION_RATE_LIMIT.phase}/entrypoint`,
    {
      headers: { Authorization: `Bearer ${apiToken}` },
    },
  );
  if (!response.ok) {
    throw new Error(
      `Cloudflare rate-limit preflight failed with HTTP ${response.status}`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      'Cloudflare rate-limit preflight did not return valid JSON',
    );
  }
  return body;
};

export const preflightRateLimitPhase = async (
  apiToken: string,
  request: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response> = fetch,
): Promise<void> => {
  assertRateLimitPhaseBaseline(await fetchRateLimitPhase(apiToken, request));
};

export const verifyRateLimitPhase = async (
  apiToken: string,
  request: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response> = fetch,
): Promise<void> => {
  assertDesiredRateLimitPhase(await fetchRateLimitPhase(apiToken, request));
};

if (import.meta.main) {
  const mode = Bun.argv[2];
  if (mode === 'state') {
    let state: unknown;
    try {
      state = JSON.parse(await Bun.stdin.text());
    } catch {
      throw new Error('Alchemy Ruleset state did not contain valid JSON');
    }
    assertRateLimitRulesetState(state);
    console.log('Production rate-limit Ruleset state verified');
  } else if (mode === undefined || mode === 'verify') {
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    if (!apiToken) throw new Error('CLOUDFLARE_API_TOKEN is required');
    if (mode === 'verify') {
      await verifyRateLimitPhase(apiToken);
      console.log('Live production rate-limit phase verified');
    } else {
      await preflightRateLimitPhase(apiToken);
      console.log('Production rate-limit phase preflight passed');
    }
  } else {
    throw new Error(`Unknown rate-limit validation mode: ${mode}`);
  }
}
