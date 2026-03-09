// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
  resolveActiveCampaign,
  SYSTEM_DEMO_SLUG,
  type CampaignCandidate,
} from "../../apps/web/lib/campaigns/resolveActiveCampaign";

function campaign(slug: string): CampaignCandidate {
  return {
    slug,
    name: slug,
    type: "user",
    editable: true,
    persisted: true,
  };
}

describe("web active campaign resolver", () => {
  it("prefers valid route slug", () => {
    const resolved = resolveActiveCampaign({
      routeSlug: "alpha",
      persistedSelection: { slug: "beta", guildId: null },
      campaigns: [campaign("alpha"), campaign("beta")],
    });

    expect(resolved.resolvedSlug).toBe("alpha");
    expect(resolved.source).toBe("route");
  });

  it("uses persisted slug when route slug is invalid", () => {
    const resolved = resolveActiveCampaign({
      routeSlug: "unknown",
      persistedSelection: { slug: "beta", guildId: null },
      campaigns: [campaign("alpha"), campaign("beta")],
    });

    expect(resolved.resolvedSlug).toBe("beta");
    expect(resolved.source).toBe("persisted");
    expect(resolved.routeSlugValid).toBe(false);
    expect(resolved.persistedSlugValid).toBe(true);
  });

  it("falls back to first real campaign", () => {
    const resolved = resolveActiveCampaign({
      routeSlug: null,
      persistedSelection: { slug: "missing", guildId: null },
      campaigns: [campaign("first"), campaign("second")],
    });

    expect(resolved.resolvedSlug).toBe("first");
    expect(resolved.source).toBe("first-real");
    expect(resolved.realCampaignCount).toBe(2);
  });

  it("falls back to demo when there are no real campaigns", () => {
    const resolved = resolveActiveCampaign({
      routeSlug: null,
      persistedSelection: null,
      campaigns: [],
    });

    expect(resolved.resolvedSlug).toBe(SYSTEM_DEMO_SLUG);
    expect(resolved.source).toBe("demo");
    expect(resolved.isDemo).toBe(true);
  });
});
