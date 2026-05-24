import { MaelstromDemo, type DemoRenderState } from '../shared/MaelstromDemo';
import { DemoConnector, DEMO_STEPS } from './connector';
import { m } from './maelstrom';

// Prompts + rationales replayed by the demo, aligned with DemoConnector's step
// order (step 0 is the initial 'show dashboard' layout).
const SCRIPT = [
  { prompt: DEMO_STEPS[1].prompt!, rationale: DEMO_STEPS[1].rationale },
  { prompt: DEMO_STEPS[2].prompt!, rationale: DEMO_STEPS[2].rationale },
];

// ── Chrome (presentational; playback state comes from MaelstromDemo) ──

function DemoChrome({
  typedText,
  phase,
  rationale,
  isProcessing,
  replay,
  Chart,
}: DemoRenderState) {
  const showRationale = phase === 'rearranged' && rationale;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Browser-framed dashboard */}
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{
          background: 'rgba(5, 12, 25, 0.8)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          boxShadow:
            '0 25px 80px rgba(0, 0, 0, 0.5), 0 0 120px rgba(0, 145, 255, 0.03), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
        }}
      >
        {/* Top edge highlight */}
        <div
          className="absolute top-0 inset-x-0 h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent, rgba(0, 145, 255, 0.12), transparent)',
          }}
        />

        {/* Browser chrome */}
        <div
          className="flex items-center gap-3 px-5 py-3"
          style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}
        >
          <div className="flex gap-2">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: 'rgba(255, 95, 87, 0.35)' }}
            />
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: 'rgba(255, 189, 46, 0.25)' }}
            />
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: 'rgba(39, 201, 63, 0.25)' }}
            />
          </div>
          <div className="flex-1 flex justify-center">
            <div
              className="px-5 py-1 rounded-md text-[10px] text-text-muted/40 font-mono flex items-center gap-2"
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
              }}
            >
              <svg
                className="w-2.5 h-2.5 opacity-30"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              app.example.com/dashboard
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[9px] font-mono text-text-muted/40">
            <span className="w-1.5 h-1.5 rounded-full bg-[#2BD46B]/60 animate-pulse" />
            live
          </div>
        </div>

        {/* Command bar */}
        <div className="px-4 pt-3 pb-2">
          <button
            type="button"
            onClick={() => {
              if (phase === 'rearranged') replay();
            }}
            className="w-full px-3 py-2.5 md:px-4 md:py-3 rounded-xl font-mono text-xs md:text-sm flex items-center gap-2.5 md:gap-3 cursor-pointer transition-all duration-300 focus:outline-none"
            style={{
              background: 'rgba(10, 30, 53, 0.6)',
              border: `1px solid rgba(0, 145, 255, ${phase === 'typing' || phase === 'processing' ? '0.15' : '0.06'})`,
              boxShadow:
                phase === 'typing' || phase === 'processing'
                  ? 'inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 0 20px rgba(0, 145, 255, 0.05)'
                  : 'inset 0 1px 0 rgba(255, 255, 255, 0.03)',
              color: 'var(--color-text)',
              transition: 'border-color 0.3s, box-shadow 0.3s',
            }}
          >
            {/* Mic icon */}
            <svg
              className={`w-4 h-4 shrink-0 transition-colors duration-300 ${phase === 'typing' ? 'text-[#0091FF]/60' : 'text-[#0091FF]/25'}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
            </svg>

            {typedText ? (
              <span className="flex-1 min-w-0 truncate">
                {typedText}
                {phase === 'typing' && (
                  <span className="ml-0.5 text-[#0091FF] animate-blink-cursor">
                    |
                  </span>
                )}
              </span>
            ) : (
              <span className="text-text-muted/25 flex-1">
                Talk to your interface...
              </span>
            )}

            {isProcessing && (
              <span className="shrink-0">
                <span className="inline-block w-4 h-4 border-2 border-[#0091FF]/40 border-t-transparent rounded-full animate-spin" />
              </span>
            )}
          </button>
        </div>

        {/* Dashboard area */}
        <div className="relative px-4 pb-4" style={{ aspectRatio: '3 / 2' }}>
          {isProcessing && (
            <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="absolute rounded-full border border-[#0091FF]/10"
                  style={{
                    width: `${60 + i * 40}px`,
                    height: `${60 + i * 40}px`,
                    animation: 'ripple-expand 2s ease-out infinite',
                    animationDelay: `${i * 0.4}s`,
                  }}
                />
              ))}
              <div className="absolute w-2.5 h-2.5 rounded-full bg-[#0091FF]/25 animate-pulse" />
            </div>
          )}

          <Chart style={{ backgroundColor: 'transparent' }} />
        </div>
      </div>

      {/* AI Rationale */}
      <div
        className="mt-5 px-5 py-4 rounded-xl transition-all duration-500"
        style={{
          background: showRationale ? 'rgba(10, 30, 53, 0.5)' : 'transparent',
          border: showRationale
            ? '1px solid rgba(0, 145, 255, 0.1)'
            : '1px solid transparent',
          boxShadow: showRationale
            ? '0 0 40px rgba(0, 145, 255, 0.04)'
            : 'none',
          opacity: showRationale ? 1 : 0,
          transform: showRationale ? 'translateY(0)' : 'translateY(4px)',
          visibility: showRationale
            ? ('visible' as const)
            : ('hidden' as const),
        }}
      >
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5">
            <div
              className="w-5 h-5 rounded-md flex items-center justify-center"
              style={{
                background: 'rgba(0, 145, 255, 0.1)',
                border: '1px solid rgba(0, 145, 255, 0.2)',
              }}
            >
              <svg
                className="w-3 h-3 text-[#0091FF]/80"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 2a4 4 0 0 1 4 4c0 1.95-1.4 3.58-3.25 3.93V12h2.5a2.75 2.75 0 0 1 2.75 2.75v1.5A2.75 2.75 0 0 1 15.25 19H12v3" />
                <path d="M8.75 19A2.75 2.75 0 0 1 6 16.25v-1.5A2.75 2.75 0 0 1 8.75 12h2.5V9.93A4.001 4.001 0 0 1 8 6a4 4 0 0 1 4-4" />
              </svg>
            </div>
          </div>
          <p className="text-xs text-text-muted font-mono leading-relaxed">
            <span className="text-[#0091FF]/70 mr-1">reasoning</span>
            {rationale ?? ' '}
          </p>
        </div>
      </div>

      {/* Replay */}
      <div
        className="mt-4 text-center transition-all duration-300"
        style={{
          opacity: phase === 'rearranged' ? 1 : 0,
          transform: phase === 'rearranged' ? 'translateY(0)' : 'translateY(4px)',
          visibility:
            phase === 'rearranged' ? ('visible' as const) : ('hidden' as const),
        }}
      >
        <button
          type="button"
          onClick={replay}
          className="text-sm text-text-muted/60 hover:text-[#0091FF] transition-colors duration-300 cursor-pointer font-mono"
        >
          ↻ Replay demo
        </button>
      </div>
    </div>
  );
}

// ── Entry Point (Astro island) ──────────────────────────────────────

export default function LiveDemo() {
  return (
    <MaelstromDemo
      m={m}
      createConnector={() => new DemoConnector()}
      initialIntent="show dashboard"
      script={SCRIPT}
    >
      {(state) => <DemoChrome {...state} />}
    </MaelstromDemo>
  );
}
