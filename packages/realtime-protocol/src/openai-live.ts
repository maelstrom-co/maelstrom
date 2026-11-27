import { z } from 'zod';

/** JSON values accepted by Live function schemas and nested Responses events. */
export type LiveJson =
  | null
  | boolean
  | number
  | string
  | LiveJson[]
  | { [key: string]: LiveJson };

/** A managed Responses function definition. */
export interface LiveFunctionTool {
  /** Tool discriminator. */
  readonly type: 'function';
  /** Backend function name. */
  readonly name: string;
  /** Function purpose. */
  readonly description?: string;
  /** JSON Schema for arguments. */
  readonly parameters: { readonly [key: string]: LiveJson };
  /** Require schema-conforming arguments. */
  readonly strict?: boolean;
}

/** Supported managed backend configuration, independent of conversation instructions. */
export interface LiveResponsesConfig {
  /** Required backend model with project access. */
  readonly model: string;
  /** Backend-only instructions. */
  readonly instructions?: string;
  /** Application functions or hosted web search. */
  readonly tools?: readonly (
    | LiveFunctionTool
    | {
        /** Hosted tool discriminator. */
        readonly type: 'web_search';
      }
  )[];
  /** Backend tool selection policy. */
  readonly tool_choice?: 'auto' | 'required' | 'none';
  /** Allow parallel backend calls; application execution remains host-owned. */
  readonly parallel_tool_calls?: boolean;
  /** Backend token limit, at least sixteen. */
  readonly max_output_tokens?: number;
}

/** Startup configuration for WebRTC with managed Responses; no credential fields. */
export interface LiveSessionConfig {
  /** Prior text context available at startup. This implementation bounds combined text to 8192 UTF-8 bytes, conservatively below the provider token limit. */
  readonly input?: readonly LiveInputMessage[];
  /** Voice model with project access. */
  readonly model: string;
  /** Conversation-only instructions. */
  readonly instructions?: string;
  /** Recording is disabled unless explicitly enabled by the trusted host. */
  readonly store?: boolean;
  /** WebRTC negotiates format; only voice selection is accepted here. */
  readonly audio?: {
    /** Generated speech settings. */
    readonly output: {
      /** Voice selected at startup. */
      readonly voice: string;
    };
  };
  /** Managed backend configuration. */
  readonly delegation: {
    /** Managed backend ownership. */
    readonly type: 'responses';
    /** Backend model, prompt and tools. */
    readonly responses: LiveResponsesConfig;
  };
}

/** Supported Live startup text message. Factual recovery data must not use the trusted developer role. */
export type LiveInputMessage = {
  /** Message discriminator. */
  readonly type: 'message';
} & (
  | {
      /** Trusted application behavior or untrusted reference/user data. */
      readonly role: 'developer' | 'user';
      /** Exactly one input text part. */
      readonly content: readonly [
        {
          /** Input text discriminator. */
          readonly type: 'input_text';
          /** Message text. */
          readonly text: string;
        },
      ];
    }
  | {
      /** Prior assistant text, not fabricated intended speech. */
      readonly role: 'assistant';
      /** Exactly one assistant text part. */
      readonly content: readonly [
        {
          /** Supported assistant text discriminators. */
          readonly type: 'output_text' | 'text';
          /** Message text. */
          readonly text: string;
        },
      ];
    }
);

const nonempty = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0);
const sdp = nonempty
  .max(65_536)
  .refine((value) => value.startsWith('v=0\r\n') || value.startsWith('v=0\n'));
const tool = z.strictObject({
  type: z.literal('function'),
  name: nonempty,
  description: z.string().optional(),
  parameters: z.record(z.string(), z.json()),
  strict: z.boolean().optional(),
});

/** Validates the supported WebRTC configuration and rejects accidental credential fields. */
export const LiveSessionConfigSchema: z.ZodType<LiveSessionConfig> =
  z.strictObject({
    model: nonempty,
    instructions: z.string().max(131_072).optional(),
    input: z
      .array(
        z.union([
          z.strictObject({
            type: z.literal('message'),
            role: z.enum(['user', 'developer']),
            content: z.tuple([
              z.strictObject({
                type: z.literal('input_text'),
                text: z.string(),
              }),
            ]),
          }),
          z.strictObject({
            type: z.literal('message'),
            role: z.literal('assistant'),
            content: z.tuple([
              z.strictObject({
                type: z.enum(['output_text', 'text']),
                text: z.string(),
              }),
            ]),
          }),
        ]),
      )
      .max(128)
      .refine(
        (messages) =>
          messages.reduce(
            (bytes, message) =>
              bytes + new TextEncoder().encode(message.content[0].text).length,
            0,
          ) <= 8192,
      )
      .optional(),
    store: z.boolean().optional(),
    audio: z
      .strictObject({ output: z.strictObject({ voice: nonempty }) })
      .optional(),
    delegation: z.strictObject({
      type: z.literal('responses'),
      responses: z.strictObject({
        model: nonempty,
        instructions: z.string().max(131_072).optional(),
        tools: z
          .array(
            z.union([tool, z.strictObject({ type: z.literal('web_search') })]),
          )
          .max(128)
          .optional(),
        tool_choice: z.enum(['auto', 'required', 'none']).optional(),
        parallel_tool_calls: z.boolean().optional(),
        max_output_tokens: z.number().int().min(16).optional(),
      }),
    }),
  });

