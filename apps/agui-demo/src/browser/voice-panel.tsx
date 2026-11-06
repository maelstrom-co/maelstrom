import { OpenAILiveAdapter } from '@maelstrom-co/realtime-openai-live';
import { LiveExchangeResponseSchema } from '@maelstrom-co/realtime-protocol/openai-live';
import { useEffect, useRef, useState } from 'react';

import type { GoalOutcome, WorkspaceRequest } from './goal-runner';
import { VoiceGoals } from './voice-goals';

interface Attempt {
  provider: OpenAILiveAdapter;
  release: () => void;
}

export function VoicePanel({
  request,
  run,
  disabled,
}: {
  request: WorkspaceRequest;
  run: (goal: string) => Promise<GoalOutcome>;
  disabled: boolean;
}) {
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  }, [run]);
  const current = useRef<Attempt | undefined>(undefined);
  const [active, setActive] = useState(false);
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const [caption, setCaption] = useState<{ role: string; text: string }>();
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [bridge] = useState(
    () =>
      new VoiceGoals(
        (goal) => runRef.current(goal),
        (event) => {
          if (event.type === 'error')
            setError(
              'Voice could not connect or deliver a result. Check the workspace outcome before reconnecting.',
            );
          if (event.type !== 'state') return;
          setState(event.state);
          if (event.state === 'error')
            setError(
              (message) =>
                message ||
                'Voice disconnected. Check the workspace outcome before starting a new connection.',
            );
          if (event.state === 'idle' || event.state === 'error') {
            current.current?.release();
            current.current = undefined;
            setActive(false);
            setPlaybackBlocked(false);
          }
        },
      ),
  );
  useEffect(
    () => () => {
      current.current?.release();
      current.current = undefined;
      void bridge.disconnect().catch(() => {});
    },
    [bridge],
  );

  async function toggle() {
    if (current.current) {
      current.current.release();
      current.current = undefined;
      setActive(false);
      setState('idle');
      setPlaybackBlocked(false);
      await bridge.disconnect().catch(() => {});
      return;
    }
    if (disabled) return;
    setError('');
    setCaption(undefined);
    setState('connecting');
    setActive(true);
    const provider = new OpenAILiveAdapter({
      model: 'gpt-live-1',
      voice: 'cedar',
      responses: {
        model: 'gpt-6-luna',
        parallel_tool_calls: false,
        max_output_tokens: 2_000,
      },
      exchange: async (input, signal) => {
        const response = await request('/api/workspace/voice', input, signal);
        if (!response.ok) throw new Error('Voice session unavailable.');
        return LiveExchangeResponseSchema.parse(await response.json());
      },
    });
    const attempt: Attempt = { provider, release: () => {} };
    current.current = attempt;
    const observations = provider.observations.subscribe((event) => {
      if (current.current !== attempt) return;
      if (event.type === 'fragment') {
        const { role, text } = event.fragment;
        setCaption((previous) => ({
          role,
          text: `${previous?.role === role ? previous.text : ''}${text}`.slice(
            -2_000,
          ),
        }));
      }
    });
    const playback = provider.generatedOpening.readiness.subscribe(() => {
      if (current.current === attempt)
        setPlaybackBlocked(
          provider.getTransportSnapshot().playback === 'blocked',
        );
    });
    attempt.release = () => {
      observations();
      playback();
    };
    try {
      const connecting = bridge.connect(provider);
      void provider.activateAudio().catch(() => {});
      await connecting;
    } catch {
      if (current.current !== attempt) return;
      attempt.release();
      current.current = undefined;
      setActive(false);
      setState('error');
      setError(
        'GPT-Live could not connect. Check microphone permission and OpenAI access to gpt-live-1 and gpt-6-luna.',
      );
    }
  }

  async function activateAudio() {
    const attempt = current.current;
    if (!attempt) return;
    try {
      await attempt.provider.activateAudio();
    } catch {
      if (current.current === attempt)
        setError('Audio playback remains blocked.');
    }
  }

  return (
    <section className="voice-panel" aria-label="GPT-Live voice">
      <button
        type="button"
        disabled={disabled && !active}
        onClick={() => {
          void toggle();
        }}
      >
        {active ? 'Stop GPT-Live' : 'Start GPT-Live'}
      </button>
      <span className="voice-status" role="status">
        {state === 'idle'
          ? 'Voice off'
          : state === 'connected'
            ? 'Listening'
            : state}
      </span>
      {playbackBlocked && (
        <button
          type="button"
          onClick={() => {
            void activateAudio();
          }}
        >
          Enable audio
        </button>
      )}
      {caption && (
        <span className="voice-caption">
          {caption.role === 'user' ? 'You' : 'Assistant'}: {caption.text}
        </span>
      )}
      {error && (
        <span role="alert" className="voice-error">
          {error}
        </span>
      )}
    </section>
  );
}
