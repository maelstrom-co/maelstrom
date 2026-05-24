import { type DemoRenderState, MaelstromDemo } from '../shared/MaelstromDemo';
import { useIsMobile } from '../shared/useIsMobile';
import { createHeroConnector, HERO_SCRIPT } from './connector';
import { mHero } from './maelstrom';

// Fixed chart height on every breakpoint — a real app gives the engine a bounded
// space and lets it fit vessels in; it doesn't grow the page to fit them. Each
// breakpoint's layouts are authored to show only what fits this box (desktop
// tiles in 2D, mobile shows ≤2 stacked cards).
const CHART_PX = 520;
const CHART_PAD_PX = 14;

// Browser-framed hero chrome (reuses the .hero-dash styles); playback state
// comes from MaelstromDemo and the real mHero.Chart renders the layout.
function HeroChrome({ typedText, phase, Chart }: DemoRenderState) {
  return (
    <div className="hero-dash" aria-hidden="true">
      <div className="hero-dash-bar">
        <div className="dot r" />
        <div className="dot y" />
        <div className="dot g" />
        <div className="hero-prompt">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
          </svg>
          <span className="hero-prompt-text">
            <span>{typedText}</span>
            {phase === 'typing' && <span className="caret" />}
          </span>
        </div>
        <span className="live-pill">
          <span className="live-dot" />
          LIVE
        </span>
      </div>
      <div
        style={{
          position: 'relative',
          height: CHART_PX,
          padding: CHART_PAD_PX,
        }}
      >
        <Chart style={{ backgroundColor: 'transparent' }} />
      </div>
    </div>
  );
}

export default function HeroDemo() {
  const isMobile = useIsMobile();
  return (
    <MaelstromDemo
      // Remount when crossing the breakpoint so the connector emits the
      // matching (tiled vs single-column) layouts immediately.
      key={isMobile ? 'mobile' : 'desktop'}
      m={mHero}
      createConnector={() => createHeroConnector(isMobile)}
      initialIntent="show dashboard"
      script={HERO_SCRIPT}
    >
      {(state) => <HeroChrome {...state} />}
    </MaelstromDemo>
  );
}
