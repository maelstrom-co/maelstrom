import { describe, expect, test } from 'bun:test';
import {
  assertDesiredRateLimitPhase,
  assertRateLimitPhaseBaseline,
  assertRateLimitRulesetState,
  preflightRateLimitPhase,
  verifyRateLimitPhase,
} from './cloudflare-rate-limit-preflight';

const baseline = () => ({
  result: {
    description: '',
    id: '189a3c2125bc40c2b9565ae2268587ed',
    kind: 'zone',
    last_updated: 'volatile',
    name: 'default',
    phase: 'http_ratelimit',
    rules: [
      {
        action: 'block',
        description: 'Leaked credential check',
        enabled: true,
        expression: '(cf.waf.credential_check.password_leaked)',
        id: '0bbc7a5acc5d4f66b7a034567dc802b1',
        last_updated: 'volatile',
        ratelimit: {
          characteristics: ['ip.src', 'cf.colo.id'],
          mitigation_timeout: 3600,
          period: 10,
          requests_per_period: 5,
        },
        ref: '0bbc7a5acc5d4f66b7a034567dc802b1',
        version: '1',
      },
      {
        action: 'managed_challenge',
        description: 'Rate limit waitlist signup',
        enabled: true,
        expression: '(http.request.uri.path eq "/api/waitlist")',
        id: 'a38e81b4bcbe4f08953aaf7028b44b2f',
        last_updated: 'volatile',
        ratelimit: {
          characteristics: ['ip.src', 'cf.colo.id'],
          mitigation_timeout: 0,
          period: 60,
          requests_per_period: 10,
        },
        ref: 'a38e81b4bcbe4f08953aaf7028b44b2f',
        version: '1',
      },
    ],
    source: 'rate_limit',
    version: '2',
  },
  success: true,
  errors: [],
  messages: [],
});

describe('production rate-limit phase preflight', () => {
  test('accepts the captured phase while ignoring provider-managed timestamps and versions', () => {
    const live = baseline();
    live.result.last_updated = 'changed';
    live.result.version = '99';
    live.result.rules[0]!.last_updated = 'changed';
    live.result.rules[0]!.version = '99';

    expect(() => assertRateLimitPhaseBaseline(live)).not.toThrow();
  });

  test('accepts the exact owned phase so later production deploys remain idempotent', () => {
    const live = baseline();
    live.result.rules[1]!.expression =
      '((http.request.uri.path eq "/api/waitlist") or (http.request.uri.path eq "/api/waitlist/confirm"))';

    expect(() => assertRateLimitPhaseBaseline(live)).not.toThrow();

    live.result.rules[1]!.ratelimit.period = 61;
    expect(() => assertRateLimitPhaseBaseline(live)).toThrow(
      'result.rules[1].ratelimit.period',
    );
  });

  test('requires the desired live phase after deployment', async () => {
    const legacy = baseline();
    await expect(
      verifyRateLimitPhase('secret', async () => Response.json(legacy)),
    ).rejects.toThrow('result.rules[1].expression');

    const desired = baseline();
    desired.result.rules[1]!.expression =
      '((http.request.uri.path eq "/api/waitlist") or (http.request.uri.path eq "/api/waitlist/confirm"))';
    expect(() => assertDesiredRateLimitPhase(desired)).not.toThrow();
    await expect(
      verifyRateLimitPhase('secret', async () => Response.json(desired)),
    ).resolves.toBeUndefined();
  });

  test('rejects missing or reordered rules before Alchemy replaces the full phase', () => {
    const missing = baseline();
    missing.result.rules.pop();
    expect(() => assertRateLimitPhaseBaseline(missing)).toThrow('result.rules');

    const reordered = baseline();
    reordered.result.rules.reverse();
    expect(() => assertRateLimitPhaseBaseline(reordered)).toThrow(
      'result.rules[0].action',
    );
  });

  test('rejects rule, ratelimit, envelope, and provider-error drift', () => {
    const cases: Array<[string, (value: ReturnType<typeof baseline>) => void]> =
      [
        [
          'result.name',
          (value) => {
            value.result.name = 'changed';
          },
        ],
        [
          'result.rules[1].expression',
          (value) => {
            value.result.rules[1]!.expression = 'true';
          },
        ],
        [
          'result.rules[0].ratelimit.characteristics[0]',
          (value) => value.result.rules[0]!.ratelimit.characteristics.reverse(),
        ],
        [
          'result.rules[0].ratelimit.requests_per_period',
          (value) => {
            value.result.rules[0]!.ratelimit.requests_per_period = 6;
          },
        ],
        ['errors', (value) => value.errors.push({ code: 1000 } as never)],
        [
          'success',
          (value) => {
            value.success = false;
          },
        ],
        [
          'result.rules[0].ratelimit',
          (value) =>
            void Object.assign(value.result.rules[0]!.ratelimit, {
              counting_expression: 'true',
            }),
        ],
        [
          'result.rules[0]',
          (value) =>
            void Object.assign(value.result.rules[0]!, {
              action_parameters: {},
            }),
        ],
      ];

    for (const [path, mutate] of cases) {
      const live = baseline();
      mutate(live);
      expect(() => assertRateLimitPhaseBaseline(live)).toThrow(path);
    }

    expect(() => assertRateLimitPhaseBaseline({ success: true })).toThrow();
  });

  test('ignores volatility only on the ruleset and rule objects', () => {
    const nested = baseline();
    Object.assign(nested.result.rules[0]!.ratelimit, { version: '1' });
    expect(() => assertRateLimitPhaseBaseline(nested)).toThrow(
      'result.rules[0].ratelimit',
    );

    const envelope = baseline();
    Object.assign(envelope, { version: '1' });
    expect(() => assertRateLimitPhaseBaseline(envelope)).toThrow('response');
  });

  test('fails on HTTP and malformed JSON responses without printing response bodies', async () => {
    const httpFailure = preflightRateLimitPhase(
      'secret',
      async () => new Response('sensitive', { status: 403 }),
    );
    await expect(httpFailure).rejects.toThrow('HTTP 403');
    await expect(httpFailure).rejects.not.toThrow('sensitive');

    const malformed = preflightRateLimitPhase(
      'secret',
      async () => new Response('{'),
    );
    await expect(malformed).rejects.toThrow('valid JSON');
  });
});

