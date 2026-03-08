export type CampaignCandidate = {
  slug: string;
  name: string;
  type?: "user" | "system";
  editable?: boolean;
  persisted?: boolean;
};

export type ResolveActiveCampaignSource =
  | "route"
  | "persisted"
  | "first-real"
  | "demo"
  | "none";

export type ResolveActiveCampaignResult = {
  resolvedSlug: string | null;
  source: ResolveActiveCampaignSource;
  isDemo: boolean;
  realCampaignCount: number;
  routeSlugValid: boolean;
  persistedSlugValid: boolean;
};

export type ResolveActiveCampaignInput = {
  routeSlug?: string | null;
  persistedSlug?: string | null;
  campaigns: CampaignCandidate[];
  allowDemoFallback?: boolean;
};

export const SYSTEM_DEMO_SLUG = "demo";

function normalizeSlug(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function isSystemCampaign(campaign: CampaignCandidate): boolean {
  if (campaign.type === "system") return true;
  return campaign.slug === SYSTEM_DEMO_SLUG;
}

function hasCampaign(campaigns: CampaignCandidate[], slug: string): boolean {
  return campaigns.some((campaign) => campaign.slug === slug);
}

function firstRealCampaignSlug(campaigns: CampaignCandidate[]): string | null {
  for (const campaign of campaigns) {
    if (isSystemCampaign(campaign)) continue;
    return campaign.slug;
  }
  return null;
}

function demoCampaignSlug(campaigns: CampaignCandidate[]): string {
  const explicitDemo = campaigns.find((campaign) => campaign.slug === SYSTEM_DEMO_SLUG);
  return explicitDemo?.slug ?? SYSTEM_DEMO_SLUG;
}

export function resolveActiveCampaign(input: ResolveActiveCampaignInput): ResolveActiveCampaignResult {
  const routeSlug = normalizeSlug(input.routeSlug);
  const persistedSlug = normalizeSlug(input.persistedSlug);
  const campaigns = input.campaigns;
  const allowDemoFallback = input.allowDemoFallback ?? true;

  const routeSlugValid = routeSlug ? hasCampaign(campaigns, routeSlug) : false;
  const persistedSlugValid = persistedSlug ? hasCampaign(campaigns, persistedSlug) : false;

  const realCampaignCount = campaigns.filter((campaign) => !isSystemCampaign(campaign)).length;

  if (routeSlugValid && routeSlug) {
    return {
      resolvedSlug: routeSlug,
      source: "route",
      isDemo: routeSlug === SYSTEM_DEMO_SLUG,
      realCampaignCount,
      routeSlugValid,
      persistedSlugValid,
    };
  }

  if (persistedSlugValid && persistedSlug) {
    return {
      resolvedSlug: persistedSlug,
      source: "persisted",
      isDemo: persistedSlug === SYSTEM_DEMO_SLUG,
      realCampaignCount,
      routeSlugValid,
      persistedSlugValid,
    };
  }

  const firstReal = firstRealCampaignSlug(campaigns);
  if (firstReal) {
    return {
      resolvedSlug: firstReal,
      source: "first-real",
      isDemo: false,
      realCampaignCount,
      routeSlugValid,
      persistedSlugValid,
    };
  }

  if (allowDemoFallback) {
    return {
      resolvedSlug: demoCampaignSlug(campaigns),
      source: "demo",
      isDemo: true,
      realCampaignCount,
      routeSlugValid,
      persistedSlugValid,
    };
  }

  return {
    resolvedSlug: null,
    source: "none",
    isDemo: false,
    realCampaignCount,
    routeSlugValid,
    persistedSlugValid,
  };
}
