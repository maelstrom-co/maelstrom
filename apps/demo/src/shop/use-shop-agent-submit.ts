import type { MessageId } from '@maelstrom-co/client';
import type { AgentRunState } from '@maelstrom-co/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { isProviderFailure } from '../lib/invalid-key-error';
import { shopM } from './maelstrom';
import { sendShopInput } from './send-shop-input';

/** What the typed `/shop` submit needs from the page. */
export interface ShopAgentSubmitOptions {
  readonly intent: string;
  readonly onIntentChange: (intent: string) => void;
  readonly needsKey: boolean;
  /**
   * True when the visitor's own key authorizes the Engine's model calls. Only
   * then are runs watched for a model provider failure.
   */
  readonly browserKeyMode: boolean;
  readonly onBlockedSubmit: () => void;
  /**
   * Called with the message to show when a watched run fails on a model
   * provider code. The wire does not say whether the key was rejected, so the
   * message asks the visitor to check the key rather than calling it invalid.
   */
  readonly onMintError: (message: string) => void;
}

/** The typed `/shop` submit and the draft setter it guards restores with. */
export interface ShopAgentSubmit {
  /**
   * Sends the trimmed draft to the agent as `text` input and clears the
   * draft. Returns true once the draft was dispatched to `sendMessage` while
   * connected, before the send settles, so the draft may still be restored
   * when the send is rejected or the run fails on a model provider code.
   * Returns false for a blank draft, a missing key or a connection that is
   * not up yet.
   */
  readonly submit: () => boolean;
  readonly changeDraft: (value: string) => void;
}

/**
 * Sends typed `/shop` input through the agent path. A rejected send, or in
 * browser-key mode a run that fails on a model provider code, puts the sent
 * text back in the input when it is still the latest submission and the
 * visitor has not typed since. A provider failure also reports the mint
 * error.
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
      if (run === undefined) return false;
      if (
        run.status === 'failed' &&
        run.error !== null &&
        isProviderFailure(run.error)
      ) {
        restoreDraft(submission);
        current.current.onMintError(MODEL_FAILURE_MESSAGE);
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

const MODEL_FAILURE_MESSAGE =
  'The model request failed. Check your API key and try again.';

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
