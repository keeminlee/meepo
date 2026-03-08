"use client";

import { useMemo } from "react";
import { useCampaignContext } from "@/components/providers/campaign-context-provider";

export function CampaignSelector() {
  const { activeCampaignSlug, campaigns, realCampaigns, selectCampaign } = useCampaignContext();

  const currentValue = useMemo(() => {
    if (activeCampaignSlug && campaigns.some((campaign) => campaign.slug === activeCampaignSlug)) {
      return activeCampaignSlug;
    }
    return "";
  }, [activeCampaignSlug, campaigns]);

  const hasRealCampaigns = realCampaigns.length > 0;
  const disabled = campaigns.length === 0;

  return (
    <label className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
      <span>Campaign</span>
      <select
        aria-label="Select campaign"
        value={currentValue}
        disabled={disabled}
        onChange={(event) => {
          const nextCampaignSlug = event.currentTarget.value;
          if (!nextCampaignSlug) return;
          if (nextCampaignSlug === "__new__") return;
          selectCampaign(nextCampaignSlug);
        }}
        className="control-select min-w-48 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wider"
      >
        <option value="">{campaigns.length === 0 ? "No campaigns" : "Select campaign"}</option>
        {campaigns.map((campaign) => (
          <option key={campaign.slug} value={campaign.slug}>
            {campaign.name}
          </option>
        ))}
        {hasRealCampaigns ? <option value="__new__">+ New Campaign</option> : null}
      </select>
    </label>
  );
}
