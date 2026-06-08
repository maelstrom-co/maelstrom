/**
 * Privacy classifications used to gate default telemetry attributes.
 *
 * These labels describe Maelstrom's conservative default-emission policy. They
 * are not a sanitizer and do not imply that arbitrary fields become safe just
 * because a downstream adapter exists.
 */
export type TelemetryPrivacyClassification =
  | 'safe'
  | 'low_cardinality'
  | 'sensitive'
  | 'unsafe_by_default';

/** Privacy metadata attached to a telemetry field classification. */
export interface TelemetryPrivacyMetadata {
  /** Classification assigned to the field. */
  readonly classification: TelemetryPrivacyClassification;

  /** Whether the field is eligible for default emission without an explicit override. */
  readonly defaultAllowed: boolean;

  /** Reason for the field's default telemetry decision. */
  readonly reason: string;
}

const safeTelemetryField = (
  reason: string,
): TelemetryPrivacyMetadata => ({
  classification: 'safe',
  defaultAllowed: true,
  reason,
});

const lowCardinalityTelemetryField = (
  reason: string,
): TelemetryPrivacyMetadata => ({
  classification: 'low_cardinality',
  defaultAllowed: true,
  reason,
});

const sensitiveTelemetryField = (
  reason: string,
): TelemetryPrivacyMetadata => ({
  classification: 'sensitive',
  defaultAllowed: false,
  reason,
});

const hasOwnField = (
  registry: Readonly<Record<string, TelemetryPrivacyMetadata>>,
  field: string,
): boolean => Object.prototype.hasOwnProperty.call(registry, field);

/**
 * Exact field names that are always excluded from default telemetry.
 *
 * This registry documents known sensitive names. Omission from this map does
 * not imply safety; unknown names are still rejected by
 * {@link isDefaultTelemetryAttributeAllowed}.
 */
export const sensitiveTelemetryFields: Readonly<
  Record<string, TelemetryPrivacyMetadata>
> = {
  intent: sensitiveTelemetryField(
    'Contains raw natural-language user intent and may include personal content.',
  ),
  changes: sensitiveTelemetryField(
    'Contains free-form mutation descriptions that may include user content.',
  ),
  content: sensitiveTelemetryField(
    'Contains assistant or injected message content that may expose user data.',
  ),
  userMessage: sensitiveTelemetryField(
    'Contains end-user facing natural-language output derived from a session.',
  ),
  rationale: sensitiveTelemetryField(
    'Contains model reasoning text that must not become a default attribute.',
  ),
  params: sensitiveTelemetryField(
    'May contain arbitrary action payload data outside the curated allowlist.',
  ),
  text: sensitiveTelemetryField(
    'Contains transcript or speech text that may include personal content.',
  ),
  message: sensitiveTelemetryField(
    'Contains free-form history or speech content that may include user data.',
  ),
  data: sensitiveTelemetryField(
    'Contains raw audio or binary payload data that must be excluded.',
  ),
  error: sensitiveTelemetryField(
    'Contains free-form error strings that may leak prompts, ids, or content.',
  ),
  sessionId: sensitiveTelemetryField(
    'Raw session identifiers must not be emitted as default telemetry attributes.',
  ),
  requestId: sensitiveTelemetryField(
    'Raw request identifiers must not be emitted as default telemetry attributes.',
  ),
  url: sensitiveTelemetryField(
    'Raw URLs may contain user-controlled paths, queries, or identifiers.',
  ),
  prompt: sensitiveTelemetryField(
    'Contains prompt text that may include user input or internal instructions.',
  ),
  transcript: sensitiveTelemetryField(
    'Contains full transcript content that may expose user speech.',
  ),
  audio: sensitiveTelemetryField(
    'Contains audio payloads or references to raw user speech artifacts.',
  ),
};

const curatedDefaultTelemetryFields: Readonly<
  Record<string, TelemetryPrivacyMetadata>
> = {
  'maelstrom.package': safeTelemetryField(
    'Identifies the emitting Maelstrom package without user-derived content.',
  ),
  'maelstrom.version': safeTelemetryField(
    'Identifies the package version without carrying session-specific data.',
  ),
  'maelstrom.layout_mode': lowCardinalityTelemetryField(
    'Enumerates a small set of layout modes for product diagnostics.',
  ),
  'maelstrom.outcome': lowCardinalityTelemetryField(
    'Enumerates a small set of operation outcomes for aggregate analysis.',
  ),
  'maelstrom.error_type': lowCardinalityTelemetryField(
    'Carries a normalized error category rather than a raw error message.',
  ),
  'maelstrom.operation': lowCardinalityTelemetryField(
    'Operation names should come from a curated internal catalog rather than user input.',
  ),
  'maelstrom.component': lowCardinalityTelemetryField(
    'Component identifiers are bounded implementation labels, not free-form content.',
  ),
};

/** @internal Internal merged registry used by helper logic and package-local tests. */
export const telemetryPrivacyMetadataByField: Readonly<
  Record<string, TelemetryPrivacyMetadata>
> = {
  ...sensitiveTelemetryFields,
  ...curatedDefaultTelemetryFields,
};

/**
 * Returns whether a field is explicitly classified as sensitive.
 *
 * This is an exact-name check against {@link sensitiveTelemetryFields}. It does
 * not attempt pattern matching or payload inspection.
 *
 * @param field - Field name to check.
 * @returns `true` when the field is in the sensitive registry.
 */
export function isSensitiveTelemetryField(field: string): boolean {
  return hasOwnField(sensitiveTelemetryFields, field);
}

/**
 * Returns whether a field is allowed in default telemetry.
 *
 * Unknown fields fail closed and return `false`. This helper only answers the
 * package's conservative default policy; callers that need broader emission
 * rules must make an explicit decision outside this contract.
 *
 * @param field - Field name to check.
 * @returns `true` when the field is explicitly allowed by the privacy registry.
 */
export function isDefaultTelemetryAttributeAllowed(field: string): boolean {
  if (!hasOwnField(telemetryPrivacyMetadataByField, field)) {
    return false;
  }

  return telemetryPrivacyMetadataByField[field].defaultAllowed;
}
