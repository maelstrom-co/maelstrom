import { useEffect, useRef, useCallback } from 'react';

interface Particle {
  angle: number;
  radius: number;
  speed: number;
  size: number;
  opacity: number;
  color: string;
  trail: Array<{ x: number; y: number }>;
}

interface VesselShape {
  angle: number;
  radius: number;
  speed: number;
  width: number;
  height: number;
  opacity: number;
}

const COLORS = ['#00f0ff', '#0066ff', '#6b00ff', '#00ffa3'];

function createParticles(count: number): Particle[] {
  return Array.from({ length: count }, () => ({
    angle: Math.random() * Math.PI * 2,
    radius: 50 + Math.random() * 250,
    speed: 0.002 + Math.random() * 0.008,
    size: 1 + Math.random() * 2.5,
    opacity: 0.3 + Math.random() * 0.7,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    trail: [],
  }));
}

function createVessels(count: number): VesselShape[] {
  return Array.from({ length: count }, () => ({
    angle: Math.random() * Math.PI * 2,
    radius: 80 + Math.random() * 180,
    speed: 0.001 + Math.random() * 0.003,
    width: 30 + Math.random() * 40,
    height: 20 + Math.random() * 25,
    opacity: 0.2 + Math.random() * 0.25,
  }));
}

export default function HeroVortexParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const animationRef = useRef<number>(0);

  const draw = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      particles: Particle[],
      vessels: VesselShape[],
      time: number,
      isMobile: boolean,
    ) => {
      const w = ctx.canvas.clientWidth;
      const h = ctx.canvas.clientHeight;
      const cx = w * (0.5 + (mouseRef.current.x - 0.5) * 0.05);
      const cy = h * (0.5 + (mouseRef.current.y - 0.5) * 0.05);

      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.scale(dpr, dpr);

      // Core glow — stronger
      const coreGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, 220);
      coreGradient.addColorStop(0, 'rgba(0, 240, 255, 0.15)');
      coreGradient.addColorStop(0.3, 'rgba(0, 102, 255, 0.08)');
      coreGradient.addColorStop(0.6, 'rgba(107, 0, 255, 0.03)');
      coreGradient.addColorStop(1, 'transparent');
      ctx.fillStyle = coreGradient;
      ctx.fillRect(0, 0, w, h);

      // Depth rings — more visible
      const timeSec = time * 0.001;
      for (let i = 0; i < 5; i++) {
        const ringRadius = 25 + i * 45 + Math.sin(timeSec + i) * 8;
        const ringAlpha = 0.1 - i * 0.016;
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0, 240, 255, ${ringAlpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Particles with trails
      const maxTrailLength = isMobile ? 4 : 8;
      for (const p of particles) {
        p.angle += p.speed;
        p.radius -= 0.03;
        if (p.radius < 15) {
          p.radius = 50 + Math.random() * 250;
          p.angle = Math.random() * Math.PI * 2;
          p.trail = [];
        }
        const x = cx + Math.cos(p.angle) * p.radius;
        const y = cy + Math.sin(p.angle) * p.radius;

        // Draw trail
        for (let t = p.trail.length - 1; t >= 0; t--) {
          const trailAlpha = (t / p.trail.length) * p.opacity * 0.4;
          ctx.beginPath();
          ctx.arc(p.trail[t].x, p.trail[t].y, p.size * 0.5, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = trailAlpha * (p.radius / 250);
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.opacity * (p.radius / 250);
        ctx.fill();

        p.trail.push({ x, y });
        if (p.trail.length > maxTrailLength) {
          p.trail.shift();
        }
      }

      // Vessel shapes
      ctx.globalAlpha = 1;
      for (const v of vessels) {
        v.angle += v.speed;
        const x = cx + Math.cos(v.angle) * v.radius;
        const y = cy + Math.sin(v.angle) * v.radius;

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(v.angle + Math.PI / 4);

        ctx.beginPath();
        ctx.roundRect(-v.width / 2, -v.height / 2, v.width, v.height, 6);
        ctx.strokeStyle = `rgba(0, 240, 255, ${v.opacity})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        const innerGlow = ctx.createRadialGradient(
          0,
          0,
          0,
          0,
          0,
          Math.max(v.width, v.height) / 2,
        );
        innerGlow.addColorStop(0, `rgba(0, 240, 255, ${v.opacity * 0.2})`);
        innerGlow.addColorStop(1, 'rgba(0, 240, 255, 0)');
        ctx.fillStyle = innerGlow;
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
    const particles = createParticles(isMobile ? 80 : 180);
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
      draw(ctx!, particles, vessels, performance.now(), isMobile);
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
      className="absolute inset-x-0 bottom-0 h-[55%]"
      style={{
        perspective: '800px',
        maskImage:
          'linear-gradient(to bottom, transparent 0%, black 10%, black 90%, transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent 0%, black 10%, black 90%, transparent 100%)',
      }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{
          willChange: 'transform',
          transform: 'rotateX(35deg) scale(1.3)',
          transformOrigin: 'center 40%',
          background:
            'radial-gradient(ellipse at 50% 50%, rgba(0,102,255,0.06), transparent 70%)',
        }}
        aria-hidden="true"
      />
    </div>
  );
}
