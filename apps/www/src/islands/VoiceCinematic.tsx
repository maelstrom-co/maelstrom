import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getCurrentKeyframe,
  getCurrentKeyframeIndex,
  lerp,
} from '../lib/keyframe-utils';
import type {
  DashboardKeyframe,
  LayoutSlot,
  OrbState,
  TranscriptLine,
} from './voice-cinematic/data';
import {
  dashboardKeyframes,
  orbKeyframes,
  panelMap,
  transcript,
} from './voice-cinematic/data';

// ── Canvas Orb ──────────────────────────────────────────────────────────

interface Particle {
  angle: number;
  radius: number;
  baseRadius: number;
  speed: number;
  size: number;
  brightness: number;
}

function useCanvasOrb(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  stateRef: React.RefObject<OrbState>,
  progressRef: React.RefObject<number>,
  isInViewRef: React.RefObject<boolean>,
) {
  const particlesRef = useRef<Particle[]>([]);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rawCtx = canvas.getContext('2d');
    if (!rawCtx) return;
    // Bind to an explicitly non-null type so the draw() closure below sees a
    // non-null ctx (control-flow narrowing isn't carried into nested functions).
    const ctx: CanvasRenderingContext2D = rawCtx;

    const isMobile = window.innerWidth < 768;

    // Cap DPR on mobile (iPhone 15 is 3x — reduce to 2x)
    const dpr = isMobile
      ? Math.min(window.devicePixelRatio || 1, 2)
      : window.devicePixelRatio || 1;
    const size = 280;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;

    // Fewer particles on mobile
    const particleCount = isMobile ? 14 : 28;
    if (particlesRef.current.length === 0) {
      particlesRef.current = Array.from({ length: particleCount }, () => ({
        angle: Math.random() * Math.PI * 2,
        radius: 40 + Math.random() * 50,
        baseRadius: 40 + Math.random() * 50,
        speed: 0.003 + Math.random() * 0.008,
        size: 0.8 + Math.random() * 1.5,
        brightness: 0.3 + Math.random() * 0.7,
      }));
    }

    // Fewer blob points on mobile
    const blobPoints = isMobile ? 32 : 64;

    let time = 0;

    function draw() {
      // Skip rendering when not in view
      if (!isInViewRef.current) {
        animFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      const s = stateRef.current;
      const p = progressRef.current;

      time += 0.016;
      ctx.clearRect(0, 0, size, size);

      const isActive = s === 'listening' || s === 'responding';
      const isResponding = s === 'responding';

      const coreAlpha = isResponding ? 0.9 : isActive ? 0.55 : 0.25;
      const coreRadius = isResponding ? 28 : isActive ? 24 : 20;
      const glowRadius = isResponding ? 70 : isActive ? 55 : 40;

      // ── Rings — fewer on mobile, skip second arc segment ──
      const ringConfigs = isMobile
        ? [
            {
              r: 55,
              width: 1.2,
              alpha: isResponding ? 0.25 : isActive ? 0.12 : 0.04,
              speed: 0.3,
            },
            {
              r: 40,
              width: 1.5,
              alpha: isResponding ? 0.35 : isActive ? 0.18 : 0.06,
              speed: -0.2,
            },
          ]
        : [
            {
              r: 65,
              width: 1.2,
              alpha: isResponding ? 0.25 : isActive ? 0.12 : 0.04,
              speed: 0.3,
            },
            {
              r: 50,
              width: 1.5,
              alpha: isResponding ? 0.35 : isActive ? 0.18 : 0.06,
              speed: -0.2,
            },
            {
              r: 35,
              width: 1,
              alpha: isResponding ? 0.3 : isActive ? 0.15 : 0.05,
              speed: 0.15,
            },
          ];

      for (const ring of ringConfigs) {
        const rot = time * ring.speed + p * Math.PI * 2;
        ctx.beginPath();
        const arcLen = Math.PI * (1.2 + Math.sin(time * 0.5) * 0.3);
        ctx.arc(cx, cy, ring.r, rot, rot + arcLen);
        ctx.strokeStyle = `rgba(0, 240, 255, ${ring.alpha})`;
        ctx.lineWidth = ring.width;
        ctx.stroke();

        if (!isMobile) {
          ctx.beginPath();
          ctx.arc(cx, cy, ring.r, rot + Math.PI, rot + Math.PI + arcLen * 0.7);
          ctx.strokeStyle = `rgba(0, 102, 255, ${ring.alpha * 0.7})`;
          ctx.lineWidth = ring.width * 0.8;
          ctx.stroke();
        }
      }

      // ── Ripples — fewer on mobile ─────────────────────
      if (isActive) {
        const rippleCount = isMobile ? 1 : isResponding ? 3 : 2;
        for (let i = 0; i < rippleCount; i++) {
          const ripplePhase = ((time * 0.8 + i * 0.8) % 2.5) / 2.5;
          const rippleR = 25 + ripplePhase * 80;
          const rippleAlpha = (1 - ripplePhase) * (isResponding ? 0.2 : 0.12);
          ctx.beginPath();
          ctx.arc(cx, cy, rippleR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(0, 240, 255, ${rippleAlpha})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // ── Particles — skip radialGradient glow on mobile ─
      const targetParticleR = isResponding ? 0.5 : isActive ? 0.75 : 1;

      for (const particle of particlesRef.current) {
        particle.angle += particle.speed * (isActive ? 1.8 : 1);
        const targetR = particle.baseRadius * targetParticleR;
        particle.radius += (targetR - particle.radius) * 0.02;

        const wobble = Math.sin(time * 2 + particle.angle * 3) * 3;
        const px = cx + Math.cos(particle.angle) * (particle.radius + wobble);
        const py = cy + Math.sin(particle.angle) * (particle.radius + wobble);

        const alpha =
          particle.brightness * (isResponding ? 0.9 : isActive ? 0.6 : 0.3);

        ctx.beginPath();
        ctx.arc(px, py, particle.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 240, 255, ${alpha})`;
        ctx.fill();

        if (!isMobile && alpha > 0.3) {
          const glow = ctx.createRadialGradient(
            px,
            py,
            0,
            px,
            py,
            particle.size * 4,
          );
          glow.addColorStop(0, `rgba(0, 240, 255, ${alpha * 0.3})`);
          glow.addColorStop(1, 'transparent');
          ctx.beginPath();
          ctx.arc(px, py, particle.size * 4, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();
        }
      }

      // ── Core blob — fewer points on mobile ────────────
      ctx.beginPath();
      for (let i = 0; i <= blobPoints; i++) {
        const a = (i / blobPoints) * Math.PI * 2;
        const deform =
          Math.sin(a * 3 + time * 1.5) * 3 +
          Math.sin(a * 5 - time * 0.8) * 1.5 +
          Math.sin(a * 7 + time * 2.2) * (isActive ? 2 : 0.5);
        const r = coreRadius + deform;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      const coreGrad = ctx.createRadialGradient(
        cx - 5,
        cy - 5,
        0,
        cx,
        cy,
        coreRadius + 5,
      );
      coreGrad.addColorStop(0, `rgba(0, 240, 255, ${coreAlpha})`);
      coreGrad.addColorStop(0.5, `rgba(0, 102, 255, ${coreAlpha * 0.7})`);
      coreGrad.addColorStop(1, `rgba(0, 102, 255, 0)`);
      ctx.fillStyle = coreGrad;
      ctx.fill();

      // Core inner highlight — skip on mobile
      if (!isMobile) {
        const highlight = ctx.createRadialGradient(
          cx - 8,
          cy - 8,
          0,
          cx,
          cy,
          coreRadius * 0.6,
        );
        highlight.addColorStop(0, `rgba(255, 255, 255, ${coreAlpha * 0.4})`);
        highlight.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(cx, cy, coreRadius * 0.6, 0, Math.PI * 2);
        ctx.fillStyle = highlight;
        ctx.fill();
      }

      // ── Outer glow ──────────────────────────────────────
      const outerGlow = ctx.createRadialGradient(
        cx,
        cy,
        coreRadius,
        cx,
        cy,
        glowRadius,
      );
      outerGlow.addColorStop(0, `rgba(0, 240, 255, ${coreAlpha * 0.15})`);
      outerGlow.addColorStop(0.5, `rgba(0, 102, 255, ${coreAlpha * 0.05})`);
      outerGlow.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
      ctx.fillStyle = outerGlow;
      ctx.fill();

      animFrameRef.current = requestAnimationFrame(draw);
    }

    animFrameRef.current = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(animFrameRef.current);
  }, [canvasRef, isInViewRef, stateRef, progressRef]);
}

function VoiceOrb({
  stateRef,
  progressRef,
  isInViewRef,
}: {
  stateRef: React.RefObject<OrbState>;
  progressRef: React.RefObject<number>;
  isInViewRef: React.RefObject<boolean>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useCanvasOrb(canvasRef, stateRef, progressRef, isInViewRef);

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: 280, height: 280 }}
    >
      {/* Static ambient glow */}
      <div
        className="absolute rounded-full"
        style={{
          width: 280,
          height: 280,
          background:
            'radial-gradient(circle, rgba(0,240,255,0.06) 0%, transparent 70%)',
          transform: 'scale(2)',
        }}
      />

      <canvas
        ref={canvasRef}
        className="relative z-10"
        style={{
          width: 280,
          height: 280,
          willChange: 'transform',
          background:
            'radial-gradient(circle, rgba(0,240,255,0.05), transparent 70%)',
        }}
      />
    </div>
  );
}

// ── Dashboard Component (absolute positioning with morphing) ────────────

function DashboardMockup({
  currentKeyframe,
}: {
  currentKeyframe: DashboardKeyframe;
}) {
  const prevLayoutRef = useRef<DashboardKeyframe>(currentKeyframe);
  const [displayLayout, setDisplayLayout] = useState(currentKeyframe);

  useEffect(() => {
    if (currentKeyframe.at !== prevLayoutRef.current.at) {
      prevLayoutRef.current = currentKeyframe;
      setDisplayLayout(currentKeyframe);
    }
  }, [currentKeyframe]);

  const activeIds = new Set(displayLayout.layout.map((s) => s.id));

  const prevIdsRef = useRef<Set<string>>(activeIds);
  const [exitingPanels, setExitingPanels] = useState<LayoutSlot[]>([]);

  useEffect(() => {
    const prev = prevIdsRef.current;
    const exiting: LayoutSlot[] = [];
    for (const id of prev) {
      if (!activeIds.has(id)) {
        const slot = prevLayoutRef.current.layout.find((s) => s.id === id);
        if (slot) exiting.push(slot);
      }
    }
    setExitingPanels(exiting);
    prevIdsRef.current = new Set(activeIds);

    if (exiting.length > 0) {
      const t = setTimeout(() => setExitingPanels([]), 800);
      return () => clearTimeout(t);
    }
  }, [displayLayout]);

  const containerW = 100; // percentage
  // One-time check instead of resize listener
  const [containerH] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 190 : 240,
  );

  return (
    <div
      className="rounded-2xl overflow-hidden w-full"
      style={{
        background: 'rgba(10, 30, 53, 0.75)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow:
          '0 8px 40px rgba(0, 0, 0, 0.4), 0 0 60px rgba(0, 240, 255, 0.04)',
      }}
    >
      {/* Title bar */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-white/[0.04]">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-white/[0.08]" />
          <div className="w-2.5 h-2.5 rounded-full bg-white/[0.08]" />
          <div className="w-2.5 h-2.5 rounded-full bg-white/[0.08]" />
        </div>
        <div className="text-[11px] font-mono text-text-muted/50 tracking-wider uppercase ml-3 transition-all duration-500">
          {displayLayout.label}
        </div>
      </div>

      {/* Panel area — absolute positioning for morphing */}
      <div className="relative p-3 md:p-4" style={{ height: containerH + 24 }}>
        {/* Active panels */}
        {displayLayout.layout.map((slot) => {
          const panel = panelMap.get(slot.id);
          if (!panel) return null;

          return (
            <div
              key={slot.id}
              className="absolute rounded-xl p-2.5 md:p-4 transition-all duration-[800ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                left: `calc(${slot.x * containerW}% + 12px)`,
                top: `calc(${slot.y * containerH}px + 12px)`,
                width: `calc(${slot.w * containerW}% - ${slot.w < 1 ? 6 : 0}px)`,
                height: slot.h * containerH,
                background: `${panel.color}18`,
                borderLeft: `3px solid ${panel.color}60`,
                boxShadow: `inset 0 0 40px ${panel.color}0a, 0 0 20px ${panel.color}08`,
              }}
            >
              <div
                className="text-[10px] md:text-xs font-mono mb-1.5 md:mb-2 tracking-wide font-medium truncate"
                style={{ color: `${panel.color}dd` }}
              >
                {panel.name}
              </div>
              <div className="space-y-2">
                <div
                  className="h-1.5 rounded-full"
                  style={{ background: `${panel.color}25`, width: '80%' }}
                />
                <div
                  className="h-1.5 rounded-full"
                  style={{ background: `${panel.color}1a`, width: '60%' }}
                />
                <div
                  className="h-1.5 rounded-full"
                  style={{ background: `${panel.color}12`, width: '45%' }}
                />
              </div>
            </div>
          );
        })}

        {/* Exiting panels — fade out */}
        {exitingPanels.map((slot) => {
          const panel = panelMap.get(slot.id);
          if (!panel) return null;

          return (
            <div
              key={`exit-${slot.id}`}
              className="absolute rounded-xl p-2.5 md:p-4 transition-all duration-[600ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                left: `calc(${slot.x * containerW}% + 12px)`,
                top: `calc(${slot.y * containerH}px + 12px)`,
                width: `calc(${slot.w * containerW}% - ${slot.w < 1 ? 6 : 0}px)`,
                height: slot.h * containerH,
                background: `${panel.color}0a`,
                borderLeft: `3px solid ${panel.color}40`,
                opacity: 0,
                transform: 'scale(0.92)',
                pointerEvents: 'none' as const,
              }}
            >
              <div
                className="text-[11px] font-mono mb-2 tracking-wide"
                style={{ color: `${panel.color}bb` }}
              >
                {panel.name}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Transcript Component (cinematic subtitles) ──────────────────────────

function Transcript({ visibleLines }: { visibleLines: TranscriptLine[] }) {
  const displayLines = visibleLines.slice(-3);
  const hiddenCount = visibleLines.length - displayLines.length;

  return (
    <div className="text-center min-h-[140px] flex flex-col justify-center gap-4">
      {displayLines.map((line, i) => {
        const globalIndex = hiddenCount + i;
        const isLatest = i === displayLines.length - 1;
        const isOldest = i === 0 && displayLines.length === 3;

        return (
          <div
            key={globalIndex}
            className="transition-all duration-500"
            style={{
              opacity: isOldest ? 0.3 : isLatest ? 1 : 0.7,
              transform: isOldest ? 'translateY(-4px) scale(0.95)' : undefined,
              animation: isLatest
                ? 'transcript-appear 0.7s cubic-bezier(0.22, 1, 0.36, 1)'
                : undefined,
            }}
          >
            {line.speaker !== 'system' && (
              <span
                className="text-xs font-mono tracking-wider uppercase mb-1 block"
                style={{
                  color:
                    line.speaker === 'doctor'
                      ? 'rgba(200, 210, 230, 0.4)'
                      : 'rgba(200, 210, 230, 0.25)',
                }}
              >
                {line.speaker === 'doctor' ? 'Dr. Reyes' : 'Patient'}
              </span>
            )}
            <p
              className={
                line.speaker === 'system'
                  ? 'font-mono text-base md:text-lg text-cyan/80 tracking-wide'
                  : 'text-lg md:text-xl lg:text-2xl leading-relaxed italic text-text/80'
              }
              style={
                line.speaker === 'system'
                  ? { textShadow: '0 0 20px rgba(0, 240, 255, 0.3)' }
                  : undefined
              }
            >
              {line.text}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────

export default function VoiceCinematic() {
  // ── Scroll-driven state (refs — no re-renders) ────────
  const containerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(0);
  const isInViewRef = useRef(false);
  const orbStateRef = useRef<OrbState>('idle');
  const cachedHeightRef = useRef(0);

  // ── React state (only for discrete keyframe changes) ──
  const [dashKfIndex, setDashKfIndex] = useState(0);
  const [visibleLines, setVisibleLines] = useState<TranscriptLine[]>([]);
  const prevDashKfIndexRef = useRef(0);
  const prevVisibleCountRef = useRef(0);

  // ── DOM refs for direct style manipulation ────────────
  const overlayRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const orbWrapRef = useRef<HTMLDivElement>(null);
  const dashWrapRef = useRef<HTMLDivElement>(null);
  const transcriptWrapRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const starsRef = useRef<HTMLDivElement>(null);
  const glow1Ref = useRef<HTMLDivElement>(null);
  const glow2Ref = useRef<HTMLDivElement>(null);
  const glow3Ref = useRef<HTMLDivElement>(null);
  const causticRef = useRef<HTMLDivElement>(null);

  // ── Cache container height on resize ──────────────────
  useEffect(() => {
    const updateCache = () => {
      const container = containerRef.current;
      if (container) {
        cachedHeightRef.current = container.offsetHeight - window.innerHeight;
      }
    };
    updateCache();
    window.addEventListener('resize', updateCache);
    return () => window.removeEventListener('resize', updateCache);
  }, []);

  // ── Scroll handler — direct DOM manipulation ──────────
  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const scrollableHeight = cachedHeightRef.current;
    if (scrollableHeight <= 0) return;

    const inView =
      rect.top <= window.innerHeight * 0.5 && rect.bottom >= window.innerHeight;
    const scrolled = -rect.top;
    const p = Math.max(-0.12, Math.min(1, scrolled / scrollableHeight));

    isInViewRef.current = inView;
    progressRef.current = p;
    orbStateRef.current = getCurrentKeyframe(orbKeyframes, p).state;

    // Toggle overlay visibility without React re-render
    if (overlayRef.current) {
      overlayRef.current.style.display = inView ? '' : 'none';
    }

    if (!inView) return;

    // ── Compute derived values ────────────────────────
    const orbOpacity = p < 0.08 ? p / 0.08 : p > 0.92 ? (1 - p) / 0.08 : 1;
    const orbScale =
      p < 0.08
        ? 0.6 + (p / 0.08) * 0.4
        : p > 0.92
          ? 1 - ((p - 0.92) / 0.08) * 0.4
          : 1;
    const dashOpacity =
      p < 0.02
        ? 0
        : p < 0.12
          ? (p - 0.02) / 0.1
          : p > 0.96
            ? 0
            : p > 0.88
              ? (0.96 - p) / 0.08
              : 1;
    const transcriptOpacity =
      p < 0.04
        ? 0
        : p < 0.12
          ? (p - 0.04) / 0.08
          : p > 0.92
            ? 0
            : p > 0.86
              ? (0.92 - p) / 0.06
              : 1;
    const headerOpacity =
      p < -0.04
        ? Math.max(0, (p + 0.12) / 0.08)
        : p < 0.1
          ? 1
          : Math.max(0, 1 - (p - 0.1) / 0.06);
    const bgOpacity =
      p < -0.04
        ? Math.max(0, (p + 0.12) / 0.08)
        : p < 0.02
          ? lerp(0.6, 1, (p + 0.04) / 0.06)
          : p > 0.94
            ? (1 - p) / 0.06
            : 1;
    const glowOffset = p * 30;

    // ── Apply to DOM directly ─────────────────────────
    if (overlayRef.current)
      overlayRef.current.style.opacity = String(Math.max(0, bgOpacity));
    if (headerRef.current)
      headerRef.current.style.opacity = String(headerOpacity);
    if (orbWrapRef.current) {
      orbWrapRef.current.style.opacity = String(orbOpacity);
      orbWrapRef.current.style.transform = `scale(${orbScale})`;
    }
    if (dashWrapRef.current)
      dashWrapRef.current.style.opacity = String(dashOpacity);
    if (transcriptWrapRef.current)
      transcriptWrapRef.current.style.opacity = String(transcriptOpacity);
    if (progressBarRef.current)
      progressBarRef.current.style.width = `${Math.max(0, p) * 100}%`;

    // Stars parallax (no CSS transition — scroll handler provides smooth updates)
    if (starsRef.current)
      starsRef.current.style.transform = `translateY(${glowOffset * 0.5}px)`;

    // Desktop glow blobs — animate via transform only
    if (glow1Ref.current)
      glow1Ref.current.style.transform = `translate3d(${glowOffset * 0.6}px, ${glowOffset * 0.9}px, 0)`;
    if (glow2Ref.current)
      glow2Ref.current.style.transform = `translate3d(${-glowOffset * 0.3}px, ${-glowOffset * 0.6}px, 0)`;
    if (glow3Ref.current)
      glow3Ref.current.style.transform = `translate3d(0, ${glowOffset * 0.45}px, 0)`;

    // Caustic opacity
    if (causticRef.current) {
      causticRef.current.style.opacity =
        orbStateRef.current === 'responding' ? '0.8' : '0.3';
    }

    // ── Discrete updates (React re-render only at keyframe thresholds) ──
    const newDashKfIndex = getCurrentKeyframeIndex(dashboardKeyframes, p);
    if (newDashKfIndex !== prevDashKfIndexRef.current) {
      prevDashKfIndexRef.current = newDashKfIndex;
      setDashKfIndex(newDashKfIndex);
    }

    const newVisibleLines = transcript.filter((l) => p >= l.at);
    if (newVisibleLines.length !== prevVisibleCountRef.current) {
      prevVisibleCountRef.current = newVisibleLines.length;
      setVisibleLines(newVisibleLines);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const dashboardKf = dashboardKeyframes[dashKfIndex];

  return (
    <div
      ref={containerRef}
      className="relative h-[320vh] md:h-[400vh]"
      style={{
        background:
          'linear-gradient(to bottom, var(--color-ocean) 0%, var(--color-deep) 20%, var(--color-deep) 80%, var(--color-ocean) 100%)',
      }}
    >
      {/* Always rendered — visibility toggled via ref (no mount/unmount churn) */}
      <div
        ref={overlayRef}
        className="fixed inset-0 z-30"
        style={{ display: 'none', opacity: 0 }}
      >
        {/* ── Background atmosphere ──────────────────────────── */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to bottom, var(--color-ocean) 0%, #0a1630 20%, var(--color-deep) 50%, #0a1630 80%, var(--color-ocean) 100%)',
          }}
        />

        {/* Stars */}
        <div
          ref={starsRef}
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `
              radial-gradient(1px 1px at 10% 15%, white, transparent),
              radial-gradient(1.5px 1.5px at 25% 35%, white, transparent),
              radial-gradient(1px 1px at 40% 10%, rgba(255,255,255,0.8), transparent),
              radial-gradient(1.5px 1.5px at 55% 45%, white, transparent),
              radial-gradient(1px 1px at 70% 20%, rgba(255,255,255,0.7), transparent),
              radial-gradient(1px 1px at 85% 40%, white, transparent),
              radial-gradient(1.5px 1.5px at 15% 60%, rgba(255,255,255,0.9), transparent),
              radial-gradient(1px 1px at 35% 75%, white, transparent),
              radial-gradient(2px 2px at 60% 15%, rgba(200,220,255,0.8), transparent),
              radial-gradient(1px 1px at 80% 60%, rgba(255,255,255,0.8), transparent)
            `,
            opacity: 0.6,
          }}
        />

        {/* Ambient glow — mobile: static radial gradients (no blur filter) */}
        <div
          className="absolute inset-0 pointer-events-none md:hidden"
          style={{
            background: `
              radial-gradient(600px 600px at 15% 25%, rgba(0, 240, 255, 0.02), transparent 70%),
              radial-gradient(500px 500px at 85% 50%, rgba(107, 0, 255, 0.015), transparent 70%),
              radial-gradient(400px 400px at 40% 80%, rgba(0, 102, 255, 0.015), transparent 70%)
            `,
          }}
        />
        {/* Ambient glow — desktop: blur blobs with transform animation */}
        <div className="absolute inset-0 pointer-events-none hidden md:block">
          <div
            ref={glow1Ref}
            className="absolute w-[600px] h-[600px] rounded-full blur-[160px]"
            style={{
              background: 'rgba(0, 240, 255, 0.025)',
              top: '20%',
              left: '5%',
              willChange: 'transform',
            }}
          />
          <div
            ref={glow2Ref}
            className="absolute w-[500px] h-[500px] rounded-full blur-[140px]"
            style={{
              background: 'rgba(107, 0, 255, 0.02)',
              top: '50%',
              right: '10%',
              willChange: 'transform',
            }}
          />
          <div
            ref={glow3Ref}
            className="absolute w-[400px] h-[400px] rounded-full blur-[120px]"
            style={{
              background: 'rgba(0, 102, 255, 0.02)',
              bottom: '20%',
              left: '40%',
              willChange: 'transform',
            }}
          />
        </div>

        {/* Caustic-like light behind dashboard area */}
        <div
          ref={causticRef}
          className="absolute pointer-events-none"
          style={{
            top: '25%',
            right: '5%',
            width: '50%',
            height: '40%',
            background:
              'radial-gradient(ellipse at 50% 50%, rgba(0, 240, 255, 0.02), transparent 70%)',
            opacity: 0.3,
            transition: 'opacity 1s ease',
          }}
        />

        {/* ── Content layer ─────────────────────────────────── */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-3 md:px-6">
          {/* Section header */}
          <div
            ref={headerRef}
            className="absolute top-20 md:top-32 lg:top-36 left-1/2 -translate-x-1/2 text-center z-10 w-full px-6"
            style={{ opacity: 0 }}
          >
            <p className="section-kicker mb-3">Voice Interface</p>
            <h2 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold text-text">
              It Listens. It Understands.
            </h2>
          </div>

          {/* Main content */}
          <div className="w-full max-w-6xl mx-auto flex flex-col lg:flex-row items-center gap-2 md:gap-8 lg:gap-16">
            {/* Orb */}
            <div
              ref={orbWrapRef}
              className="flex-shrink-0 flex items-center justify-center lg:w-1/3 scale-75 md:scale-100"
              style={{ opacity: 0 }}
            >
              <VoiceOrb
                stateRef={orbStateRef}
                progressRef={progressRef}
                isInViewRef={isInViewRef}
              />
            </div>

            {/* Dashboard */}
            <div
              ref={dashWrapRef}
              className="w-full min-w-0 lg:flex-1 lg:w-2/3"
              style={{ opacity: 0 }}
            >
              <DashboardMockup currentKeyframe={dashboardKf} />
            </div>
          </div>

          {/* Transcript */}
          <div
            ref={transcriptWrapRef}
            className="w-full max-w-2xl mx-auto mt-4 md:mt-8 lg:mt-12"
            style={{ opacity: 0 }}
          >
            <Transcript visibleLines={visibleLines} />
          </div>

          {/* Progress indicator */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
            <div className="w-16 h-0.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                ref={progressBarRef}
                className="h-full rounded-full"
                style={{
                  width: '0%',
                  background:
                    'linear-gradient(to right, rgba(0,240,255,0.3), rgba(0,102,255,0.5))',
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
