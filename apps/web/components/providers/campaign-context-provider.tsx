"use client";

import { createContext, type ReactNode, useContext } from "react";

export type CampaignRouteType =
  | "campaign-sessions"
  | "campaign-session-detail"
  | "campaign-compendium"
  | "global-dashboard"
  | "global-settings"
  | "other";

export type CampaignContextRouteState = {
  routeType: CampaignRouteType;
  routeCampaignSlug: string | null;
};

export type CampaignSelectorOption = {
  slug: string;
  name: string;
  type: "user" | "system";
  editable: boolean;
  persisted: boolean;
};

type CampaignContextValue = {
  activeCampaignSlug: string | null;
  isDemoCampaign: boolean;
  route: CampaignContextRouteState;
  campaigns: CampaignSelectorOption[];
  realCampaigns: CampaignSelectorOption[];
  selectCampaign: (campaignSlug: string) => void;
};

const CampaignContext = createContext<CampaignContextValue | null>(null);

type CampaignContextProviderProps = {
  value: CampaignContextValue;
  children: ReactNode;
};

export function resolveCampaignRouteState(pathname: string): CampaignContextRouteState {
  if (pathname === "/dashboard") {
    return { routeType: "global-dashboard", routeCampaignSlug: null };
  }

  if (pathname === "/settings") {
    return { routeType: "global-settings", routeCampaignSlug: null };
  }

  const parts = pathname.split("/").filter((part) => part.length > 0);
  if (parts.length >= 2 && parts[0] === "campaigns") {
    const campaignSlug = parts[1] ?? null;

    if (parts.length === 3 && parts[2] === "sessions") {
      return { routeType: "campaign-sessions", routeCampaignSlug: campaignSlug };
    }

    if (parts.length === 4 && parts[2] === "sessions") {
      return { routeType: "campaign-session-detail", routeCampaignSlug: campaignSlug };
    }

    if (parts.length === 3 && parts[2] === "compendium") {
      return { routeType: "campaign-compendium", routeCampaignSlug: campaignSlug };
    }

    return { routeType: "other", routeCampaignSlug: campaignSlug };
  }

  return { routeType: "other", routeCampaignSlug: null };
}

export function resolveCampaignTargetPath(args: {
  routeType: CampaignRouteType;
  campaignSlug: string;
}): string {
  if (args.routeType === "campaign-compendium") {
    return `/campaigns/${args.campaignSlug}/compendium`;
  }

  // Session detail cannot be safely remapped across campaigns.
  return `/campaigns/${args.campaignSlug}/sessions`;
}

export function CampaignContextProvider({ value, children }: CampaignContextProviderProps) {
  return <CampaignContext.Provider value={value}>{children}</CampaignContext.Provider>;
}

export function useCampaignContext(): CampaignContextValue {
  const value = useContext(CampaignContext);
  if (!value) {
    throw new Error("useCampaignContext must be used within CampaignContextProvider.");
  }
  return value;
}

export function useActiveCampaign(): string | null {
  return useCampaignContext().activeCampaignSlug;
}

export function useIsDemoCampaign(): boolean {
  return useCampaignContext().isDemoCampaign;
}