/** Browser offer sent to a host exchange. The host must authorize the caller and configuration. */
export interface LiveExchangeRequest {
  /** Requested session configuration; a server may replace it with trusted policy. */
  readonly session: LiveSessionConfig;
  /** Fully gathered WebRTC offer. */
  readonly transport: LiveWebRTCDescription;
}

/** Validated HTTP session creation result. IDs are opaque and retained unchanged. */
export interface LiveExchangeResponse {
  /** Created session identity. */
  readonly session: {
    /** Opaque upstream identity. */
    readonly id: string;
  };
  /** WebRTC answer. */
  readonly transport: LiveWebRTCDescription;
}

/** Negotiated SDP shared by the request offer and response answer. */
export interface LiveWebRTCDescription {
  /** Transport discriminator. */
  readonly type: 'webrtc';
  /** Complete SDP, including gathered ICE candidates. */
  readonly sdp: string;
}

/** Validates input before a paid creation request. */
export const LiveExchangeRequestSchema: z.ZodType<LiveExchangeRequest> =
  z.strictObject({
    session: LiveSessionConfigSchema,
    transport: z.strictObject({ type: z.literal('webrtc'), sdp }),
  });
/** Validates and projects the upstream response without rewriting its session ID. */
export const LiveExchangeResponseSchema: z.ZodType<LiveExchangeResponse> =
  z.object({
    session: z.object({ id: nonempty }),
    transport: z.object({ type: z.literal('webrtc'), sdp }),
  });

/** Host-owned exchange; cancellation never proves that upstream creation did not occur. */
export type LiveSessionExchange = (
  request: LiveExchangeRequest,
  signal: AbortSignal,
) => Promise<LiveExchangeResponse>;

/** Commands supported by the transport seam. Sending proves local submission, never provider acceptance. */
export type LiveCommand =
  | {
      /** Continue the configured backend after required results are submitted. */
      readonly type: 'response.create';
      /** Caller correlation identity. */
      readonly event_id: string;
    }
  | {
      /** Append an item without automatically continuing the backend. */
      readonly type: 'response.item.create';
      /** Caller correlation identity. */
      readonly event_id: string;
      /** Completed function result. */
      readonly item: {
        /** Backend item discriminator. */
        readonly type: 'function_call_output';
        /** Native function call identity. */
        readonly call_id: string;
        /** Serialized application result, with truthful completion status. */
        readonly output: string;
      };
    }
  | {
      /** Whether appended context steers behavior, adds facts, or requests speech. */
      readonly type:
        | 'session.thinking.append'
        | 'session.instructions.append'
        | 'session.commentary.append';
      /** Caller correlation identity for acceptance or rejection. */
      readonly event_id: string;
      /** Managed Responses sessions accept only session-wide appends. */
      readonly delegation_id: null;
      /** Plain text limited by the provider to 500 tokens. */
      readonly content: string;
    };

/** Validated event envelope. Nested Responses fields remain untrusted for the tool integration to validate. */
export interface LiveServerEvent {
  /** Native event discriminator. */
  readonly type: string;
  /** Native event identity. */
  readonly event_id: string;
  /** Native fields preserved without projection. */
  readonly [key: string]: LiveJson;
}

/** Validates the envelope while retaining native fields, including future nested Responses events. */
export const LiveServerEventSchema = z
  .record(z.string(), z.json())
  .and(z.object({ type: nonempty, event_id: nonempty }));

function diagnosticCorrelation(value: string | undefined): string | undefined {
  return value !== undefined &&
    value.length > 0 &&
    value.length <= 256 &&
    !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)
    ? value
    : undefined;
}

/** Transport failure with bounded diagnostic correlation. Invalid correlation is omitted, never truncated into another identity. */
export class LiveTransportError extends Error {
  /** Stable local failure category. */
  readonly code: string;
  /** Whether the connection can no longer be used. */
  readonly fatal: boolean;
  /** HTTP status, when an exchange returned one. */
  readonly status?: number;
  /** Printable HTTP correlation, at most 256 UTF-16 code units; invalid values are omitted. */
  readonly requestId?: string;
  /** Printable provider code, at most 256 UTF-16 code units; invalid values are omitted and null is preserved. */
  readonly providerCode?: string | null;
  /** Printable command correlation, at most 256 UTF-16 code units; use native events for unprojected matching. */
  readonly clientEventId?: string;
  /** Creates a safe failure without retaining arbitrary exception bodies or credentials. */
  constructor(
    code: string,
    options: {
      /** Whether this connection is unusable. */
      fatal?: boolean;
      /** HTTP response status. */
      status?: number;
      /** HTTP request correlation. */
      requestId?: string;
      /** Native provider code. */
      providerCode?: string | null;
      /** Rejected command correlation. */
      clientEventId?: string;
    } = {},
  ) {
    super(`Live transport: ${code}`);
    this.name = 'LiveTransportError';
    this.code = code;
    this.fatal = options.fatal ?? true;
    this.status = options.status;
    this.requestId = diagnosticCorrelation(options.requestId);
    this.providerCode =
      options.providerCode === null
        ? null
        : diagnosticCorrelation(options.providerCode);
    this.clientEventId = diagnosticCorrelation(options.clientEventId);
  }
}
