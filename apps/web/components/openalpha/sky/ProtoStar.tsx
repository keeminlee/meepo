import type { ProtoStarVisualState } from "@/lib/starstory/domain/sky";
import styles from "./sky.module.css";

type ProtoStarProps = {
  star: ProtoStarVisualState;
};

function buildParticles(particleRate: number): number[] {
  const count = Math.max(4, Math.min(18, Math.round(4 + particleRate * 14)));
  return Array.from({ length: count }, (_, index) => index);
}

export function ProtoStar({ star }: ProtoStarProps) {
  const particles = buildParticles(star.particleRate);

  return (
    <div
      className={styles.protoStar}
      data-phase={star.animationPhase}
      data-permanent={star.isPermanent ? "true" : "false"}
      style={{
        ["--glow-color" as string]: star.glowColor,
        ["--glow-intensity" as string]: `${star.glowIntensity}`,
        ["--orbit-speed" as string]: `${star.orbitSpeedSeconds}s`,
        ["--star-scale" as string]: `${star.scale}`,
      }}
      aria-label={star.label ?? "Proto-star"}
    >
      <div className={styles.core}>
        <svg className={styles.glowSvg} viewBox="0 0 220 220" aria-hidden="true">
          <defs>
            <radialGradient id={`proto-star-gradient-${star.id}`}>
              <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
              <stop offset="38%" stopColor={star.glowColor} stopOpacity="0.9" />
              <stop offset="100%" stopColor={star.glowColor} stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="110" cy="110" r="92" fill={`url(#proto-star-gradient-${star.id})`} />
        </svg>
        <div className={styles.nucleus} />
      </div>
      <div className={styles.orbits} aria-hidden="true">
        {Array.from({ length: star.ringCount }, (_, index) => (
          <span
            key={`${star.id}-orbit-${index}`}
            className={styles.orbit}
            style={{
              ["--orbit-index" as string]: `${index}`,
            }}
          />
        ))}
      </div>
      <div className={styles.particles} aria-hidden="true">
        {particles.map((index) => (
          <span
            key={`${star.id}-particle-${index}`}
            className={styles.particle}
            style={{
              ["--particle-index" as string]: `${index}`,
              ["--particle-total" as string]: `${particles.length}`,
            }}
          />
        ))}
      </div>
      {star.label ? <div className={styles.label}>{star.label}</div> : null}
    </div>
  );
}
