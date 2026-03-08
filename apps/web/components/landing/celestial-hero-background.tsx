"use client";

import React, { useEffect, useMemo, useRef } from "react";

type CelestialHeroBackgroundProps = {
  className?: string;
  profile?: "landing" | "archive";
  motionEnabled?: boolean;
  parallaxEnabled?: boolean;
};

type Star = {
  x: number;
  y: number;
  size: number;
  brightness: number;
  twinkleSpeed: number;
  twinkleOffset: number;
  depthFactor: number;
  parallaxFactor: number;
  glowStrength: number;
};

type ProfileState = {
  veilOpacity: number;
  glowIntensity: number;
  motionCalmness: number;
  parallaxAmplitude: number;
  starIntensity: number;
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
const STAR_SEED = 289014241;

const PROFILE_TARGETS: Record<"landing" | "archive", ProfileState> = {
  landing: {
    veilOpacity: 0.18,
    glowIntensity: 1,
    motionCalmness: 1,
    parallaxAmplitude: 1,
    starIntensity: 1,
  },
  archive: {
    veilOpacity: 0.3,
    glowIntensity: 0.78,
    motionCalmness: 0.58,
    parallaxAmplitude: 0.62,
    starIntensity: 0.76,
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function random(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function createSeededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function seededRange(rand: () => number, min: number, max: number) {
  return min + rand() * (max - min);
}

export default function CelestialHeroBackground({
  className = "",
  profile = "archive",
  motionEnabled = true,
  parallaxEnabled = true,
}: CelestialHeroBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const shootingStarsRef = useRef<ShootingStar[]>([]);
  const starsRef = useRef<Star[]>([]);
  const profileStateRef = useRef<ProfileState>(PROFILE_TARGETS[profile]);
  const profileTargetRef = useRef<ProfileState>(PROFILE_TARGETS[profile]);
  const scrollProgressRef = useRef(0);
  const scrollParallaxTargetRef = useRef(0);
  const scrollParallaxCurrentRef = useRef(0);
  const viewportTargetRef = useRef({ x: 0, y: 0 });
  const viewportCurrentRef = useRef({ x: 0, y: 0 });

  const scrollReactive = useMemo(() => profile === "landing", [profile]);

  useEffect(() => {
    profileTargetRef.current = PROFILE_TARGETS[profile];
  }, [profile]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let startTime = performance.now();

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

      if (starsRef.current.length === 0) {
        const rand = createSeededRandom(STAR_SEED);
        starsRef.current = Array.from({ length: STAR_COUNT_BASE }).map(() => ({
          x: rand(),
          y: rand(),
          size: seededRange(rand, 0.35, 1.95),
          brightness: seededRange(rand, 0.16, 0.9),
          twinkleSpeed: seededRange(rand, 0.3, 1.2),
          twinkleOffset: seededRange(rand, 0, Math.PI * 2),
          depthFactor: seededRange(rand, 0.65, 1.45),
          parallaxFactor: seededRange(rand, 0.35, 1.4),
          glowStrength: seededRange(rand, 0.02, 0.09),
        }));
      }

      const normalizedViewportX = clamp((width - 1440) / 1440, -1, 1);
      const normalizedViewportY = clamp((height - 900) / 900, -1, 1);
      viewportTargetRef.current = {
        x: normalizedViewportX,
        y: normalizedViewportY,
      };
    };

    const updateScrollProgress = () => {
      if (!scrollReactive) {
        scrollProgressRef.current = 0;
      } else {
        const progressed = clamp(window.scrollY / Math.max(1, window.innerHeight * 1.25), 0, 1);
        scrollProgressRef.current = progressed;
      }

      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      scrollParallaxTargetRef.current = clamp(window.scrollY / maxScroll, 0, 1);
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
      const profileState = profileStateRef.current;
      radial.addColorStop(0, `rgba(234, 200, 120, ${0.09 * profileState.glowIntensity})`);
      radial.addColorStop(0.3, `rgba(160, 120, 60, ${0.04 * profileState.glowIntensity})`);
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

    const drawStars = (t: number, globalParallaxX: number, globalParallaxY: number) => {
      const stars = starsRef.current;
      const scrollBoost = scrollProgressRef.current;
      const profileState = profileStateRef.current;

      for (const star of stars) {
        const twinkle =
          0.65 +
          Math.sin(t * 0.001 * star.twinkleSpeed * profileState.motionCalmness + star.twinkleOffset) * 0.22;
        const alpha = clamp((star.brightness * twinkle + scrollBoost * 0.05) * profileState.starIntensity, 0.06, 1);

        const x = star.x * width + globalParallaxX * star.parallaxFactor;
        const y = star.y * height + globalParallaxY * star.parallaxFactor;

        // keep center slightly calmer for headline readability
        const dx = Math.abs(x - width * 0.5) / width;
        const dy = Math.abs(y - height * 0.32) / height;
        const centerSuppression = dx < 0.16 && dy < 0.16 ? 0.55 : 1;

        ctx.beginPath();
        ctx.arc(x, y, star.size * star.depthFactor, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(248, 235, 202, ${alpha * centerSuppression})`;
        ctx.fill();

        if (star.size > 1.05 && Math.random() < 0.014 + scrollBoost * 0.01) {
          ctx.beginPath();
          ctx.arc(x, y, star.size * 3.2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(230, 191, 110, ${star.glowStrength * profileState.glowIntensity * centerSuppression})`;
          ctx.fill();
        }
      }
    };

    const drawDust = (t: number) => {
      const drift = Math.sin(t * 0.00012) * 20;
      const profileState = profileStateRef.current;
      const glow = ctx.createRadialGradient(
        width * 0.68 + drift,
        height * 0.28,
        0,
        width * 0.68 + drift,
        height * 0.28,
        width * 0.26
      );
      glow.addColorStop(0, `rgba(201, 156, 77, ${0.05 * profileState.glowIntensity})`);
      glow.addColorStop(0.5, `rgba(125, 92, 42, ${0.02 * profileState.glowIntensity})`);
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
    };

    const drawVeil = () => {
      const profileState = profileStateRef.current;
      const radial = ctx.createRadialGradient(
        width * 0.5,
        height * 0.2,
        0,
        width * 0.5,
        height * 0.2,
        width * 0.5
      );
      radial.addColorStop(0, `rgba(42, 34, 12, ${0.12 * profileState.veilOpacity})`);
      radial.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = radial;
      ctx.fillRect(0, 0, width, height);

      const linear = ctx.createLinearGradient(0, 0, 0, height);
      linear.addColorStop(0, `rgba(9, 12, 25, ${0.1 * profileState.veilOpacity})`);
      linear.addColorStop(1, `rgba(6, 8, 16, ${0.4 * profileState.veilOpacity})`);
      ctx.fillStyle = linear;
      ctx.fillRect(0, 0, width, height);
    };

    const updateProfileTween = () => {
      const target = profileTargetRef.current;
      const current = profileStateRef.current;
      const step = 0.04;
      profileStateRef.current = {
        veilOpacity: current.veilOpacity + (target.veilOpacity - current.veilOpacity) * step,
        glowIntensity: current.glowIntensity + (target.glowIntensity - current.glowIntensity) * step,
        motionCalmness: current.motionCalmness + (target.motionCalmness - current.motionCalmness) * step,
        parallaxAmplitude: current.parallaxAmplitude + (target.parallaxAmplitude - current.parallaxAmplitude) * step,
        starIntensity: current.starIntensity + (target.starIntensity - current.starIntensity) * step,
      };
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
      if (!motionEnabled) {
        updateProfileTween();
        drawBackground();
        drawDust(now);
        drawStars(now, 0, 0);
        drawVeil();
        // Intentionally no RAF scheduling in static mode so the sky remains visible and stable.
        return;
      }

      updateScrollProgress();
      updateProfileTween();

      scrollParallaxCurrentRef.current +=
        (scrollParallaxTargetRef.current - scrollParallaxCurrentRef.current) * 0.05;
      viewportCurrentRef.current.x += (viewportTargetRef.current.x - viewportCurrentRef.current.x) * 0.04;
      viewportCurrentRef.current.y += (viewportTargetRef.current.y - viewportCurrentRef.current.y) * 0.04;

      const parallaxAmplitude = profileStateRef.current.parallaxAmplitude;
      const motionCalmness = profileStateRef.current.motionCalmness;
      const scrollOffsetX = (scrollParallaxCurrentRef.current - 0.5) * 3.2 * parallaxAmplitude;
      const scrollOffsetY = (scrollParallaxCurrentRef.current - 0.5) * 8.6 * parallaxAmplitude;
      const viewportOffsetX = viewportCurrentRef.current.x * 2.4 * parallaxAmplitude;
      const viewportOffsetY = viewportCurrentRef.current.y * 1.9 * parallaxAmplitude;

      const globalParallaxX = clamp(scrollOffsetX + viewportOffsetX, -8, 8);
      const globalParallaxY = clamp(scrollOffsetY + viewportOffsetY, -10, 10);

      const scrollBoost = scrollProgressRef.current;
      const elapsed = now - startTime;

      drawBackground();
      drawDust(elapsed);
      drawStars(elapsed, parallaxEnabled ? globalParallaxX : 0, parallaxEnabled ? globalParallaxY : 0);
      drawShootingStars();
      drawVeil();

      const spawnChance = (0.0016 + scrollBoost * 0.0085) * motionCalmness;
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
  }, [motionEnabled, parallaxEnabled, scrollReactive]);

  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
      />
    </div>
  );
}
