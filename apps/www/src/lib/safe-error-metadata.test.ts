import { describe, expect, test } from 'bun:test';
import { safeErrorMetadata } from './safe-error-metadata';

describe('safeErrorMetadata', () => {
  test('keeps operational classification without logging sensitive messages', () => {
    const error = Object.assign(new Error('user@example.com token-secret'), {
      code: 'E_RATE_LIMIT_EXCEEDED',
    });
    expect(safeErrorMetadata(error)).toEqual({
      name: 'Error',
      code: 'E_RATE_LIMIT_EXCEEDED',
    });
    expect(JSON.stringify(safeErrorMetadata(error))).not.toContain(
      'user@example.com',
    );
  });

  test('handles non-object failures without coercing their content', () => {
    expect(safeErrorMetadata('private failure detail')).toEqual({
      name: 'UnknownError',
    });
  });
});
