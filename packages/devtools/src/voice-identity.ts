import {
  type IdentityAvailability,
  identity,
  identityAvailability,
} from './diagnostic-identity.js';
import type { PanelEvent } from './panel-model.js';

export interface VoiceIdentity {
  key: string;
  providerKey: string;
  generationKey: string;
  clientId?: string;
  providerInstanceId?: string;
  providerAvailability: IdentityAvailability;
  provider?: string;
  scope: 'session' | 'provider' | 'legacy' | 'unreported';
  generation?: number;
  generationAvailability: IdentityAvailability;
}

export function voiceIdentity(event: PanelEvent): VoiceIdentity | undefined {
  if (!event.kind.startsWith('voice.')) return undefined;
  const provider = identity(event.metadata.providerInstanceId);
  const scope: VoiceIdentity['scope'] =
    event.metadata.providerGeneration !== undefined
      ? 'provider'
      : event.metadata.generationScope === 'session'
        ? 'session'
        : event.metadata.generation !== undefined
          ? 'legacy'
          : 'unreported';
  const value =
    scope === 'provider'
      ? event.metadata.providerGeneration
      : event.metadata.generation;
  const generation =
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? value
      : undefined;
  const availability = identityAvailability(value);
  const generationAvailability =
    generation !== undefined
      ? 'reported'
      : availability === 'reported'
        ? 'unreadable'
        : availability;
  const providerKey =
    event.clientId && provider
      ? JSON.stringify([event.clientId, provider])
      : JSON.stringify(['unattributed', event.key]);
  const generationKey = JSON.stringify(
    generation === undefined
      ? [scope, null, generationAvailability]
      : [scope, generation],
  );
  return {
    key: JSON.stringify([providerKey, generationKey]),
    providerKey,
    generationKey,
    clientId: event.clientId,
    providerInstanceId: provider,
    providerAvailability: identityAvailability(
      event.metadata.providerInstanceId,
    ),
    provider: identity(event.metadata.provider),
    scope,
    generation,
    generationAvailability,
  };
}
