"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calendar, ChevronRight } from "lucide-react";
import { StatusChip } from "@/components/shared/status-chip";
import type { CampaignSummary } from "@/lib/types";
import { formatSessionDisplayTitle } from "@/lib/campaigns/display";
import { updateCampaignNameApi } from "@/lib/api/campaigns";
import { updateSessionLabelApi } from "@/lib/api/sessions";
import { WebApiError } from "@/lib/api/http";

type CampaignOverviewProps = {
  campaign: CampaignSummary;
  searchParams?: Record<string, string | string[] | undefined>;
};

export function CampaignOverview({ campaign, searchParams }: CampaignOverviewProps) {
  const router = useRouter();
  const [campaignName, setCampaignName] = useState(campaign.name);
  const [campaignNameDraft, setCampaignNameDraft] = useState(campaign.name);
  const [isEditingCampaignName, setIsEditingCampaignName] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [sessionLabelDraft, setSessionLabelDraft] = useState("");
  const [localSessions, setLocalSessions] = useState(campaign.sessions);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sessionById = useMemo(
    () => new Map(localSessions.map((session) => [session.id, session])),
    [localSessions]
  );

  const scopedSearchParams = useMemo(
    () => ({
      ...(searchParams ?? {}),
      ...(campaign.guildId ? { guild_id: campaign.guildId } : {}),
    }),
    [campaign.guildId, searchParams]
  );

  const artifactTone = (status: "available" | "missing" | "unavailable") => {
    if (status === "available") return "success" as const;
    if (status === "unavailable") return "danger" as const;
    return "warning" as const;
  };

  return (
    <div className="space-y-8">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          {!isEditingCampaignName ? (
            <>
              <h1 className="text-4xl font-serif">{campaignName}</h1>
              {campaign.canWrite ? (
                <button
                  type="button"
                  className="rounded-full border border-border px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                  onClick={() => {
                    setCampaignNameDraft(campaignName);
                    setErrorMessage(null);
                    setIsEditingCampaignName(true);
                  }}
                >
                  Edit name
                </button>
              ) : null}
            </>
          ) : (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                const previousName = campaignName;
                const nextName = campaignNameDraft.trim();

                if (!nextName) {
                  setErrorMessage("Campaign name cannot be empty.");
                  return;
                }

                if (nextName.length > 100) {
                  setErrorMessage("Campaign name must be 100 characters or fewer.");
                  return;
                }

                setErrorMessage(null);
                setCampaignName(nextName);
                setIsEditingCampaignName(false);

                try {
                  const result = await updateCampaignNameApi(campaign.slug, { campaignName: nextName }, scopedSearchParams);
                  setCampaignName(result.campaign.name);
                } catch (error) {
                  setCampaignName(previousName);
                  setCampaignNameDraft(previousName);
                  if (error instanceof WebApiError) {
                    setErrorMessage(error.message);
                  } else {
                    setErrorMessage("Unable to rename campaign right now.");
                  }
                  router.refresh();
                  return;
                }

                router.refresh();
              }}
            >
              <input
                value={campaignNameDraft}
                maxLength={100}
                onChange={(event) => setCampaignNameDraft(event.currentTarget.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="rounded-full border border-primary/40 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary"
              >
                Save
              </button>
              <button
                type="button"
                className="rounded-full border border-border px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                onClick={() => {
                  setCampaignNameDraft(campaignName);
                  setIsEditingCampaignName(false);
                  setErrorMessage(null);
                }}
              >
                Cancel
              </button>
            </form>
          )}
        </div>
        <p className="mt-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">{campaign.slug}</p>
        <p className="mt-2 max-w-3xl text-muted-foreground">{campaign.description}</p>
        {errorMessage ? <p className="mt-2 text-sm text-rose-400">{errorMessage}</p> : null}
      </header>

      <div className="space-y-4">
        {localSessions.map((session) => {
          const displayTitle = formatSessionDisplayTitle({
            label: session.label,
            sessionId: session.id,
          });

          return (
            <div
              key={session.id}
              className="group rounded-xl card-glass p-6 transition-all hover:border-primary/40"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Link
                      href={{
                        pathname: `/campaigns/${campaign.slug}/sessions/${session.id}`,
                        ...(campaign.guildId ? { query: { guild_id: campaign.guildId } } : {}),
                      }}
                      className="text-2xl font-serif group-hover:text-primary"
                    >
                      {displayTitle}
                    </Link>
                    {campaign.canWrite && editingSessionId === session.id ? (
                      <form
                        className="inline-flex items-center gap-2"
                        onSubmit={async (event) => {
                          event.preventDefault();
                          const previous = sessionById.get(session.id);
                          if (!previous) return;

                          const normalized = sessionLabelDraft.trim();
                          if (normalized.length > 80) {
                            setErrorMessage("Session label must be 80 characters or fewer.");
                            return;
                          }

                          setErrorMessage(null);
                          const optimisticLabel = normalized.length > 0 ? normalized : null;
                          setLocalSessions((current) =>
                            current.map((entry) =>
                              entry.id === session.id
                                ? {
                                    ...entry,
                                    label: optimisticLabel,
                                    title: formatSessionDisplayTitle({
                                      label: optimisticLabel,
                                      sessionId: entry.id,
                                    }),
                                  }
                                : entry
                            )
                          );
                          setEditingSessionId(null);

                          try {
                            await updateSessionLabelApi(session.id, { label: optimisticLabel }, scopedSearchParams);
                          } catch (error) {
                            setLocalSessions((current) =>
                              current.map((entry) => (entry.id === session.id ? previous : entry))
                            );
                            if (error instanceof WebApiError) {
                              setErrorMessage(error.message);
                            } else {
                              setErrorMessage("Unable to update session label right now.");
                            }
                            router.refresh();
                            return;
                          }

                          router.refresh();
                        }}
                      >
                        <input
                          value={sessionLabelDraft}
                          maxLength={80}
                          onChange={(event) => setSessionLabelDraft(event.currentTarget.value)}
                          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                        />
                        <button type="submit" className="rounded-full border border-primary/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">Save</button>
                        <button type="button" className="rounded-full border border-border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" onClick={() => setEditingSessionId(null)}>Cancel</button>
                      </form>
                    ) : campaign.canWrite ? (
                      <button
                        type="button"
                        className="rounded-full border border-border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                        onClick={() => {
                          setSessionLabelDraft(session.label ?? "");
                          setEditingSessionId(session.id);
                          setErrorMessage(null);
                        }}
                      >
                        Edit label
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-4 text-xs uppercase tracking-wider text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{session.date}</span>
                    <StatusChip label={session.status === "in_progress" ? "In progress" : "Completed"} tone={session.status === "in_progress" ? "warning" : "neutral"} />
                    <StatusChip label={`Transcript ${session.artifacts.transcript}`} tone={artifactTone(session.artifacts.transcript)} />
                    <StatusChip label={`Recap ${session.artifacts.recap}`} tone={artifactTone(session.artifacts.recap)} />
                  </div>
                </div>
                <Link
                  href={{
                    pathname: `/campaigns/${campaign.slug}/sessions/${session.id}`,
                    ...(campaign.guildId ? { query: { guild_id: campaign.guildId } } : {}),
                  }}
                  className="self-center"
                >
                  <ChevronRight className="h-5 w-5 text-primary opacity-70" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
