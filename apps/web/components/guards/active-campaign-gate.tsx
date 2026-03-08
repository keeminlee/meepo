"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { CampaignsResponse } from "@/lib/api/types";
import {
  resolveActiveCampaign,
  SYSTEM_DEMO_SLUG,
  type CampaignCandidate,
} from "@/lib/campaigns/resolveActiveCampaign";
import {
  CampaignContextProvider,
  resolveCampaignRouteState,
  resolveCampaignTargetPath,
  type CampaignSelectorOption,
} from "@/components/providers/campaign-context-provider";

const ACTIVE_CAMPAIGN_STORAGE_KEY = "localStorage.meepo.activeCampaign";

type ActiveCampaignGateProps = {
  children: ReactNode;
};

type CampaignLoadState = "loading" | "ready" | "error";
type DashboardAuthState = CampaignsResponse["dashboard"]["authState"];

function mapCampaignOption(campaign: CampaignsResponse["dashboard"]["campaigns"][number]): CampaignSelectorOption {
  const type = campaign.type === "system" ? "system" : "user";
  return {
    slug: campaign.slug,
    name: campaign.name,
    type,
    editable: campaign.editable ?? type !== "system",
    persisted: campaign.persisted ?? type !== "system",
  };
}

function readPersistedCampaignSlug(): string | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(ACTIVE_CAMPAIGN_STORAGE_KEY);
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function writePersistedCampaignSlug(slug: string | null): void {
  if (typeof window === "undefined") return;
  if (!slug) {
    window.localStorage.removeItem(ACTIVE_CAMPAIGN_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(ACTIVE_CAMPAIGN_STORAGE_KEY, slug);
}

export function ActiveCampaignGate({ children }: ActiveCampaignGateProps) {
  const pathname = usePathname();
  const router = useRouter();
  const route = useMemo(() => resolveCampaignRouteState(pathname), [pathname]);

  const [campaigns, setCampaigns] = useState<CampaignSelectorOption[]>([]);
  const [loadState, setLoadState] = useState<CampaignLoadState>("loading");
  const [dashboardAuthState, setDashboardAuthState] = useState<DashboardAuthState>("ok");
  const [persistedSlug, setPersistedSlug] = useState<string | null>(null);

  useEffect(() => {
    setPersistedSlug(readPersistedCampaignSlug());
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadCampaigns() {
      setLoadState("loading");
      try {
        const response = await fetch("/api/campaigns", {
          method: "GET",
          cache: "no-store",
          headers: {
            "content-type": "application/json",
          },
        });

        if (!response.ok) {
          if (mounted) {
            setCampaigns([]);
            setDashboardAuthState("ok");
            setLoadState("error");
          }
          return;
        }

        const payload = (await response.json()) as CampaignsResponse;
        const nextCampaigns = payload.dashboard.campaigns.map(mapCampaignOption);

        if (mounted) {
          setCampaigns(nextCampaigns);
          setDashboardAuthState(payload.dashboard.authState ?? "ok");
          setLoadState("ready");
        }
      } catch {
        if (mounted) {
          setCampaigns([]);
          setDashboardAuthState("ok");
          setLoadState("error");
        }
      }
    }

    void loadCampaigns();
    return () => {
      mounted = false;
    };
  }, []);

  const resolved = useMemo(
    () =>
      resolveActiveCampaign({
        routeSlug: route.routeCampaignSlug,
        persistedSlug,
        campaigns: campaigns as CampaignCandidate[],
        allowDemoFallback: loadState !== "error" && dashboardAuthState !== "signed_in_no_authorized_campaigns",
      }),
    [campaigns, dashboardAuthState, loadState, persistedSlug, route.routeCampaignSlug]
  );

  const activeCampaignSlug = resolved.resolvedSlug;
  const isDemoCampaign = activeCampaignSlug === SYSTEM_DEMO_SLUG;

  const realCampaigns = useMemo(
    () => campaigns.filter((campaign) => campaign.type === "user"),
    [campaigns]
  );

  useEffect(() => {
    if (loadState !== "ready") return;

    const selected = campaigns.find((campaign) => campaign.slug === activeCampaignSlug) ?? null;
    if (!selected || !selected.persisted) {
      writePersistedCampaignSlug(null);
      setPersistedSlug(null);
      return;
    }

    const currentPersisted = readPersistedCampaignSlug();
    if (currentPersisted !== selected.slug) {
      writePersistedCampaignSlug(selected.slug);
      setPersistedSlug(selected.slug);
    }
  }, [activeCampaignSlug, campaigns, loadState]);

  const selectCampaign = useCallback(
    (campaignSlug: string) => {
      if (!campaignSlug) return;
      const targetCampaign = campaigns.find((campaign) => campaign.slug === campaignSlug);
      if (!targetCampaign) return;

      if (targetCampaign.persisted) {
        writePersistedCampaignSlug(targetCampaign.slug);
        setPersistedSlug(targetCampaign.slug);
      } else {
        writePersistedCampaignSlug(null);
        setPersistedSlug(null);
      }

      const nextPath = resolveCampaignTargetPath({
        routeType: route.routeType,
        campaignSlug: targetCampaign.slug,
      });
      router.push(nextPath);
    },
    [campaigns, route.routeType, router]
  );

  return (
    <CampaignContextProvider
      value={{
        activeCampaignSlug,
        isDemoCampaign,
        route,
        campaigns,
        realCampaigns,
        selectCampaign,
      }}
    >
      {children}
    </CampaignContextProvider>
  );
}
