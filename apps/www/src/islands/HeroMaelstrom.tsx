import { useEffect, useRef, useCallback } from 'react';

// ── Types ───────────────────────────────────────────────────────────────

interface Particle {
  angle: number;
  radius: number;
  angularSpeed: number;
  inwardSpeed: number;
  size: number;
  opacity: number;
  color: string;
  trail: { x: number; y: number }[];
  maxTrail: number;
}

interface CurrentLine {
  startAngle: number;
  startRadius: number;
  angularSpeed: number;
  opacity: number;
  width: number;
  length: number; // how many spiral revolutions
}

// ── Constants ───────────────────────────────────────────────────────────

const COLORS = [
  '0, 240, 255', // cyan
  '0, 102, 255', // blue
  '107, 0, 255', // violet
  '0, 255, 163', // seafoam
  '0, 200, 255', // light blue
];

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

// ── Component ───────────────────────────────────────────────────────────

export default function HeroMaelstrom() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0.6, y: 0.45 });
  const mouseTargetRef = useRef({ x: 0.6, y: 0.45 });
  const animRef = useRef<number>(0);

  const init = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isMobile = window.innerWidth < 768;
    const dpr = window.devicePixelRatio || 1;

    function resize() {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    }
    resize();

    // ── State ─────────────────────────────────────────────────

    const particleCount = isMobile ? 80 : 180;

    // Particles spiral inward — the lifeblood of the maelstrom
    function spawnParticle(scatterInit = false): Particle {
      const maxR = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.55;
      return {
        angle: rand(0, Math.PI * 2),
        radius: scatterInit ? rand(30, maxR) : rand(maxR * 0.7, maxR),
        angularSpeed: rand(0.001, 0.003),
        inwardSpeed: rand(0.02, 0.07),
        size: rand(0.8, 2.5),
        opacity: rand(0.25, 0.75),
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        trail: [],
        maxTrail: isMobile ? 6 : 14,
      };
    }

    const particles: Particle[] = Array.from({ length: particleCount }, () =>
      spawnParticle(true),
    );

    // Current lines — visible spiral arms of the whirlpool
    const armCount = isMobile ? 4 : 7;
    const currentLines: CurrentLine[] = Array.from(
      { length: armCount },
      (_, i) => ({
        startAngle: (i / armCount) * Math.PI * 2,
        startRadius: rand(250, 450),
        angularSpeed: rand(0.0004, 0.001),
        opacity: rand(0.02, 0.045),
        width: rand(0.8, 1.8),
        length: rand(2.5, 4), // spiral revolutions
      }),
    );

    // ── Draw loop ─────────────────────────────────────────────

    let time = 0;

    function draw() {
      time += 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const maxR = Math.min(w, h) * 0.55;

      // Lerp mouse toward target for smooth, delayed follow
      const lerp = 0.03;
      mouseRef.current = {
        x:
          mouseRef.current.x +
          (mouseTargetRef.current.x - mouseRef.current.x) * lerp,
        y:
          mouseRef.current.y +
          (mouseTargetRef.current.y - mouseRef.current.y) * lerp,
      };

      // Vortex center — slightly right of center, mouse-influenced
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const cx = w * (0.58 + (mx - 0.5) * 0.04);
      const cy = h * (0.46 + (my - 0.5) * 0.04);

      ctx!.clearRect(0, 0, canvas.width, canvas.height);
      ctx!.save();
      ctx!.scale(dpr, dpr);

      const t = time * 0.001;

      // ── Layer 1: Spiral current lines ───────────────────────
      // These are the visible "arms" of the whirlpool
      for (const cl of currentLines) {
        const baseAngle = cl.startAngle + t * cl.angularSpeed * 60;
        const steps = 120;

        ctx!.beginPath();
        for (let s = 0; s <= steps; s++) {
          const frac = s / steps;
          // Spiral: radius decreases, angle increases (Archimedean spiral)
          const r = cl.startRadius * (1 - frac * 0.85);
          const spiralAngle = baseAngle + frac * Math.PI * 2 * cl.length;

          // Add organic wobble
          const wobble = Math.sin(frac * 12 + t * 0.6) * 3 * (1 - frac);

          const px = cx + Math.cos(spiralAngle) * (r + wobble);
          const py = cy + Math.sin(spiralAngle) * (r + wobble);

          if (s === 0) ctx!.moveTo(px, py);
          else ctx!.lineTo(px, py);
        }

        // Fade out toward center and edges
        ctx!.strokeStyle = `rgba(0, 200, 255, ${cl.opacity})`;
        ctx!.lineWidth = cl.width;
        ctx!.stroke();

        // Draw a second arm slightly offset for depth
        ctx!.beginPath();
        for (let s = 0; s <= steps; s++) {
          const frac = s / steps;
          const r = cl.startRadius * (1 - frac * 0.85) + 8;
          const spiralAngle = baseAngle + 0.15 + frac * Math.PI * 2 * cl.length;
          const wobble = Math.sin(frac * 10 + t * 0.5 + 1) * 2 * (1 - frac);
          const px = cx + Math.cos(spiralAngle) * (r + wobble);
          const py = cy + Math.sin(spiralAngle) * (r + wobble);
          if (s === 0) ctx!.moveTo(px, py);
          else ctx!.lineTo(px, py);
        }
        ctx!.strokeStyle = `rgba(0, 102, 255, ${cl.opacity * 0.5})`;
        ctx!.lineWidth = cl.width * 0.6;
        ctx!.stroke();
      }

      // ── Layer 2: Spiraling particles ────────────────────────
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Angular speed increases as radius decreases (conservation of angular momentum)
        const momentumFactor = 1 + (maxR / Math.max(p.radius, 20)) * 0.1;
        p.angle += p.angularSpeed * momentumFactor;
        p.radius -= p.inwardSpeed;

        // Respawn when consumed by the vortex center
        if (p.radius < 15) {
          particles[i] = spawnParticle(false);
          continue;
        }

        const px = cx + Math.cos(p.angle) * p.radius;
        const py = cy + Math.sin(p.angle) * p.radius;

        // Brightness increases toward center
        const proximityBoost = Math.max(0, 1 - p.radius / maxR);
        const currentOpacity = p.opacity * (0.4 + proximityBoost * 0.6);

        // Trail
        p.trail.push({ x: px, y: py });
        if (p.trail.length > p.maxTrail) p.trail.shift();

        // Draw curved trail
        if (p.trail.length > 2) {
          ctx!.beginPath();
          ctx!.moveTo(p.trail[0].x, p.trail[0].y);
          for (let j = 1; j < p.trail.length; j++) {
            ctx!.lineTo(p.trail[j].x, p.trail[j].y);
          }
          const trailGrad = `rgba(${p.color}, ${currentOpacity * 0.25})`;
          ctx!.strokeStyle = trailGrad;
          ctx!.lineWidth = p.size * 0.6;
          ctx!.stroke();
        }

        // Draw particle
        ctx!.beginPath();
        ctx!.arc(px, py, p.size * (0.8 + proximityBoost * 0.5), 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${p.color}, ${currentOpacity})`;
        ctx!.fill();

        // Glow halo for close particles
        if (proximityBoost > 0.5) {
          const glowR = p.size * 5;
          const glow = ctx!.createRadialGradient(px, py, 0, px, py, glowR);
          glow.addColorStop(0, `rgba(${p.color}, ${proximityBoost * 0.12})`);
          glow.addColorStop(1, 'transparent');
          ctx!.beginPath();
          ctx!.arc(px, py, glowR, 0, Math.PI * 2);
          ctx!.fillStyle = glow;
          ctx!.fill();
        }
      }

      // ── Layer 3: Vortex rings — concentric, rotating ────────
      for (let i = 0; i < 5; i++) {
        const ringR = 25 + i * (maxR * 0.17);
        const wobble = Math.sin(t * 1.2 + i * 1.2) * 3;
        const alpha = 0.03 * (1 - i * 0.15);
        const rotSpeed = 0.0015 * (5 - i); // inner rings spin faster

        // Broken arcs rotating at different speeds
        const arcStart = t * rotSpeed + i * 0.7;
        const arcLen = Math.PI * (1 + Math.sin(t * 2 + i) * 0.3);

        ctx!.beginPath();
        ctx!.arc(cx, cy, ringR + wobble, arcStart, arcStart + arcLen);
        ctx!.strokeStyle = `rgba(0, 240, 255, ${alpha})`;
        ctx!.lineWidth = 0.8;
        ctx!.stroke();

        // Counter arc
        ctx!.beginPath();
        ctx!.arc(
          cx,
          cy,
          ringR + wobble,
          arcStart + Math.PI * 0.8,
          arcStart + Math.PI * 0.8 + arcLen * 0.5,
        );
        ctx!.strokeStyle = `rgba(0, 102, 255, ${alpha * 0.6})`;
        ctx!.lineWidth = 0.6;
        ctx!.stroke();
      }

      // ── Layer 4: The void (dark center with rim glow) ───────
      // The center of a maelstrom is a void — dark, not bright
      const voidR = 20 + Math.sin(t * 1) * 3;

      // Dark center — punch a hole of near-black
      const voidGrad = ctx!.createRadialGradient(cx, cy, 0, cx, cy, voidR * 2);
      voidGrad.addColorStop(0, 'rgba(5, 8, 16, 0.6)');
      voidGrad.addColorStop(0.5, 'rgba(5, 8, 16, 0.3)');
      voidGrad.addColorStop(1, 'transparent');
      ctx!.beginPath();
      ctx!.arc(cx, cy, voidR * 2, 0, Math.PI * 2);
      ctx!.fillStyle = voidGrad;
      ctx!.fill();

      // Rim glow — energy at the edge of the void
      const rimGlow = ctx!.createRadialGradient(
        cx,
        cy,
        voidR * 0.5,
        cx,
        cy,
        voidR * 3,
      );
      rimGlow.addColorStop(0, 'transparent');
      rimGlow.addColorStop(
        0.3,
        `rgba(0, 240, 255, ${0.05 + Math.sin(t * 1.2) * 0.02})`,
      );
      rimGlow.addColorStop(
        0.6,
        `rgba(0, 102, 255, ${0.025 + Math.sin(t * 1) * 0.01})`,
      );
      rimGlow.addColorStop(1, 'transparent');
      ctx!.beginPath();
      ctx!.arc(cx, cy, voidR * 3, 0, Math.PI * 2);
      ctx!.fillStyle = rimGlow;
      ctx!.fill();

      // Tiny bright specks at the rim — matter being consumed
      const speckCount = 8;
      for (let i = 0; i < speckCount; i++) {
        const speckAngle = t * 1.2 + (i / speckCount) * Math.PI * 2;
        const speckR = voidR * (1.2 + Math.sin(t * 1.5 + i * 3) * 0.3);
        const sx = cx + Math.cos(speckAngle) * speckR;
        const sy = cy + Math.sin(speckAngle) * speckR;
        const speckAlpha = 0.3 + Math.sin(t * 1.5 + i * 2) * 0.15;

        ctx!.beginPath();
        ctx!.arc(sx, sy, 1.2, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(0, 240, 255, ${speckAlpha})`;
        ctx!.fill();
      }

      // ── Layer 5: Outer glow / atmosphere ────────────────────
      const outerGlow = ctx!.createRadialGradient(
        cx,
        cy,
        maxR * 0.1,
        cx,
        cy,
        maxR,
      );
      outerGlow.addColorStop(0, 'rgba(0, 240, 255, 0.035)');
      outerGlow.addColorStop(0.3, 'rgba(0, 102, 255, 0.018)');
      outerGlow.addColorStop(0.6, 'rgba(107, 0, 255, 0.008)');
      outerGlow.addColorStop(1, 'transparent');
      ctx!.beginPath();
      ctx!.arc(cx, cy, maxR, 0, Math.PI * 2);
      ctx!.fillStyle = outerGlow;
      ctx!.fill();

      ctx!.restore();
      animRef.current = requestAnimationFrame(draw);
    }

    // ── Events ────────────────────────────────────────────────

    function handleMouseMove(e: MouseEvent) {
      mouseTargetRef.current = {
        x: e.clientX / window.innerWidth,
        y: e.clientY / window.innerHeight,
      };
    }

    function handleMouseLeave() {
      mouseTargetRef.current = { x: 0.6, y: 0.45 };
    }

    window.addEventListener('resize', resize);
    if (!isMobile) {
      window.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseleave', handleMouseLeave);
    }
    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return init(canvas);
  }, [init]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{
        willChange: 'transform',
        background:
          'radial-gradient(ellipse at 60% 50%, rgba(0,102,255,0.08), transparent 70%)',
      }}
      aria-hidden="true"
    />
  );
}
