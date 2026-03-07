"use client";

import React, { useEffect, useMemo, useRef } from "react";

type CelestialHeroBackgroundProps = {
  className?: string;
  intensity?: number;
  scrollReactive?: boolean;
};

type Star = {
  x: number;
  y: number;
  r: number;
  alpha: number;
  twinkleSpeed: number;
  twinkleOffset: number;
  depth: number;
};

type ShootingStar = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  length: number;
  alpha: number;
};

const STAR_COUNT_BASE = 110;
const SHOOTING_STARS_MAX = 4;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function random(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

export default function CelestialHeroBackground({
  className = "",
  intensity = 1,
  scrollReactive = true,
}: CelestialHeroBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const shootingStarsRef = useRef<ShootingStar[]>([]);
  const starsRef = useRef<Star[]>([]);
  const scrollProgressRef = useRef(0);

  const density = useMemo(() => clamp(intensity, 0.6, 1.8), [intensity]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let startTime = performance.now();

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const parent = canvas.parentElement;
      const rect = parent?.getBoundingClientRect();

      width = Math.max(1, Math.floor(rect?.width ?? window.innerWidth));
      height = Math.max(1, Math.floor(rect?.height ?? window.innerHeight));
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const starCount = Math.floor(STAR_COUNT_BASE * density);
      starsRef.current = Array.from({ length: starCount }).map(() => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: random(0.4, 1.6),
        alpha: random(0.18, 0.82),
        twinkleSpeed: random(0.3, 1.2),
        twinkleOffset: random(0, Math.PI * 2),
        depth: random(0.6, 1.25),
      }));
    };

    const updateScrollProgress = () => {
      if (!scrollReactive) {
        scrollProgressRef.current = 0;
        return;
      }

      const hero = canvas.parentElement;
      if (!hero) {
        scrollProgressRef.current = 0;
        return;
      }

      const rect = hero.getBoundingClientRect();
      const heroHeight = Math.max(rect.height, window.innerHeight * 0.8);

      // 0 at rest, approaches 1 as user scrolls through hero region
      const progressed = clamp((-rect.top) / heroHeight, 0, 1);
      scrollProgressRef.current = progressed;
    };

    const spawnShootingStar = () => {
      if (shootingStarsRef.current.length >= SHOOTING_STARS_MAX) return;

      const scrollBoost = scrollProgressRef.current;
      const x = random(width * 0.1, width * 0.95);
      const y = random(height * 0.05, height * 0.45);
      const speed = random(8, 12) + scrollBoost * 4;

      shootingStarsRef.current.push({
        x,
        y,
        vx: -speed,
        vy: speed * random(0.28, 0.42),
        life: 0,
        maxLife: random(30, 55),
        length: random(90, 150) + scrollBoost * 45,
        alpha: random(0.55, 0.9) + scrollBoost * 0.12,
      });
    };

    const drawBackground = () => {
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "#040817");
      gradient.addColorStop(0.5, "#050a1c");
      gradient.addColorStop(1, "#030611");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // soft celestial glow near top-center
      const radial = ctx.createRadialGradient(
        width * 0.5,
        height * 0.18,
        0,
        width * 0.5,
        height * 0.18,
        width * 0.42
      );
      radial.addColorStop(0, "rgba(234, 200, 120, 0.09)");
      radial.addColorStop(0.3, "rgba(160, 120, 60, 0.04)");
      radial.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = radial;
      ctx.fillRect(0, 0, width, height);

      // vignette to keep edges richer and center readable
      const vignette = ctx.createRadialGradient(
        width * 0.5,
        height * 0.45,
        width * 0.15,
        width * 0.5,
        height * 0.45,
        width * 0.8
      );
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.35)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);
    };

    const drawStars = (t: number) => {
      const stars = starsRef.current;
      const scrollBoost = scrollProgressRef.current;

      for (const star of stars) {
        const twinkle =
          0.65 +
          Math.sin(t * 0.001 * star.twinkleSpeed + star.twinkleOffset) * 0.22;
        const alpha = clamp(star.alpha * twinkle + scrollBoost * 0.05, 0.06, 1);

        // keep center slightly calmer for headline readability
        const dx = Math.abs(star.x - width * 0.5) / width;
        const dy = Math.abs(star.y - height * 0.32) / height;
        const centerSuppression = dx < 0.16 && dy < 0.16 ? 0.55 : 1;

        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r * star.depth, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(248, 235, 202, ${alpha * centerSuppression})`;
        ctx.fill();

        if (star.r > 1.15 && Math.random() < 0.014 + scrollBoost * 0.01) {
          ctx.beginPath();
          ctx.arc(star.x, star.y, star.r * 3.2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(230, 191, 110, ${0.05 * centerSuppression})`;
          ctx.fill();
        }
      }
    };

    const drawDust = (t: number) => {
      const drift = Math.sin(t * 0.00012) * 20;
      const glow = ctx.createRadialGradient(
        width * 0.68 + drift,
        height * 0.28,
        0,
        width * 0.68 + drift,
        height * 0.28,
        width * 0.26
      );
      glow.addColorStop(0, "rgba(201, 156, 77, 0.05)");
      glow.addColorStop(0.5, "rgba(125, 92, 42, 0.02)");
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
    };

    const drawShootingStars = () => {
      const stars = shootingStarsRef.current;

      for (let i = stars.length - 1; i >= 0; i--) {
        const s = stars[i];
        s.life += 1;
        s.x += s.vx;
        s.y += s.vy;

        const progress = s.life / s.maxLife;
        const fade = 1 - progress;
        const tailX = s.x - s.vx * 0.12 * (s.length / 10);
        const tailY = s.y - s.vy * 0.12 * (s.length / 10);

        const gradient = ctx.createLinearGradient(s.x, s.y, tailX, tailY);
        gradient.addColorStop(0, `rgba(255, 247, 222, ${0.95 * s.alpha * fade})`);
        gradient.addColorStop(0.2, `rgba(240, 211, 140, ${0.55 * s.alpha * fade})`);
        gradient.addColorStop(1, "rgba(240, 211, 140, 0)");

        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 248, 230, ${0.8 * fade})`;
        ctx.fill();

        if (progress >= 1 || s.x < -200 || s.y > height + 200) {
          stars.splice(i, 1);
        }
      }
    };

    const animate = (now: number) => {
      if (prefersReducedMotion) {
        drawBackground();
        drawDust(now);
        drawStars(now);
        return;
      }

      updateScrollProgress();

      const scrollBoost = scrollProgressRef.current;
      const elapsed = now - startTime;

      drawBackground();
      drawDust(elapsed);
      drawStars(elapsed);
      drawShootingStars();

      const spawnChance = 0.002 + scrollBoost * 0.01;
      if (Math.random() < spawnChance) {
        spawnShootingStar();
      }

      animationFrameRef.current = window.requestAnimationFrame(animate);
    };

    resize();
    updateScrollProgress();
    animationFrameRef.current = window.requestAnimationFrame(animate);

    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("scroll", updateScrollProgress, { passive: true });

    return () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", updateScrollProgress);
    };
  }, [density, scrollReactive]);

  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0)_0%,rgba(0,0,0,0.10)_45%,rgba(0,0,0,0.34)_100%)]" />
    </div>
  );
}
