import type { OperationalOutcome } from '@maelstrom-co/telemetry/integration';
import {
  connectorFailureKind,
  WireEngineError,
} from '../connection-manager/connector.types.js';

export function operationalFailure(error: Error): OperationalOutcome {
  try {
    if (error instanceof WireEngineError) {
      switch (error.code) {
        case 'CancellationError':
          return { outcome: 'cancelled' };
        case 'ProviderError':
          return { outcome: 'failed', errorCategory: 'provider' };
        case 'TimeoutError':
          return { outcome: 'failed', errorCategory: 'timeout' };
        case 'ParseError':
        case 'ValidationError':
        case 'RequestValidationError':
          return { outcome: 'failed', errorCategory: 'validation' };
        case 'HistoryError':
          return { outcome: 'failed', errorCategory: 'application' };
        default:
          return { outcome: 'failed', errorCategory: 'unknown' };
      }
    }
    const kind = connectorFailureKind(error);
    if (kind !== undefined) {
      if (kind === 'cancelled') return { outcome: 'cancelled' };
      return {
        outcome: 'failed',
        errorCategory: kind === 'invalid_response' ? 'validation' : kind,
      };
    }
    return { outcome: 'failed', errorCategory: 'unknown' };
  } catch {
    return { outcome: 'unknown' };
  }
}
