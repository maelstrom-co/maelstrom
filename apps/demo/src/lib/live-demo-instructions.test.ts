import type { LiveExchangeRequest } from '@maelstrom-co/realtime-protocol/openai-live';
import { expect, it } from 'vitest';
import { configureDemoLiveOffer } from './live-demo-instructions';

it('does not seed a frozen date into either model of a long-lived Live session', () => {
  const calendar = {
    localDate: '2026-09-26',
    timeZone: 'America/Montevideo',
    observedAt: '2026-09-27T02:59:59.000Z',
  };
  const offer: LiveExchangeRequest = {
    session: {
      model: 'gpt-live-1',
      instructions: 'Keep the caller conversation policy.',
      delegation: {
        type: 'responses',
        responses: {
          model: 'gpt-5.4-mini',
          instructions: 'Keep the caller tool policy.',
        },
      },
    },
    transport: { type: 'webrtc', sdp: 'fixture-sdp' },
  };
  const original = structuredClone(offer);
  const configured = configureDemoLiveOffer(offer, calendar);
  for (const prompt of [
    configured.session.instructions!,
    configured.session.delegation.responses.instructions!,
  ]) {
    expect(prompt).toContain(calendar.timeZone);
    expect(prompt).not.toContain(calendar.localDate);
    expect(prompt).not.toContain(calendar.observedAt);
  }
  expect(configured.session.instructions).toContain(offer.session.instructions);
  expect(configured.session.delegation.responses.instructions).toContain(
    offer.session.delegation.responses.instructions,
  );
  expect(configured.session.model).toBe(offer.session.model);
  expect(configured.session.delegation.responses.model).toBe(
    offer.session.delegation.responses.model,
  );
  expect(configured.transport).toEqual(offer.transport);
  expect(offer).toEqual(original);
});