const desiredState = () => ({
  attr: {
    rulesetId: '189a3c2125bc40c2b9565ae2268587ed',
    zoneId: '4df25ea08d364f19471be7a179ce9f02',
    kind: 'zone',
    name: 'default',
    phase: 'http_ratelimit',
    description: '',
    rules: [
      {
        id: '0bbc7a5acc5d4f66b7a034567dc802b1',
        ref: '0bbc7a5acc5d4f66b7a034567dc802b1',
        action: 'block',
        description: 'Leaked credential check',
        enabled: true,
        expression: '(cf.waf.credential_check.password_leaked)',
        ratelimit: {
          characteristics: ['ip.src', 'cf.colo.id'],
          period: 10,
          requestsPerPeriod: 5,
          mitigationTimeout: 3600,
        },
      },
      {
        id: 'a38e81b4bcbe4f08953aaf7028b44b2f',
        ref: 'a38e81b4bcbe4f08953aaf7028b44b2f',
        action: 'managed_challenge',
        description: 'Rate limit waitlist signup',
        enabled: true,
        expression:
          '((http.request.uri.path eq "/api/waitlist") or (http.request.uri.path eq "/api/waitlist/confirm"))',
        ratelimit: {
          characteristics: ['ip.src', 'cf.colo.id'],
          period: 60,
          requestsPerPeriod: 10,
          mitigationTimeout: 0,
        },
      },
    ],
    lastUpdated: 'volatile',
    version: '2',
  },
});

