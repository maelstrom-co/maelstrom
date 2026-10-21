import type { UpdateVesselResult } from '@maelstrom-co/react';
import { useEffect } from 'react';
import { withActionOptions } from '../lib/vessel-options';
import { mailM } from './maelstrom';
import { useMailStore } from './stores/mail.store';
import { inboxVessel } from './vessels/inbox.vessel';

/**
 * Renders nothing. Publishes the inbox subjects as the allowed values of
 * `inbox.openEmail`, so the planner names a real email instead of relying on
 * the action's fuzzy fallback.
 */
export function MailOptionSync() {
  const { emails } = useMailStore();
  const isProcessing = mailM.useMaelstrom((state) => state.isProcessing);
  const subjects = [
    ...new Set(
      emails
        .map((email) => email.subject)
        .filter((subject) => subject.trim().length > 0),
    ),
  ];
  const subjectKey = JSON.stringify(subjects);

  useEffect(
    () =>
      republishWithRetry(() =>
        mailM.updateVessel(
          withActionOptions(inboxVessel, { openEmail: { subject: subjects } }),
        ),
      ),
    [subjectKey, isProcessing],
  );

  return null;
}

const MAX_BATCH_IN_FLIGHT_RETRIES = 5;
const RETRY_BASE_DELAY_MS = 100;

// A republish is refused with 'batch_in_flight' while an engine command batch
// is executing, which is transient, so it retries on a short bounded backoff.
function republishWithRetry(publish: () => UpdateVesselResult): () => void {
  let cancelled = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const attempt = (retryCount: number) => {
    if (cancelled) return;
    const result = publish();
    if (result.ok) return;
    const { conflict } = result;
    if (
      conflict.code !== 'batch_in_flight' ||
      retryCount >= MAX_BATCH_IN_FLIGHT_RETRIES
    ) {
      console.warn(
        `[mail-option-sync] ${conflict.vesselId}: republish refused (${conflict.code}) ${conflict.message}`,
      );
      return;
    }
    timeoutId = setTimeout(
      () => attempt(retryCount + 1),
      RETRY_BASE_DELAY_MS * 2 ** retryCount,
    );
  };

  attempt(0);

  return () => {
    cancelled = true;
    clearTimeout(timeoutId);
  };
}
