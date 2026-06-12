import { beforeEach, describe, expect, it, mock } from 'bun:test';

const contactsCreate = mock(async () => ({ data: { id: 'c1' }, error: null }));
const segmentsAdd = mock(async () => ({}));

// Registered before the dynamic import below so the route's top-level
// `cloudflare:workers` and `resend` imports resolve to these stubs.
mock.module('cloudflare:workers', () => ({
  env: { RESEND_API_KEY: 'test-key', RESEND_SEGMENT_ID: 'seg_1' },
}));
mock.module('resend', () => ({
  Resend: class {
    contacts = {
      create: contactsCreate,
      segments: { add: segmentsAdd },
    };
  },
}));

// Dynamic import is required here: mock.module must run before the module loads,
// and static imports are hoisted above it.
const { POST } = await import('./waitlist');

const callPost = (body: string) =>
  POST({
    request: new Request('https://example.com/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }),
  } as unknown as Parameters<typeof POST>[0]);

beforeEach(() => {
  contactsCreate.mockReset();
  segmentsAdd.mockReset();
  contactsCreate.mockResolvedValue({ data: { id: 'c1' }, error: null });
  segmentsAdd.mockResolvedValue({});
});

describe('POST /api/waitlist', () => {
  it('400s on a malformed JSON body', async () => {
    const res = await callPost('not json{');
    expect(res.status).toBe(400);
    expect(contactsCreate).not.toHaveBeenCalled();
  });

  it('400s on an invalid email without calling Resend', async () => {
    const res = await callPost(JSON.stringify({ email: 'nope' }));
    expect(res.status).toBe(400);
    expect(contactsCreate).not.toHaveBeenCalled();
  });

  it('200s and adds the contact to the segment on success', async () => {
    const res = await callPost(JSON.stringify({ email: 'user@example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(contactsCreate).toHaveBeenCalledTimes(1);
    expect(segmentsAdd).toHaveBeenCalledTimes(1);
  });

  it('500s with a generic message — never leaking the raw Resend error', async () => {
    contactsCreate.mockResolvedValue({
      data: null,
      error: { message: 'resend internal detail' },
    });
    const res = await callPost(JSON.stringify({ email: 'user@example.com' }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain('resend internal detail');
  });

  it('500s when contacts.create throws', async () => {
    contactsCreate.mockRejectedValue(new Error('network down'));
    const res = await callPost(JSON.stringify({ email: 'user@example.com' }));
    expect(res.status).toBe(500);
  });

  it('still succeeds when the segment add fails (best-effort, must not fail signup)', async () => {
    segmentsAdd.mockRejectedValue(new Error('segment unavailable'));
    const res = await callPost(JSON.stringify({ email: 'user@example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });
});
