import type { PositionedStar } from "@/lib/starstory/domain/sky";
import { ProtoStar } from "./ProtoStar";
import styles from "./sky.module.css";

type SkyRendererProps = {
  stars: PositionedStar[];
};

export function SkyRenderer({ stars }: SkyRendererProps) {
  return (
    <div className={styles.skyRenderer} aria-hidden="true">
      {stars.map((star) => (
        <div
          key={star.visual.id || `${star.xPercent}-${star.yPercent}`}
          className={styles.starNode}
          style={{
            left: `${star.xPercent}%`,
            top: `${star.yPercent}%`,
          }}
        >
          <ProtoStar star={star.visual} />
        </div>
      ))}
    </div>
  );
}
