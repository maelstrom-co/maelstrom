import { describe, expect, test } from 'bun:test';

import {
  isDefaultTelemetryAttributeAllowed,
  isSensitiveTelemetryField,
  sensitiveTelemetryFields,
} from './privacy.js';
import { maelstromTelemetryAttributes } from './vocabulary.js';

const sensitiveFields = [
  'intent',
  'changes',
  'content',
  'userMessage',
  'rationale',
  'params',
  'text',
  'message',
  'data',
  'error',
  'sessionId',
  'requestId',
  'url',
  'prompt',
  'transcript',
  'audio',
] as const;

const defaultAllowedFields = [
  'maelstrom.package',
  'maelstrom.version',
  'maelstrom.layout_mode',
  'maelstrom.outcome',
  'maelstrom.error_type',
  'maelstrom.operation',
  'maelstrom.component',
] as const;

describe('telemetry privacy helpers', () => {
  test('every listed sensitive field is classified as sensitive and disallowed by default', () => {
    expect(Object.keys(sensitiveTelemetryFields).sort()).toEqual(
      [...sensitiveFields].sort(),
    );

    for (const field of sensitiveFields) {
      expect(isSensitiveTelemetryField(field)).toBeTrue();
      expect(isDefaultTelemetryAttributeAllowed(field)).toBeFalse();
      expect(sensitiveTelemetryFields[field].classification).toBe('sensitive');
      expect(sensitiveTelemetryFields[field].defaultAllowed).toBeFalse();
    }
  });

  test('safe and low-cardinality curated attributes are allowed by default', () => {
    for (const field of defaultAllowedFields) {
      expect(isSensitiveTelemetryField(field)).toBeFalse();
      expect(isDefaultTelemetryAttributeAllowed(field)).toBeTrue();
    }
  });

  test('curated attribute privacy metadata stays consistent with helper decisions', () => {
    for (const [field, metadata] of Object.entries(maelstromTelemetryAttributes)) {
      expect(isDefaultTelemetryAttributeAllowed(field)).toBe(
        metadata.privacy.defaultAllowed,
      );

      expect(isSensitiveTelemetryField(field)).toBe(
        metadata.privacy.classification === 'sensitive',
      );
    }
  });

  test('unknown and unclassified fields fail closed', () => {
    expect(isSensitiveTelemetryField('maelstrom.custom_attribute')).toBeFalse();
    expect(
      isDefaultTelemetryAttributeAllowed('maelstrom.custom_attribute'),
    ).toBeFalse();
    expect(isSensitiveTelemetryField('voice.provider')).toBeFalse();
    expect(isDefaultTelemetryAttributeAllowed('voice.provider')).toBeFalse();
    expect(isSensitiveTelemetryField('totally_unknown')).toBeFalse();
    expect(isDefaultTelemetryAttributeAllowed('totally_unknown')).toBeFalse();
  });
});
