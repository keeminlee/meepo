import { describe, expect, it } from "vitest";
import { projectVisualState } from "@/lib/starstory/domain/sky";
import type { ProtoStarState } from "@/lib/starstory/domain/narrative";

function buildProtoStar(overrides: Partial<ProtoStarState> = {}): ProtoStarState {
  return {
    id: "star-1",
    phase: "PROTO_STAR_FORMING",
    brightness: 0,
    ringCount: 0,
    symbolDensity: 0,
    reactionLevel: 0,
    transcriptLineCount: 0,
    campaignName: null,
    isPermanent: false,
    canBeginChronicle: false,
    canValidate: false,
    ...overrides,
  };
}

describe("projectVisualState", () => {
  it("maps low values into a visible but restrained visual state", () => {
    const visual = projectVisualState(buildProtoStar());

    expect(visual.glowIntensity).toBeGreaterThan(0);
    expect(visual.ringCount).toBe(1);
    expect(visual.particleRate).toBeGreaterThan(0);
    expect(visual.animationPhase).toBe("forming");
  });

  it("maps terminal phases to their dedicated animation state", () => {
    const born = projectVisualState(buildProtoStar({ phase: "STAR_BORN", isPermanent: true }));
    const collapsed = projectVisualState(buildProtoStar({ phase: "STAR_COLLAPSED" }));

    expect(born.animationPhase).toBe("permanent-pulse");
    expect(born.isPermanent).toBe(true);
    expect(collapsed.animationPhase).toBe("collapsed");
  });

  it("scales glow and orbit speed based on narrative intensity", () => {
    const visual = projectVisualState(
      buildProtoStar({
        phase: "CHRONICLE_RECORDING",
        brightness: 1,
        ringCount: 4,
        symbolDensity: 1,
        transcriptLineCount: 220,
      })
    );

    expect(visual.glowIntensity).toBeCloseTo(1, 1);
    expect(visual.orbitSpeedSeconds).toBeLessThan(18);
    expect(visual.scale).toBeGreaterThan(1);
  });
});
