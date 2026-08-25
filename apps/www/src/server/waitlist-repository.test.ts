import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { WaitlistRepository } from './waitlist-repository';
import { makeWaitlistRepositoryTestLayer } from './waitlist-repository.test-layer';

const runClaim = (layer: ReturnType<typeof makeWaitlistRepositoryTestLayer>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const repository = yield* WaitlistRepository;
      return yield* repository.claimDeliveryAttempt({
        id: 'attempt',
        email: 'user@example.com',
        tokenHash: 'token-hash',
        expiresAt: '2026-08-25T01:00:00.000Z',
        attemptedAt: '2026-08-25T00:00:00.000Z',
        cooldownSince: '2026-08-24T23:50:00.000Z',
      });
    }).pipe(Effect.provide(layer)),
  );

describe('WaitlistRepository test layer', () => {
  test('provides explicit Effect-native operations', async () => {
    expect(
      await runClaim(
        makeWaitlistRepositoryTestLayer({
          claimDeliveryAttempt: () => Effect.succeed(true),
        }),
      ),
    ).toBe(true);
  });

  test('fails loudly when a workflow touches an omitted operation', async () => {
    await expect(runClaim(makeWaitlistRepositoryTestLayer({}))).rejects.toThrow(
      '@maelstrom/www/WaitlistRepository: Unimplemented method "claimDeliveryAttempt"',
    );
  });
});
