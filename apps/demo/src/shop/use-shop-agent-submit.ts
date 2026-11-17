import type {
  AgentRunError,
  AgentRunState,
  MessageId,
  SettledAgentRun,
} from '@maelstrom-co/react';
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
   * connected, before the input settles, so the draft may still be restored
   * when the message was not sent, the transport refused it, or the run
   * fails on a model provider code.
   * Returns false for a blank draft, a missing key or a connection that is
   * not up yet.
   */
  readonly submit: () => boolean;
  readonly changeDraft: (value: string) => void;
}

/**
 * Sends typed `/shop` input through the agent path. A message that was not
 * sent or that the transport refused, or in browser-key mode a run that
 * fails on a model provider code, puts the sent
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
  const restoreDraft = (submission: Submission) => {
    if (
      latestSubmission.current === submission &&
      draftRevision.current === submission.revision &&
      !current.current.intent
    ) {
      current.current.onIntentChange(submission.text);
    }
  };

  const reportProviderFailure = (submission: Submission) => {
    restoreDraft(submission);
    current.current.onMintError(MODEL_FAILURE_MESSAGE);
  };

  // A stale loss settles the result, but the run can still resume and fail
  // on the provider afterwards, so it stays watched in the store until it
  // ends, is lost for good or leaves the store.
  const [staleWatched, setStaleWatched] = useState<readonly StaleSubmission[]>(
    [],
  );
  useEffect(() => {
    if (staleWatched.length === 0) return;
    const remaining = staleWatched.filter(({ submission, inputId }) => {
      const run = runs.find((known) => known.inputId === inputId);
      if (run === undefined) return false;
      if (isProviderFailureRun(run)) {
        reportProviderFailure(submission);
        return false;
      }
      return isStaleLost(run) || isActive(run);
    });
    if (remaining.length !== staleWatched.length) setStaleWatched(remaining);
    // oxlint-disable-next-line react/exhaustive-deps -- reportProviderFailure reads only refs.
  }, [runs, staleWatched]);

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
    // A submit outside a React event can see its message settle unsent before the cleared draft commits.
    current.current = { ...current.current, intent: '' };
    const submission: Submission = {
      text: intent,
      revision: draftRevision.current,
    };
    latestSubmission.current = submission;
    void sendShopInput(sendMessage, text, 'text').result.then((run) => {
      if (!mounted.current) return;
      if (wasNotSent(run)) {
        restoreDraft(submission);
        return;
      }
      if (!browserKeyMode) return;
      if (isProviderFailureRun(run)) {
        reportProviderFailure(submission);
      } else if (isStaleLost(run)) {
        setStaleWatched((known) => [
          ...known,
          { submission, inputId: run.inputId },
        ]);
      }
    });
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

function wasNotSent(run: SettledAgentRun): boolean {
  return (
    run.status === 'not_submitted' ||
    (run.status === 'lost' && run.lostReason === 'send_failed')
  );
}

type StaleSubmission = {
  readonly submission: Submission;
  readonly inputId: MessageId;
};

function isProviderFailureRun(
  run: AgentRunState,
): run is AgentRunState & { status: 'failed'; error: AgentRunError } {
  return run.status === 'failed' && isProviderFailure(run.error);
}

function isStaleLost(run: AgentRunState): boolean {
  return run.status === 'lost' && run.lostReason === 'stale_run';
}

function isActive(run: AgentRunState): boolean {
  return (
    run.status === 'pending' ||
    run.status === 'working' ||
    run.status === 'streaming'
  );
}
