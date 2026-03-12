import type { PositionedStar } from "./types";

export interface ConstellationLink {
  fromId: string;
  toId: string;
}

export function buildConstellationGraph(_stars: PositionedStar[]): ConstellationLink[] {
  return [];
}
