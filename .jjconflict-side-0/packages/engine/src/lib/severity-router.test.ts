import { describe, expect, test } from 'bun:test';

import type { Logger } from './logger.js';
import { logAtSeverity } from './severity-router.js';
import type { RetrySeverity } from './validation/llm-output/healed-layout.js';

interface SpyEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  error?: unknown;
  ctx?: Record<string, unknown>;
}

function spyLogger(): { logger: Logger; entries: SpyEntry[] } {
  const entries: SpyEntry[] = [];
  const logger: Logger = {
    debug: (msg, ctx) => entries.push({ level: 'debug', msg, ctx }),
    info: (msg, ctx) => entries.push({ level: 'info', msg, ctx }),
    warn: (msg, ctx) => entries.push({ level: 'warn', msg, ctx }),
    error: (msg, error, ctx) =>
      entries.push({ level: 'error', msg, error, ctx }),
  };
  return { logger, entries };
}

describe('logAtSeverity', () => {
  test.each<[RetrySeverity, SpyEntry['level']]>([
    ['none', 'info'],
    ['low', 'info'],
    ['medium', 'warn'],
    ['unrecoverable', 'error'],
  ])('routes severity=%s to %s level', (severity, expectedLevel) => {
    const { logger, entries } = spyLogger();
    logAtSeverity(logger, severity, 'test message', { foo: 'bar' });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe(expectedLevel);
    expect(entries[0]?.msg).toBe('test message');
    expect(entries[0]?.ctx).toEqual({ foo: 'bar' });
  });

  test('error level passes data via the dedicated ctx slot, error slot stays undefined', () => {
    // Pin the 3-arg signature: routing to error must not collapse ctx into
    // the error slot. Structured loggers (Pino, Winston) treat the error
    // slot specially; ctx data living there breaks observability.
    const { logger, entries } = spyLogger();
    logAtSeverity(logger, 'unrecoverable', 'oops', { messageId: 'msg-1' });

    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry?.level).toBe('error');
    expect(entry?.error).toBeUndefined();
    expect(entry?.ctx).toEqual({ messageId: 'msg-1' });
  });
});
