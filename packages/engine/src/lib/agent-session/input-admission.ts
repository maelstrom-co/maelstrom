import {
  AGENT_WIRE_VERSION,
  type AgentErrorEvent,
  AgentInputSchema,
  type AgentUiAppliedInput,
  type AgentUtteranceInput,
  type MessageId,
  MessageIdSchema,
} from '@maelstrom-co/protocol';

export const maxPendingInputs = 32;
export const maxRememberedInputIds = 4096;

export type Admission =
  | { readonly kind: 'utterance'; readonly input: AgentUtteranceInput }
  | { readonly kind: 'acknowledgement'; readonly input: AgentUiAppliedInput }
  | { readonly kind: 'ignored' }
  | { readonly kind: 'rejected'; readonly event: AgentErrorEvent };

export interface InputAdmission {
  admit(raw: unknown, pendingInputs: number): Admission;
  forget(): void;
}

export function createInputAdmission(): InputAdmission {
  const seen = new Set<MessageId>();
  return {
    admit(raw, pendingInputs) {
      const decoded = AgentInputSchema.safeParse(raw);
      if (!decoded.success)
        return rejected(
          'invalid_input',
          'Invalid Agent Session input.',
          claimedInputId(raw),
        );
      const input = decoded.data;
      if (input.type === 'ui_applied')
        return { kind: 'acknowledgement', input };
      if (seen.has(input.inputId)) return { kind: 'ignored' };
      if (pendingInputs >= maxPendingInputs)
        return rejected(
          'queue_full',
          `The connection already has ${maxPendingInputs} pending inputs.`,
          input.inputId,
        );
      if (seen.size >= maxRememberedInputIds)
        return rejected(
          'session_capacity',
          'Open a new connection before sending more inputs.',
          input.inputId,
        );
      seen.add(input.inputId);
      return { kind: 'utterance', input };
    },
    forget() {
      seen.clear();
    },
  };
}

function claimedInputId(raw: unknown): MessageId | undefined {
  const inputId = MessageIdSchema.safeParse(
    raw && typeof raw === 'object' && 'inputId' in raw
      ? raw.inputId
      : undefined,
  );
  return inputId.success ? inputId.data : undefined;
}

function rejected(
  code: string,
  error: string,
  inputId: MessageId | undefined,
): Admission {
  return {
    kind: 'rejected',
    event: {
      type: 'error',
      version: AGENT_WIRE_VERSION,
      ...(inputId === undefined ? {} : { inputId }),
      code,
      error,
    },
  };
}
