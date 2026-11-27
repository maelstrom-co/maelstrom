export interface NarrationStore {
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string): Promise<void>;
  readVersioned(
    key: string,
  ): Promise<{ value: string; etag: string } | undefined>;
  compareAndSet(
    key: string,
    value: string,
    etag: string | undefined,
  ): Promise<boolean>;
}

export interface HeldNarrationAttempt {
  version: string;
  index: number;
  attemptId: string;
}

type Attempt = {
  id: string;
  count: number;
  retryAt?: number;
  supersedes?: string;
};

export class NarrationAttemptUnavailable extends Error {}

export async function readBoundedNarrationBody(
  response: Response,
  maximum: number,
  onBytes?: (length: number) => void,
) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing speech response body');
  let size = 0;
  let text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.length;
      onBytes?.(value.length);
      if (size > maximum)
        throw new Error('Speech response exceeded its size limit');
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
}

function exponentialDelay(response: Response, count: number, now: number) {
  const retryAfter = response.headers.get('Retry-After');
  const delay =
    retryAfter && /^\d+$/u.test(retryAfter)
      ? Number(retryAfter) * 1000
      : Date.parse(retryAfter ?? '') - now;
  const backoff = Math.min(3_600_000, 60_000 * 2 ** (count - 1));
  return Math.max(backoff, Number.isSafeInteger(now + delay) ? delay : 0);
}

async function acknowledgedRejection(response: Response) {
  if (
    response.status !== 429 ||
    response.redirected ||
    response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
      'application/json'
  ) {
    await response.body?.cancel();
    return false;
  }
  try {
    const { detail } = JSON.parse(
      await readBoundedNarrationBody(response, 32_768),
    ) as {
      detail?: { code?: string; status?: string };
    };
    const code = detail?.code ?? detail?.status;
    return (
      (!detail?.code || !detail.status || detail.code === detail.status) &&
      (code === 'system_busy' || code === 'too_many_concurrent_requests')
    );
  } catch {
    return false;
  }
}

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const attemptKey = (version: string, index: number) =>
  `blog-narration-attempts/${version}/${index}.json`;
const authorizationKey = (version: string, index: number, id: string) =>
  `blog-narration-attempts/${version}/${index}/${id}.authorized`;

function parseAttempt(value: string): Attempt {
  const attempt = JSON.parse(value) as Attempt | null;
  if (
    !attempt ||
    typeof attempt.id !== 'string' ||
    uuid.exec(attempt.id)?.[0] !== attempt.id ||
    !Number.isSafeInteger(attempt.count) ||
    attempt.count < 1 ||
    (attempt.retryAt !== undefined && !Number.isFinite(attempt.retryAt))
  ) {
    throw new Error('Invalid narration attempt record');
  }
  return attempt;
}

export async function authorizeHeldAttempt(
  store: NarrationStore,
  options: HeldNarrationAttempt,
) {
  const { version, index, attemptId } = options;
  if (
    !/^[a-f0-9]{64}$/u.test(version) ||
    version.length !== 64 ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index > 9_999 ||
    uuid.exec(attemptId)?.[0] !== attemptId
  ) {
    throw new Error('Invalid held narration attempt selector');
  }
  const current = await store.readVersioned(attemptKey(version, index));
  const attempt =
    current === undefined ? undefined : parseAttempt(current.value);
  if (
    attempt?.id !== attemptId ||
    (attempt.retryAt !== undefined && attempt.count < 3) ||
    (await store.get(`blog-narration/${version}/${index}.json`)) !== undefined
  ) {
    throw new Error('Narration attempt is no longer held');
  }
  if (
    !(await store.compareAndSet(
      authorizationKey(version, index, attemptId),
      attemptId,
      undefined,
    ))
  ) {
    throw new Error('Narration attempt is already authorized');
  }
}

export async function fencedSpeech<T>(options: {
  store: NarrationStore;
  version: string;
  index: number;
  maySynthesize: boolean;
  now?: () => number;
  beforeSynthesis: () => Promise<void>;
  beforeSend?: () => Promise<void>;
  request: () => Promise<Response>;
  decode: (raw: string) => Promise<T>;
}) {
  const { store, version, index } = options;
  const now = options.now ?? Date.now;
  const key = attemptKey(version, index);
  const current = await store.readVersioned(key);
  const previous =
    current === undefined ? undefined : parseAttempt(current.value);
  const authorization =
    previous && (previous.retryAt === undefined || previous.count >= 3)
      ? await store.get(authorizationKey(version, index, previous.id))
      : undefined;
  const exactAuthorization =
    authorization === previous?.id && previous !== undefined;
  const held = (id: string) =>
    new NarrationAttemptUnavailable(
      `Held narration: version=${version} chunk=${index} attempt=${id}`,
    );
  const responseKey = (id: string) =>
    `blog-narration-attempts/${version}/${index}/${id}.response`;
  if (previous) {
    const saved = await store.get(responseKey(previous.id));
    if (saved !== undefined) {
      try {
        return await options.decode(saved);
      } catch {
        if (!exactAuthorization) throw held(previous.id);
      }
    }
  }

  if (!options.maySynthesize) {
    throw previous
      ? held(previous.id)
      : new NarrationAttemptUnavailable(
          `No authorized narration attempt for version=${version} chunk=${index}`,
        );
  }
  if (previous && !exactAuthorization) {
    if (previous.retryAt === undefined || previous.count >= 3)
      throw held(previous.id);
    if (now() < previous.retryAt) {
      throw new NarrationAttemptUnavailable(
        `Retry due later for version=${version} chunk=${index}`,
      );
    }
  }
  await options.beforeSynthesis();
  const claimed: Attempt = {
    id: crypto.randomUUID(),
    count: exactAuthorization ? 3 : (previous?.count ?? 0) + 1,
    ...(previous ? { supersedes: previous.id } : {}),
  };
  if (
    !(await store.compareAndSet(key, JSON.stringify(claimed), current?.etag))
  ) {
    throw new NarrationAttemptUnavailable(
      `Narration claim already changed for version=${version} chunk=${index}`,
    );
  }

  const markRetry = async (retryAt: number) => {
    const owned = await store.readVersioned(key);
    if (owned && owned.value === JSON.stringify(claimed)) {
      await store.compareAndSet(
        key,
        JSON.stringify({ ...claimed, retryAt }),
        owned.etag,
      );
    }
  };
  try {
    await options.beforeSend?.();
  } catch (error) {
    await markRetry(now() + 60_000);
    throw error;
  }
  // A missing response after this point never makes the claim eligible to replay.
  try {
    const response = await options.request();
    if (!response.ok) {
      if (await acknowledgedRejection(response)) {
        const time = now();
        await markRetry(time + exponentialDelay(response, claimed.count, time));
      }
      throw held(claimed.id);
    }
    const raw = await readBoundedNarrationBody(response, 40 * 1024 * 1024);
    await store.put(responseKey(claimed.id), raw);
    return await options.decode(raw);
  } catch {
    throw held(claimed.id);
  }
}
