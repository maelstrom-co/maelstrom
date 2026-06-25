import { useEffect, useReducer, useState } from 'react';
import './diagram.css';
import { NodeLayer } from './NodeLayer';
import { EdgeLayer } from './EdgeLayer';
import { BeatDetail } from './BeatDetail';
import { LoopController } from './LoopController';
import { nodeById } from './nodes';
import { STAGE, BANDS, FRAMING, cameraTransform } from './stage';
import { STEPS, initialLoopState, loopReducer, stepCaption } from './loop-machine';

// Dwell per beat while auto-playing. The camera pan (diagram.css, ~1s) eats the
// first second, so this is set well above it to leave a stable reading window
// for the subtitle and detail chips before the next beat.
const AUTO_ADVANCE_MS = 3600;

function Bands() {
  return (
    <g className="arch-bands" aria-hidden="true">
      {BANDS.map((band) => (
        <g key={band.zone} className={`arch-band arch-band--${band.zone}`}>
          <rect
            className="arch-band__fill"
            x={band.x}
            y={0}
            width={band.width}
            height={STAGE.h}
          />
          <text className="arch-band__label" x={band.x + 18} y={42}>
            {band.label}
          </text>
        </g>
      ))}
    </g>
  );
}

export default function ArchitectureDiagram() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loop, dispatch] = useReducer(loopReducer, initialLoopState);
  const [hydrated, setHydrated] = useState(false);
  const [showDetail, setShowDetail] = useState(true);

  useEffect(() => setHydrated(true), []);

  // Auto-advance while playing. Motion is treated as content (the flowing beams
  // and camera ARE the explanation), so it is not gated on reduced-motion.
  useEffect(() => {
    if (!loop.playing) return;
    const id = setInterval(() => dispatch({ type: 'tick' }), AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [loop.playing]);

  const activeNode = activeId ? (nodeById(activeId) ?? null) : null;
  const currentStep = STEPS[loop.index];
  // While the loop plays, the panel narrates the beat; paused, it yields to the
  // package the reader is exploring.
  const detailNode = loop.playing ? null : activeNode;

  // The browser-side cluster (react/demo) is only relevant when the camera is
  // wide; hide it while the camera is focused elsewhere in the round-trip.
  const showCluster =
    currentStep === 'intent' ||
    currentStep === 'observe' ||
    currentStep === 'loop';

  return (
    <div
      className={`arch${hydrated ? ' arch--hydrated' : ''}${showCluster ? '' : ' arch--cluster-hidden'}`}
      data-step={currentStep}
    >
      <div className="arch-stage">
        <svg
          className="arch-canvas"
          viewBox={`0 0 ${STAGE.w} ${STAGE.h}`}
          role="img"
          aria-label="Maelstrom runtime: a request travels from the browser client through the protocol contract to the server engine, and the response returns."
        >
          <g className="arch-camera" style={{ transform: cameraTransform(FRAMING[currentStep]) }}>
            <Bands />
            <EdgeLayer currentStep={currentStep} />
            <NodeLayer
              activeId={activeId}
              onActivate={(id) => setActiveId((prev) => (prev === id ? prev : id))}
            />
          </g>
        </svg>
        <p className="arch-subtitle" aria-live="polite">
          {stepCaption(currentStep)}
        </p>
      </div>

      <LoopController
        state={loop}
        dispatch={dispatch}
        showDetail={showDetail}
        onToggleDetail={() => setShowDetail((v) => !v)}
      />
      <BeatDetail node={detailNode} step={currentStep} showDetail={showDetail} />

      {/* Always rendered: the no-JS source of truth for the runtime loop. Visible
          to assistive tech and crawlers; hidden once the live diagram hydrates. */}
      <ol className="arch-fallback">
        {STEPS.map((step) => (
          <li key={step}>{stepCaption(step)}</li>
        ))}
      </ol>
    </div>
  );
}
