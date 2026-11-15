import type { MessageId } from '@maelstrom-co/client';
import type { AgentRunState } from '@maelstrom-co/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { isInvalidKeyFailure } from '../lib/invalid-key-error';
import { shopM } from './maelstrom';
import { sendShopInput } from './send-shop-input';

/** What the typed `/shop` submit needs from the page. */
export interface ShopAgentSubmitOptions {
  /** The current draft in the input. */
  readonly intent: string;
  /** Replaces the draft in the input. */
  readonly onIntentChange: (intent: string) => void;
  /** True while the browser-key build has no key to send with. */
  readonly needsKey: boolean;
  /** True when the visitor's own key authorizes the Engine's model calls. */
  readonly browserKeyMode: boolean;
  /** Called instead of sending while a key is needed. */
  readonly onBlockedSubmit: () => void;
  /** Called with the message to show when the visitor's key was rejected. */
  readonly onMintError: (message: string) => void;
}

/** The typed `/shop` submit and the draft setter it guards restores with. */
export interface ShopAgentSubmit {
  /**
   * Sends the trimmed draft to the agent as `text` input and clears the
   * draft. Returns true when the draft was handed to `sendMessage` while
   * connected, and false for a blank draft, a missing key or a connection
   * that is not up yet.
   */
  readonly submit: () => boolean;
  /** Replaces the draft as the visitor's own edit. */
  readonly changeDraft: (value: string) => void;
}

/**
 * Sends typed `/shop` input through the agent path. A rejected send, or a
 * run that fails because the visitor's browser key was rejected, puts the
 * sent text back in the input when it is still the latest submission and the
 * visitor has not typed since. A rejected key also reports the mint error.
 */
export function useShopAgentSubmit({
  intent,
  onIntentChange,
  needsKey,
  browserKeyMode,
  onBlockedSubmit,
  onMintError,
}: ShopAgentSubmitOptions): ShopAgentSubmit {
  const { connectionStatus } = shopM.useMaelstrom();
  const { runs, sendMessage } = shopM.useAgentRun();
  const draftRevision = useRef(0);
  const latestSubmission = useRef<Submission | null>(null);
  const current = useRef({ intent, onIntentChange, onMintError });
  useLayoutEffect(() => {
    current.current = { intent, onIntentChange, onMintError };
  });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [watched, setWatched] = useState<readonly WatchedSubmission[]>([]);

  const restoreDraft = (submission: Submission) => {
    if (
      latestSubmission.current === submission &&
      draftRevision.current === submission.revision &&
      !current.current.intent
    ) {
      current.current.onIntentChange(submission.text);
    }
  };

  useEffect(() => {
    if (watched.length === 0) return;
    const remaining = watched.filter(({ submission, inputId }) => {
      const run = runs.find((known) => known.inputId === inputId);
      if (run === undefined) return true;
      if (
        run.status === 'failed' &&
        run.error !== null &&
        isInvalidKeyFailure(run.error)
      ) {
        restoreDraft(submission);
        current.current.onMintError('Invalid API key.');
        return false;
      }
      return !isSettled(run);
    });
    if (remaining.length !== watched.length) setWatched(remaining);
    // oxlint-disable-next-line react/exhaustive-deps -- restoreDraft reads only refs.
  }, [runs, watched]);

  const changeDraft = (value: string) => {
    draftRevision.current++;
    onIntentChange(value);
  };

  const submit = (): boolean => {
    const text = intent.trim();
    if (!text) return false;
    if (needsKey) {
      onBlockedSubmit();
      return false;
    }
    if (connectionStatus !== 'connected') return false;
    changeDraft('');
    const submission: Submission = {
      text: intent,
      revision: draftRevision.current,
    };
    latestSubmission.current = submission;
    sendShopInput(sendMessage, text, 'text').then(
      (inputId) => {
        if (!mounted.current || !browserKeyMode) return;
        setWatched((known) => [...known, { submission, inputId }]);
      },
      () => {
        if (mounted.current) restoreDraft(submission);
      },
    );
    return true;
  };

  return { submit, changeDraft };
}

type Submission = {
  readonly text: string;
  readonly revision: number;
};

type WatchedSubmission = {
  readonly submission: Submission;
  readonly inputId: MessageId;
};

function isSettled(run: AgentRunState): boolean {
  return (
    run.status === 'finished' ||
    run.status === 'failed' ||
    (run.status === 'lost' && run.lostReason !== 'stale_run')
  );
}
