import { isErrorIdentifier } from './error-identifier.js';
import type { TransportFailure } from './provider-call.js';
import type { InvalidReplyReason } from './reply-validation.js';

const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_ERROR_BODY_BYTES = 4 * 1024;
const ERROR_BODY_TIMEOUT_MS = 250;

/**
 * The error type and code a provider names in a non-2xx body, exactly as
 * an {@link ErrorFieldsExtractor} found them, before {@link postJson}
 * checks them.
 */
export interface UncheckedErrorFields {
  /** The provider's error type, of any shape. */
  readonly type?: unknown;
  /** The provider's error code, of any shape. */
  readonly code?: unknown;
}

/**
 * Knows where one provider puts its error type and code in a non-2xx body.
 * It receives the body already parsed as JSON and only points at the two
 * fields. {@link postJson} keeps a field only when it is a short identifier
 * free of the key, so an extractor never filters and never sees raw text.
 * An extractor that throws yields no fields.
 */
export type ErrorFieldsExtractor = (body: unknown) => UncheckedErrorFields;

/** What {@link postJson} returns: the parsed body, or why there is none. */
export type RawReplyResult =
  | { readonly ok: true; readonly raw: unknown }
  | { readonly ok: false; readonly failure: TransportFailure };

/**
 * The fetch step every fetch transport shares. POSTs `body` as JSON with
 * the key as a bearer token. A rejected fetch is a `network` failure. A
 * non-2xx response is an `http` failure. Its error type and code come from
 * at most 4 KB of its body parsed as JSON, never from raw text: `errorFields`
 * points at them in the provider's own error shape, and each is kept only
 * when it is a string of 1 to 64 characters from `[A-Za-z0-9_.:-]` that
 * does not contain `apiKey`. A body that is not JSON, is over 4 KB or has
 * not arrived within 250 ms gives the status alone, so a stalled error body
 * never holds the failure back until `signal` aborts. A 2xx body over
 * 256 KB is `oversize`, one whose read fails is `network` and one that is
 * not JSON is `malformed_json`. Never throws, and every read stops once
 * `signal` aborts.
 */
export async function postJson({
  fetch,
  endpoint,
  apiKey,
  body,
  signal,
  errorFields,
}: {
  /** The fetch to send with. */
  readonly fetch: typeof globalThis.fetch;
  /** Endpoint URL. */
  readonly endpoint: string;
  /** Provider API key, sent as a bearer token and kept out of every failure. */
  readonly apiKey: string;
  /** The request body, already encoded as JSON. */
  readonly body: string;
  /** Aborts the request and every body read. */
  readonly signal: AbortSignal;
  /** Points at the provider's error type and code in a parsed error body. */
  readonly errorFields: ErrorFieldsExtractor;
}): Promise<RawReplyResult> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
      signal,
    });
  } catch {
    return { ok: false, failure: { kind: 'network' } };
  }
  if (!response.ok) {
    const text = await readBody(
      response,
      AbortSignal.any([signal, AbortSignal.timeout(ERROR_BODY_TIMEOUT_MS)]),
      MAX_ERROR_BODY_BYTES,
    ).catch(() => undefined);
    return {
      ok: false,
      failure: {
        kind: 'http',
        status: response.status,
        ...checkedErrorFields(text, errorFields, apiKey),
      },
    };
  }
  let text: string | undefined;
  try {
    text = await readBody(response, signal);
  } catch {
    return { ok: false, failure: { kind: 'network' } };
  }
  if (text === undefined) return invalidReply('oversize');
  try {
    return { ok: true, raw: JSON.parse(text) };
  } catch {
    return invalidReply('malformed_json');
  }
}

/**
 * The response body as text, or `undefined` once it exceeds `maxBytes`
 * (256 KB by default) by its declared length or while streaming. A pending
 * read stops as soon as `signal` aborts.
 *
 * @throws {Error} If the body is missing, `signal` aborts or the stream fails.
 */
export async function readBody(
  response: Response,
  signal: AbortSignal,
  maxBytes: number = MAX_RESPONSE_BYTES,
): Promise<string | undefined> {
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) > maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  if (!response.body) throw new Error('response body missing');
  const reader = response.body.getReader();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error('request aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  aborted.catch(() => undefined);
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      if (signal.aborted) throw new Error('request aborted');
      const next = await Promise.race([reader.read(), aborted]);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) return undefined;
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    void reader.cancel().catch(() => undefined);
  }
}

function invalidReply(reason: InvalidReplyReason): RawReplyResult {
  return { ok: false, failure: { kind: 'invalid_reply', reason } };
}

function checkedErrorFields(
  text: string | undefined,
  errorFields: ErrorFieldsExtractor,
  secret: string,
): { errorType?: string; errorCode?: string } {
  if (text === undefined) return {};
  let fields: UncheckedErrorFields;
  try {
    fields = errorFields(JSON.parse(text));
  } catch {
    return {};
  }
  const errorType = safeErrorField(fields?.type, secret);
  const errorCode = safeErrorField(fields?.code, secret);
  return {
    ...(errorType !== undefined && { errorType }),
    ...(errorCode !== undefined && { errorCode }),
  };
}

function safeErrorField(value: unknown, secret: string): string | undefined {
  return isErrorIdentifier(value) && !value.includes(secret)
    ? value
    : undefined;
}
