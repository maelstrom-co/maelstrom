import type { DiagnosticMetadata } from '@maelstrom-co/protocol';
import { sanitizeDiagnosticValue } from '@maelstrom-co/protocol';
import type {
  AdapterDiagnosticObservation,
  AdapterDiagnosticResponse,
  AdapterDiagnosticSource,
} from '@maelstrom-co/realtime';

type Fields = Record<string, unknown>;
/** Semantic purpose of a context append, supplied by the provider's send site. */
export type LiveContextKind = 'ui_snapshot' | 'recovery_outcome';
const object = (value: unknown): Fields =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Fields)
    : {};
const identifier = (value: unknown): string | undefined =>
  typeof value === 'string' &&
  /^[a-zA-Z0-9_.-]{1,128}$/.test(value) &&
  !/^sk-[a-zA-Z0-9_-]{32,}$/.test(value)
    ? value
    : undefined;

function projectResponse(
  id: string | undefined,
  type: string,
  status: unknown,
): AdapterDiagnosticResponse | undefined {
  if (!id) return undefined;
  if (type === 'response.created') return { id, phase: 'started' };
  if (type !== 'response.done' && type !== 'response.completed')
    return { id, phase: 'observed' };
  const outcome =
    status === 'completed'
      ? 'succeeded'
      : status === 'failed' || status === 'cancelled' || status === 'incomplete'
        ? status
        : undefined;
  return { id, phase: 'finished', ...(outcome ? { outcome } : {}) };
}

export class LiveDiagnostics implements AdapterDiagnosticSource {
  private readonly observers = new Set<
    (observation: AdapterDiagnosticObservation) => void
  >();
  subscribe(
    observer: (observation: AdapterDiagnosticObservation) => void,
  ): () => void {
    this.observers.add(observer);
    return () => {
      this.observers.delete(observer);
    };
  }
  emit(
    input: unknown,
    direction: 'received' | 'sent',
    providerGeneration: number,
    contextKind?: LiveContextKind,
  ): void {
    if (!this.observers.size) return;
    try {
      const envelope = object(input);
      const type = identifier(envelope.type);
      if (
        !type ||
        !/^(session\.delegation\.|session\.thinking\.append(?:ed)?$|response\.)/.test(
          type,
        )
      )
        return;
      const event = object(envelope.event);
      const eventType = identifier(event.type);
      if (eventType?.endsWith('.delta')) return;
      const response = object(event.response ?? envelope.response);
      const delegation = object(envelope.delegation);
      const responseId =
        identifier(event.response_id) ??
        identifier(response.id) ??
        identifier(envelope.response_id) ??
        identifier(delegation.response_id);
      const item = object(event.item ?? envelope.item);
      const tool =
        item.type === 'function_call' &&
        ['update_ui', 'get_ui_state', 'get_capabilities'].includes(
          String(item.name),
        )
          ? String(item.name)
          : undefined;
      const metadata = sanitizeDiagnosticValue(
        {
          direction,
          type,
          eventType,
          contextKind,
          eventId: identifier(envelope.event_id),
          clientEventId: identifier(envelope.client_event_id),
          delegationId:
            identifier(envelope.delegation_id) ?? identifier(delegation.id),
          responseId,
          callId: identifier(item.call_id),
          tool,
          status: [
            'completed',
            'failed',
            'cancelled',
            'in_progress',
            'incomplete',
            'queued',
          ].includes(String(response.status))
            ? String(response.status)
            : undefined,
        },
        { maxCharacters: 16384, maxStringCharacters: 128 },
      ) as DiagnosticMetadata;
      const observation: AdapterDiagnosticObservation = {
        kind: 'wire',
        providerGeneration,
        metadata,
        response: projectResponse(
          responseId,
          eventType ?? type,
          response.status,
        ),
        readContent: () => {
          if (
            item.type !== 'function_call' ||
            typeof item.arguments !== 'string' ||
            item.arguments.length > 262144
          )
            return undefined;
          try {
            const intent = object(JSON.parse(item.arguments)).intent;
            return typeof intent === 'string'
              ? sanitizeDiagnosticValue(
                  { intent },
                  { maxCharacters: 16384, maxStringCharacters: 16384 },
                )
              : undefined;
          } catch {
            return undefined;
          }
        },
      };
      for (const observer of this.observers) {
        try {
          const result: unknown = observer(observation);
          if (
            result !== null &&
            (typeof result === 'object' || typeof result === 'function') &&
            'then' in result
          )
            void Promise.resolve(result).catch(() => {});
        } catch {
          /* Diagnostic consumers cannot fail provider work. */
        }
      }
    } catch {
      /* Optional projection cannot alter transport behavior. */
    }
  }
}
