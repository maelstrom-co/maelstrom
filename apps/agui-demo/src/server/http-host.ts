import { createHmac, timingSafeEqual } from 'node:crypto';

import { toServerSentEventsResponse } from '@tanstack/ai';
import { z } from 'zod';

import {
  type BindingDependencies,
  WorkspaceBinding,
} from './workspace-binding';
import {
  MemoryWorkspaceRepository,
  type WorkspaceRepository,
} from './workspace-repository';

async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('JSON body required.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_048_576) {
        await reader.cancel();
        throw new Error('Request too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function json(value: unknown, status = 200, headers?: HeadersInit) {
  const result = Response.json(value, { status, headers });
  result.headers.set('Cache-Control', 'no-store');
  result.headers.set('X-Content-Type-Options', 'nosniff');
  return result;
}

function error(status: number, code: string, message: string) {
  return json({ error: { code, message } }, status);
}

const recoveryHeader = 'x-workspace-recovery';
const recoveryLifetimeMs = 5 * 60_000;

// The HttpOnly cookie signs the generation and deadline so recovery survives a cold restart.
function recoveryProof(token: string, id: string, deadline: number) {
  return `${deadline}.${createHmac('sha256', token).update(`workspace-reset:${id}:${deadline}`).digest('hex')}`;
}

function validRecovery(token: string, id: string, proof: string | null) {
  if (!proof || !/^\d{13}\.[0-9a-f]{64}$/.test(proof)) return false;
  const deadline = Number(proof.slice(0, 13));
  return (
    deadline > Date.now() &&
    timingSafeEqual(
      Buffer.from(proof),
      Buffer.from(recoveryProof(token, id, deadline)),
    )
  );
}

function reportStorageFailure(request: Request, cause: unknown) {
  const operations: Record<string, string> = {
    '/api/workspace/bootstrap': 'bootstrap',
    '/api/workspace/reset': 'reset',
    '/api/workspace/stop': 'stop',
    '/api/workspace/records': 'records',
    '/api/workspace/operations': 'operations',
    '/api/workspace/exchange': 'exchange',
    '/api/workspace/voice': 'voice',
    '/api/goal': 'goal',
  };
  const category =
    cause instanceof z.ZodError
      ? 'invalid_stored_schema'
      : cause instanceof SyntaxError
        ? 'invalid_stored_json'
        : cause instanceof Error &&
            cause.message === 'Workspace authorization required.'
          ? 'authorization_required'
          : 'storage_failure';
  // Error messages and schema issues can contain stored records or credentials.
  console.error(
    JSON.stringify({
      event: 'workspace_storage_failed',
      operation: operations[new URL(request.url).pathname] ?? 'other',
      category,
      requestId: crypto.randomUUID(),
    }),
  );
}

export class LocalWorkspaceHost {
  private readonly cookieName: string;
  private readonly secure: boolean;

  constructor(
    private readonly origin: string,
    private readonly dependencies: BindingDependencies = {},
    private readonly repository: WorkspaceRepository = new MemoryWorkspaceRepository(),
  ) {
    const url = new URL(origin);
    this.secure = url.protocol === 'https:';
    if (
      !this.secure &&
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    )
      throw new Error('HTTP is restricted to local development.');
    this.cookieName = this.secure
      ? '__Host-agui_workspace'
      : 'agui_local_workspace';
  }

  private cookie(value: string, clear = false) {
    return `${this.cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 604800}${this.secure ? '; Secure' : ''}`;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const response = await this.handle(request);
      const token = this.token(request);
      if (response.ok && !response.headers.has('Set-Cookie') && token)
        response.headers.set('Set-Cookie', this.cookie(token));
      return response;
    } catch (cause) {
      reportStorageFailure(request, cause);
      const response = error(
        503,
        'STORAGE_UNAVAILABLE',
        'Workspace storage is unavailable. Inspect and reconcile before continuing.',
      );
      if (new URL(request.url).pathname === '/api/workspace/bootstrap') {
        try {
          this.offerRecovery(response, this.token(request));
        } catch {
          // If access metadata is unreadable, no reset proof can be issued.
        }
      }
      return response;
    }
  }

  private token(request: Request) {
    return request.headers
      .get('cookie')
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${this.cookieName}=`))
      ?.slice(this.cookieName.length + 1);
  }

  private offerRecovery(response: Response, token: string | undefined) {
    const binding = token && this.repository.resetBinding(token);
    if (token && binding && !binding.active)
      response.headers.set(
        recoveryHeader,
        recoveryProof(token, binding.id, Date.now() + recoveryLifetimeMs),
      );
    return response;
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      url.origin !== this.origin ||
      request.headers.get('origin') !== this.origin
    )
      return error(
        403,
        'ORIGIN_REJECTED',
        'Same-origin requests are required.',
      );
    if (request.method !== 'POST')
      return error(405, 'METHOD_REJECTED', 'POST is required.');
    if (
      request.headers.get('content-type')?.split(';')[0] !== 'application/json'
    )
      return error(415, 'JSON_REQUIRED', 'JSON is required.');
    const token = this.token(request);
    let body: unknown;
    try {
      body = await readBody(request);
      request.signal.throwIfAborted();
    } catch {
      return error(400, 'INVALID_INPUT', 'Invalid or oversized JSON request.');
    }
    if (url.pathname === '/api/workspace/reset') {
      const id = request.headers.get('x-workspace-binding');
      const proof = request.headers.get(recoveryHeader);
      const result =
        token &&
        this.repository.delete(token, (binding) =>
          binding.active
            ? id === binding.id && !proof
            : !id && validRecovery(token, binding.id, proof),
        );
      if (!result || result === 'unauthorized')
        return error(
          401,
          'UNAUTHORIZED',
          'Workspace authorization is required.',
        );
      if (result === 'retired')
        return error(
          409,
          'BINDING_RETIRED',
          'Inspect the workspace again before resetting.',
        );
      return json({ reset: true }, 200, {
        'Set-Cookie': this.cookie('', true),
      });
    }
    let workspace = token ? this.repository.get(token) : undefined;
    if (workspace) this.repository.touch(workspace);
    if (url.pathname === '/api/workspace/bootstrap') {
      const parsed = z
        .object({ reconcile: z.boolean().optional() })
        .strict()
        .safeParse(body);
      if (!parsed.success)
        return error(400, 'INVALID_INPUT', 'Invalid workspace request.');
      let newToken: string | undefined;
      if (!workspace) {
        newToken = `${crypto.randomUUID()}${crypto.randomUUID()}`;
        workspace = this.repository.create(newToken);
      }
      if (workspace.binding || workspace.needsReconciliation) {
        this.repository.retire(workspace);
        if (!parsed.data.reconcile)
          return this.offerRecovery(
            json({
              needsReconciliation: true,
              records: workspace.plans.snapshot(),
              operations: workspace.plans.review(),
              storage: this.repository.storage,
            }),
            token,
          );
      }
      const binding = new WorkspaceBinding(workspace.plans, this.dependencies);
      this.repository.bind(workspace, binding);
      return json(
        {
          needsReconciliation: false,
          bindingId: binding.id,
          sessionId: binding.sessionId,
          threadId: binding.threadId,
          records: workspace.plans.snapshot(),
          storage: this.repository.storage,
        },
        200,
        newToken ? { 'Set-Cookie': this.cookie(newToken) } : undefined,
      );
    }
    if (!workspace || !token)
      return error(401, 'UNAUTHORIZED', 'Workspace authorization is required.');
    const binding = workspace.binding;
    if (
      !binding ||
      request.headers.get('x-workspace-binding') !== binding.id ||
      binding.lifetime.signal.aborted
    )
      return error(
        409,
        'BINDING_RETIRED',
        'Reconcile this workspace before continuing.',
      );
    if (url.pathname === '/api/workspace/stop') {
      this.repository.retire(workspace);
      return json({ stopped: true });
    }
    if (url.pathname === '/api/workspace/voice') {
      try {
        const key = z
          .string()
          .min(10)
          .max(512)
          .parse(request.headers.get('x-openai-key'));
        return json(
          await binding.voice.exchange(
            body,
            key,
            AbortSignal.any([
              request.signal,
              binding.lifetime.signal,
              AbortSignal.timeout(35_000),
            ]),
          ),
        );
      } catch {
        return error(
          502,
          'VOICE_UNAVAILABLE',
          'Voice could not connect. Check microphone permission, network, and OpenAI model access before starting a new attempt.',
        );
      }
    }
    const signal = AbortSignal.any([
      request.signal,
      binding.lifetime.signal,
      AbortSignal.timeout(50_000),
    ]);
    const stop = () => binding.stop();
    signal.addEventListener('abort', stop, { once: true });
    try {
      signal.throwIfAborted();
      if (url.pathname === '/api/workspace/records')
        return json(binding.snapshot());
      if (url.pathname === '/api/workspace/operations') {
        const operation = z
          .object({
            requestId: z.string().min(1).max(256),
            index: z.number().int().nonnegative().max(255),
          })
          .strict()
          .parse(body);
        return json(
          workspace.plans.execute(operation.requestId, operation.index),
        );
      }
      const key = z
        .string()
        .min(10)
        .max(512)
        .parse(request.headers.get('x-openai-key'));
      if (url.pathname === '/api/workspace/exchange')
        return json(await binding.exchange(body, key, signal));
      if (url.pathname === '/api/goal') {
        const events = await binding.runGoal(body, key, signal);
        async function* stream() {
          for (const event of events) yield event;
        }
        const response = toServerSentEventsResponse(stream());
        response.headers.set(
          'Content-Type',
          'text/event-stream; charset=utf-8',
        );
        response.headers.set('Cache-Control', 'no-store');
        response.headers.set('X-Content-Type-Options', 'nosniff');
        return response;
      }
      return error(404, 'NOT_FOUND', 'Unknown workspace endpoint.');
    } catch {
      binding.stop();
      return error(
        409,
        'WORKSPACE_STOPPED',
        'The workspace stopped. Inspect records and reconcile before continuing. No write will be retried automatically.',
      );
    } finally {
      signal.removeEventListener('abort', stop);
    }
  }
}
