import type { PositionedStar, SkyStarEntry } from "./types";

export function positionStars(stars: SkyStarEntry[]): PositionedStar[] {
  if (stars.length === 0) {
    return [];
  }

  if (stars.length === 1) {
    return [
      {
        ...stars[0],
        xPercent: 50,
        yPercent: 50,
      },
    ];
  }

  return stars.map((star, index) => ({
    ...star,
    xPercent: 50 + Math.cos((index / stars.length) * Math.PI * 2) * 18,
    yPercent: 50 + Math.sin((index / stars.length) * Math.PI * 2) * 18,
  }));
}
