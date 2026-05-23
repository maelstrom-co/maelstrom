import { useEffect, useRef, useCallback } from 'react';

interface VesselShape {
  angle: number;
  radius: number;
  speed: number;
  width: number;
  height: number;
}

function createVessels(count: number): VesselShape[] {
  return Array.from({ length: count }, () => ({
    angle: Math.random() * Math.PI * 2,
    radius: 80 + Math.random() * 160,
    speed: 0.0008 + Math.random() * 0.0015,
    width: 16 + Math.random() * 18,
    height: 10 + Math.random() * 12,
  }));
}

export default function HeroVortexWhirlpool() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const animationRef = useRef<number>(0);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, vessels: VesselShape[], time: number) => {
      const w = ctx.canvas.clientWidth;
      const h = ctx.canvas.clientHeight;
      const cx = w * (0.5 + (mouseRef.current.x - 0.5) * 0.03);
      const cy = h * (0.4 + (mouseRef.current.y - 0.5) * 0.03);
      const isMobileSize = w < 500;
      const maxRadius = Math.min(w, h) * (isMobileSize ? 0.35 : 0.5);
      const t = time * 0.001;

      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.scale(dpr, dpr);

      // --- Core glow ---
      const coreGrad = ctx.createRadialGradient(
        cx,
        cy,
        0,
        cx,
        cy,
        maxRadius * 0.7,
      );
      coreGrad.addColorStop(0, 'rgba(0, 240, 255, 0.25)');
      coreGrad.addColorStop(0.2, 'rgba(0, 200, 255, 0.12)');
      coreGrad.addColorStop(0.5, 'rgba(0, 102, 255, 0.06)');
      coreGrad.addColorStop(0.8, 'rgba(107, 0, 255, 0.02)');
      coreGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = coreGrad;
      ctx.fillRect(0, 0, w, h);

      // --- Spiral arms (the whirlpool) ---
      const armCount = 5;
      for (let arm = 0; arm < armCount; arm++) {
        const armOffset = (arm / armCount) * Math.PI * 2;
        const armOpacity = 0.12 + (arm % 2) * 0.06;

        ctx.beginPath();
        for (let i = 0; i < 200; i++) {
          const frac = i / 200;
          const r = 12 + frac * maxRadius;
          const spiralTightness = 3.5;
          const angle =
            armOffset + frac * Math.PI * 2 * spiralTightness + t * 0.15;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(0, 200, 255, ${armOpacity})`;
        ctx.lineWidth = 1.5 - (arm % 2) * 0.5;
        ctx.stroke();
      }

      // --- Concentric ripple rings ---
      for (let i = 0; i < 6; i++) {
        const ringR = 20 + i * (maxRadius / 6);
        const wobble = Math.sin(t * 0.6 + i * 0.8) * 3;
        const alpha = 0.06 * (1 - i / 6);
        ctx.beginPath();
        ctx.arc(cx, cy, ringR + wobble, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0, 240, 255, ${alpha})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      // --- Flow particles along spiral paths ---
      const particleCount = 80;
      for (let i = 0; i < particleCount; i++) {
        const seed = i * 7.37;
        const armIndex = i % armCount;
        const armAngleOffset = (armIndex / armCount) * Math.PI * 2;
        const progressSpeed = 0.06 + (seed % 1) * 0.04;
        const progress = ((t * progressSpeed + seed) % 5) / 5;
        const r = 15 + progress * maxRadius;
        const spiralTightness = 3.5;
        const angle =
          armAngleOffset + progress * Math.PI * 2 * spiralTightness + t * 0.15;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;

        const size = 1 + (1 - progress) * 1.5;
        const alpha = (1 - progress) * 0.8;

        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        const colorIndex = i % 4;
        const colors = [
          '0, 240, 255',
          '0, 102, 255',
          '107, 0, 255',
          '0, 255, 163',
        ];
        ctx.fillStyle = `rgba(${colors[colorIndex]}, ${alpha})`;
        ctx.fill();
      }

      // --- Bright core center ---
      const innerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 35);
      innerGlow.addColorStop(0, 'rgba(0, 240, 255, 0.4)');
      innerGlow.addColorStop(0.3, 'rgba(0, 240, 255, 0.15)');
      innerGlow.addColorStop(0.7, 'rgba(0, 200, 255, 0.05)');
      innerGlow.addColorStop(1, 'transparent');
      ctx.fillStyle = innerGlow;
      ctx.fillRect(cx - 40, cy - 40, 80, 80);

      // --- Vessel shapes caught in the current ---
      for (const v of vessels) {
        v.angle += v.speed;
        v.radius -= 0.004;
        if (v.radius < 40) {
          v.radius = 80 + Math.random() * 160;
          v.angle = Math.random() * Math.PI * 2;
        }

        const spiralAngle = v.angle + (v.radius / maxRadius) * Math.PI * 2;
        const x = cx + Math.cos(spiralAngle) * v.radius;
        const y = cy + Math.sin(spiralAngle) * v.radius;
        const distFactor = v.radius / maxRadius;
        const alpha = 0.15 + distFactor * 0.15;

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(spiralAngle + Math.PI / 6);

        ctx.beginPath();
        ctx.roundRect(-v.width / 2, -v.height / 2, v.width, v.height, 5);
        ctx.strokeStyle = `rgba(0, 240, 255, ${alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = `rgba(0, 240, 255, ${alpha * 0.15})`;
        ctx.fill();

        ctx.restore();
      }

      ctx.restore();
    },
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isMobile = window.innerWidth < 768;
    const vessels = createVessels(isMobile ? 3 : 6);

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas!.width = canvas!.clientWidth * dpr;
      canvas!.height = canvas!.clientHeight * dpr;
    }

    function handleMouseMove(e: MouseEvent) {
      mouseRef.current = {
        x: e.clientX / window.innerWidth,
        y: e.clientY / window.innerHeight,
      };
    }

    function animate() {
      draw(ctx!, vessels, performance.now());
      animationRef.current = requestAnimationFrame(animate);
    }

    resize();
    window.addEventListener('resize', resize);
    if (!isMobile) {
      window.addEventListener('mousemove', handleMouseMove);
    }
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [draw]);

  return (
    <div
      className="absolute inset-0 md:left-[20%] md:top-[-5%] md:right-[-15%] md:bottom-[-10%]"
      style={{
        perspective: '800px',
        maskImage:
          'radial-gradient(ellipse 85% 75% at 55% 50%, black 30%, transparent 100%)',
        WebkitMaskImage:
          'radial-gradient(ellipse 85% 75% at 55% 50%, black 30%, transparent 100%)',
      }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full vortex-canvas"
        aria-hidden="true"
      />
      <style>{`
        .vortex-canvas {
          will-change: transform;
          transform: rotateX(25deg) scale(1.2);
          transform-origin: center 45%;
          background: radial-gradient(ellipse at 50% 50%, rgba(0,102,255,0.06), transparent 70%);
        }
        @media (min-width: 768px) {
          .vortex-canvas {
            transform: rotateX(28deg) scale(1.5);
          }
        }
      `}</style>
    </div>
  );
}
