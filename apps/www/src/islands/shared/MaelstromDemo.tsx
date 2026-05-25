import type {
  ChartProps,
  MaelstromProviderProps,
  MaelstromState,
} from '@maelstrom-co/react';
import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * The slice of a Maelstrom instance the demo engine drives. Every site instance
 * (hero, "See It In Action") satisfies this structurally, so the engine stays
 * vessel-agnostic and can be shared across demos with different vessel sets.
 */
export interface DemoMaelstrom {
  Provider: ComponentType<MaelstromProviderProps>;
  Chart: ComponentType<ChartProps>;
  useMaelstrom: () => MaelstromState;
}

export type DemoPhase = 'idle' | 'typing' | 'processing' | 'rearranged';

/** One scripted turn: the prompt to "type", and the rationale revealed after it processes. */
export interface DemoScriptStep {
  prompt: string;
  rationale: string;
}

/** Playback state handed to the chrome render-prop on every render. */
export interface DemoRenderState {
  typedText: string;
  phase: DemoPhase;
  rationale: string | null;
  isProcessing: boolean;
  /** Restart playback from the opening layout. */
  replay: () => void;
  /** The instance's Chart, so the chrome can place it wherever it likes. */
  Chart: ComponentType<ChartProps>;
}

export interface MaelstromDemoProps {
  m: DemoMaelstrom;
  /** Fresh connector per cycle — called again on each replay for a clean reset. */
  createConnector: () => MaelstromProviderProps['connector'];
  /** Intent fired once on connect to render the opening layout (e.g. 'show dashboard'). */
  initialIntent?: string;
  /** Ordered turns to replay. Order must align with the connector's step order. */
  script: DemoScriptStep[];
  layoutMode?: MaelstromProviderProps['layoutMode'];
  tilingPaddingPx?: number;
  children: (state: DemoRenderState) => ReactNode;
}

const TYPE_MS_PER_CHAR = 40;
const HOLD_BEFORE_PROCESS_MS = 500;
const PAUSE_BETWEEN_STEPS_MS = 3000;
const REPLAY_DELAY_MS = 6000;
const INIT_SETTLE_MS = 100;
const POST_INIT_MS = 1500;

/**
 * Headless engine shared by every Maelstrom demo on the site. It owns the
 * Provider, the connector lifecycle, and the scripted auto-play/loop driver,
 * handing playback state to a render-prop so each call site supplies its own
 * chrome. Animations always run (no reduced-motion gate) — these demos are the
 * product showcase.
 */
export function MaelstromDemo({
  m,
  createConnector,
  initialIntent,
  script,
  layoutMode = 'tiling',
  tilingPaddingPx = 4,
  children,
}: MaelstromDemoProps) {
  // Bumping the key remounts the Provider with a fresh connector, giving a
  // clean reset for each loop.
  const [cycleKey, setCycleKey] = useState(0);
  const createConnectorRef = useRef(createConnector);
  createConnectorRef.current = createConnector;
  const connector = useMemo(() => createConnectorRef.current(), [cycleKey]);

  const { Provider } = m;
  return (
    <Provider
      key={cycleKey}
      connector={connector}
      layoutMode={layoutMode}
      tilingPaddingPx={tilingPaddingPx}
    >
      <DemoDriver
        m={m}
        initialIntent={initialIntent}
        script={script}
        onReplay={() => setCycleKey((k) => k + 1)}
      >
        {children}
      </DemoDriver>
    </Provider>
  );
}

function DemoDriver({
  m,
  initialIntent,
  script,
  onReplay,
  children,
}: {
  m: DemoMaelstrom;
  initialIntent?: string;
  script: DemoScriptStep[];
  onReplay: () => void;
  children: (state: DemoRenderState) => ReactNode;
}) {
  const { processIntent, isProcessing, connectionStatus } = m.useMaelstrom();
  const [typedText, setTypedText] = useState('');
  const [phase, setPhase] = useState<DemoPhase>('idle');
  const [rationale, setRationale] = useState<string | null>(null);

  const initializedRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // Refs for the latest callbacks/data so the init effect needn't re-run when
  // the Provider swaps orchestrators (StrictMode, remounts).
  const processIntentRef = useRef(processIntent);
  processIntentRef.current = processIntent;
  const onReplayRef = useRef(onReplay);
  onReplayRef.current = onReplay;
  const scriptRef = useRef(script);
  scriptRef.current = script;

  const cleanup = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, []);

  const typeAndProcess = useCallback(
    (step: DemoScriptStep, onDone: () => void) => {
      setTypedText('');
      setPhase('typing');

      let i = 0;
      intervalRef.current = setInterval(() => {
        i++;
        setTypedText(step.prompt.slice(0, i));
        if (i >= step.prompt.length) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          timeoutRef.current = setTimeout(async () => {
            setPhase('processing');
            try {
              await processIntentRef.current(step.prompt);
            } catch (err) {
              console.warn('[MaelstromDemo] processIntent failed', err);
            } finally {
              // A breakpoint-cross remount can unmount mid-await; don't touch
              // state or advance a dead tree. finally still runs so a rejected
              // processIntent can't strand the demo in 'processing' forever.
              if (isMountedRef.current) {
                setRationale(step.rationale);
                setPhase('rearranged');
                onDone();
              }
            }
          }, HOLD_BEFORE_PROCESS_MS);
        }
      }, TYPE_MS_PER_CHAR);
    },
    [],
  );

  const runScript = useCallback(() => {
    if (phaseRef.current !== 'idle') return;
    const steps = scriptRef.current;
    const runStep = (idx: number) => {
      if (idx >= steps.length) {
        timeoutRef.current = setTimeout(
          () => onReplayRef.current(),
          REPLAY_DELAY_MS,
        );
        return;
      }
      typeAndProcess(steps[idx], () => {
        timeoutRef.current = setTimeout(
          () => runStep(idx + 1),
          PAUSE_BETWEEN_STEPS_MS,
        );
      });
    };
    runStep(0);
  }, [typeAndProcess]);

  // Track mount so the async step callback can bail after its await when a
  // breakpoint-cross remount (key change) has already torn down this instance.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Wait for the orchestrator to connect, then play the opening intent and the
  // script. The Provider creates its orchestrator in an effect (StrictMode), so
  // we settle briefly before the first processIntent.
  useEffect(() => {
    if (connectionStatus !== 'connected' || initializedRef.current) return;
    initializedRef.current = true;

    const initTimer = setTimeout(() => {
      const begin = () => {
        timeoutRef.current = setTimeout(runScript, POST_INIT_MS);
      };
      if (initialIntent) {
        processIntentRef
          .current(initialIntent)
          .then(begin)
          .catch((err) => {
            console.warn('[MaelstromDemo] failed to initialize demo', err);
          });
      } else {
        begin();
      }
    }, INIT_SETTLE_MS);

    return () => {
      clearTimeout(initTimer);
      cleanup();
    };
  }, [connectionStatus, runScript, cleanup, initialIntent]);

  return (
    <>
      {children({
        typedText,
        phase,
        rationale,
        isProcessing,
        replay: () => onReplayRef.current(),
        Chart: m.Chart,
      })}
    </>
  );
}