describe('persisted production rate-limit state', () => {
  test('accepts the exact desired Alchemy attributes', () => {
    expect(() => assertRateLimitRulesetState(desiredState())).not.toThrow();
  });

  test('rejects incomplete or changed rule semantics after deploy', () => {
    const cases: Array<
      [string, (value: ReturnType<typeof desiredState>) => void]
    > = [
      [
        'attr.rulesetId',
        (value) => Object.assign(value.attr, { rulesetId: 'wrong' }),
      ],
      [
        'attr.zoneId',
        (value) => Object.assign(value.attr, { zoneId: 'wrong' }),
      ],
      ['attr.kind', (value) => Object.assign(value.attr, { kind: 'root' })],
      ['attr.name', (value) => Object.assign(value.attr, { name: 'wrong' })],
      ['attr.phase', (value) => Object.assign(value.attr, { phase: 'wrong' })],
      [
        'attr.description',
        (value) => Object.assign(value.attr, { description: 'wrong' }),
      ],
      [
        'attr.rules[0].id',
        (value) => Object.assign(value.attr.rules[0]!, { id: 'wrong' }),
      ],
      [
        'attr.rules[0].ref',
        (value) => Object.assign(value.attr.rules[0]!, { ref: 'wrong' }),
      ],
      [
        'attr.rules[0].action',
        (value) => Object.assign(value.attr.rules[0]!, { action: 'log' }),
      ],
      [
        'attr.rules[0].description',
        (value) =>
          Object.assign(value.attr.rules[0]!, { description: 'wrong' }),
      ],
      [
        'attr.rules[0].enabled',
        (value) => Object.assign(value.attr.rules[0]!, { enabled: false }),
      ],
      [
        'attr.rules[0].expression',
        (value) => Object.assign(value.attr.rules[0]!, { expression: 'true' }),
      ],
      [
        'attr.rules[0].ratelimit.characteristics[0]',
        (value) => value.attr.rules[0]!.ratelimit.characteristics.reverse(),
      ],
      [
        'attr.rules[0].ratelimit.period',
        (value) =>
          Object.assign(value.attr.rules[0]!.ratelimit, { period: 11 }),
      ],
      [
        'attr.rules[0].ratelimit.requestsPerPeriod',
        (value) =>
          Object.assign(value.attr.rules[0]!.ratelimit, {
            requestsPerPeriod: 6,
          }),
      ],
      [
        'attr.rules[0].ratelimit.mitigationTimeout',
        (value) =>
          Object.assign(value.attr.rules[0]!.ratelimit, {
            mitigationTimeout: 0,
          }),
      ],
      [
        'attr.rules[1].id',
        (value) => Object.assign(value.attr.rules[1]!, { id: 'wrong' }),
      ],
      [
        'attr.rules[1].ref',
        (value) => Object.assign(value.attr.rules[1]!, { ref: 'wrong' }),
      ],
      [
        'attr.rules[1].action',
        (value) => Object.assign(value.attr.rules[1]!, { action: 'log' }),
      ],
      [
        'attr.rules[1].description',
        (value) =>
          Object.assign(value.attr.rules[1]!, { description: 'wrong' }),
      ],
      [
        'attr.rules[1].enabled',
        (value) => Object.assign(value.attr.rules[1]!, { enabled: false }),
      ],
      [
        'attr.rules[1].expression',
        (value) => Object.assign(value.attr.rules[1]!, { expression: 'true' }),
      ],
      [
        'attr.rules[1].ratelimit.characteristics[0]',
        (value) => value.attr.rules[1]!.ratelimit.characteristics.reverse(),
      ],
      [
        'attr.rules[1].ratelimit.period',
        (value) =>
          Object.assign(value.attr.rules[1]!.ratelimit, { period: 61 }),
      ],
      [
        'attr.rules[1].ratelimit.requestsPerPeriod',
        (value) =>
          Object.assign(value.attr.rules[1]!.ratelimit, {
            requestsPerPeriod: 11,
          }),
      ],
      [
        'attr.rules[1].ratelimit.mitigationTimeout',
        (value) =>
          Object.assign(value.attr.rules[1]!.ratelimit, {
            mitigationTimeout: 1,
          }),
      ],
      ['attr.rules', (value) => value.attr.rules.pop()],
      ['attr.rules[0].action', (value) => value.attr.rules.reverse()],
    ];

    for (const [path, mutate] of cases) {
      const state = desiredState();
      mutate(state);
      expect(() => assertRateLimitRulesetState(state)).toThrow(path);
    }
  });
});
