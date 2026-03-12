"use client";

import { useCallback, useEffect, useRef } from "react";
import styles from "./sky.module.css";

type StarfieldCanvasProps = {
  cameraTheta: number;
  cameraPhi: number;
};

const STAR_COUNT = 200;
const SKY_WIDTH = 3600;

type FieldStar = {
  x: number;
  y: number;
  size: number;
  brightness: number;
  speed: number;
};

function generateStars(count: number): FieldStar[] {
  const stars: FieldStar[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * SKY_WIDTH,
      y: Math.random(),
      size: 0.3 + Math.random() * 1.5,
      brightness: 0.15 + Math.random() * 0.85,
      speed: 0.1 + Math.random() * 0.4,
    });
  }
  return stars;
}

export function StarfieldCanvas({ cameraTheta, cameraPhi }: StarfieldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const starsRef = useRef<FieldStar[] | null>(null);

  if (!starsRef.current) {
    starsRef.current = generateStars(STAR_COUNT);
  }

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const stars = starsRef.current!;
    for (const s of stars) {
      let sx = s.x - cameraTheta * s.speed;
      sx = ((sx % SKY_WIDTH) + SKY_WIDTH) % SKY_WIDTH;
      const screenX = (sx / SKY_WIDTH) * width;
      const screenY = (s.y + cameraPhi * s.speed * 0.002) * height;

      ctx.globalAlpha = s.brightness;
      ctx.fillStyle = "#c8d8ff";
      ctx.beginPath();
      ctx.arc(screenX, screenY, s.size * (width / 1920), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, [cameraTheta, cameraPhi]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      draw();
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [draw]);

  useEffect(() => {
    draw();
  }, [draw]);

  return <canvas ref={canvasRef} className={styles.starfieldCanvas} />;
}
