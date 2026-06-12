import { describe, expect, mock, test } from 'bun:test';
import { MessageId, SessionId, isErr, isOk } from '@maelstrom-co/protocol';

import type { Logger } from '../logger.js';
import type { HistoryManager, LLMContextMessage } from './history-manager.js';
import { loadHistoryContext } from './load-history-context.js';

// `loadHistoryContext`'s parameter is `Pick<HistoryManager, 'getLLMContext'>`,
// so a structural literal satisfies the type — no `as unknown as` cast and
// no helper needed.
type HistoryStub = Pick<HistoryManager, 'getLLMContext'>;

const captureLogger = (): {
  readonly logger: Logger;
  readonly errors: ReadonlyArray<{
    readonly message: string;
    readonly error: unknown;
    readonly data: unknown;
  }>;
} => {
  const errors: Array<{
    readonly message: string;
    readonly error: unknown;
    readonly data: unknown;
  }> = [];
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (message: string, error?: unknown, data?: unknown) => {
      errors.push({ message, error, data });
    },
  };
  return { logger, errors };
};

describe('loadHistoryContext', () => {
  test('returns ok([]) when history is undefined', async () => {
    const { logger, errors } = captureLogger();

    const result = await loadHistoryContext(
      undefined,
      SessionId('s1'),
      MessageId('m1'),
      logger,
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toEqual([]);
    expect(errors).toHaveLength(0);
  });

  test('returns ok with the messages from history.getLLMContext', async () => {
    const messages: readonly LLMContextMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const getLLMContext = mock(() => Promise.resolve(messages));
    const history: HistoryStub = { getLLMContext };
    const { logger } = captureLogger();

    const result = await loadHistoryContext(
      history,
      SessionId('s1'),
      MessageId('m1'),
      logger,
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toBe(messages);
    expect(getLLMContext).toHaveBeenCalledTimes(1);
    expect(getLLMContext).toHaveBeenCalledWith(SessionId('s1'));
  });

  test('maps a getLLMContext throw to a HistoryError tagged get_llm_context', async () => {
    const cause = new Error('redis blip');
    const getLLMContext = mock(() => Promise.reject(cause));
    const history: HistoryStub = { getLLMContext };
    const { logger, errors } = captureLogger();

    const result = await loadHistoryContext(
      history,
      SessionId('s1'),
      MessageId('m1'),
      logger,
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error._tag).toBe('HistoryError');
      if (result.error._tag === 'HistoryError') {
        expect(result.error.operation).toBe('get_llm_context');
        expect(result.error.cause).toBe(cause);
        expect(result.error.message).toBe('failed to load history context');
      }
    }

    // One operator-visible log line so a remote-store outage is greppable
    // even though the engine's Result-typed return path absorbs the throw.
    // The `op:` tag matches the convention used in chart-request-dedup so
    // operators have a single field to aggregate engine history failures by.
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('Failed to load history context');
    expect(errors[0]?.error).toBe(cause);
    expect(errors[0]?.data).toEqual({
      op: 'get_llm_context',
      messageId: MessageId('m1'),
      sessionId: SessionId('s1'),
    });
  });

  test('maps non-Error throws (string, plain object) to a HistoryError preserving cause', async () => {
    const cause = { kind: 'remote-shape-error', detail: 'malformed json' };
    const getLLMContext = mock(() => Promise.reject(cause));
    const history: HistoryStub = { getLLMContext };
    const { logger } = captureLogger();

    const result = await loadHistoryContext(
      history,
      SessionId('s1'),
      MessageId('m1'),
      logger,
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result) && result.error._tag === 'HistoryError') {
      expect(result.error.cause).toBe(cause);
    }
  });
});
