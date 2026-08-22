export const LEGACY_WAITLIST_RATE_LIMIT_EXPRESSION =
  '(http.request.uri.path eq "/api/waitlist")';

export const DESIRED_WAITLIST_RATE_LIMIT_EXPRESSION =
  '((http.request.uri.path eq "/api/waitlist") or (http.request.uri.path eq "/api/waitlist/confirm"))';

export const PRODUCTION_RATE_LIMIT = {
  logicalId: 'ProductionRateLimit',
  rulesetId: '189a3c2125bc40c2b9565ae2268587ed',
  zoneId: '4df25ea08d364f19471be7a179ce9f02',
  kind: 'zone',
  name: 'default',
  phase: 'http_ratelimit',
  description: '',
} as const;

export const PRODUCTION_RATE_LIMIT_RULES = [
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
    expression: DESIRED_WAITLIST_RATE_LIMIT_EXPRESSION,
    ratelimit: {
      characteristics: ['ip.src', 'cf.colo.id'],
      period: 60,
      requestsPerPeriod: 10,
      mitigationTimeout: 0,
    },
  },
] as const;
