"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, RefreshCw } from "lucide-react";
import { regenerateSessionRecapApi } from "@/lib/api/sessions";
import { WebApiError } from "@/lib/api/http";
import type { RecapTab, SessionRecap } from "@/lib/types";

const TABS: Array<{ id: RecapTab; label: string }> = [
  { id: "concise", label: "Concise" },
  { id: "balanced", label: "Balanced" },
  { id: "detailed", label: "Detailed" },
];

type RecapTabsProps = {
  recap: SessionRecap | null;
  sessionId: string;
  sessionTitle: string;
  campaignSlug: string;
  searchParams?: Record<string, string | string[] | undefined>;
  canRegenerate: boolean;
  showRegenerateUnavailableBanner?: boolean;
  status?: "available" | "missing" | "unavailable";
  emptyDescription?: string;
  warnings?: string[];
};

type BannerState =
  | { tone: "success"; message: string }
  | { tone: "danger"; message: string }
  | null;

function mapRegenerateError(error: unknown): string {
  if (error instanceof WebApiError) {
    if (error.code === "unauthorized") {
      return "This viewer is not authorized for recap regeneration in the current guild scope.";
    }
    if (error.code === "not_found") {
      return "This session is no longer available for regeneration.";
    }
    if (error.code === "transcript_unavailable") {
      return "Recap generation needs transcript data, but transcript lines are currently unavailable.";
    }
    if (error.code === "generation_failed") {
      return "Recap generation failed this time. Please try again in a moment.";
    }
    if (error.code === "openai_unconfigured") {
      return "Recap regeneration is unavailable until OPENAI_API_KEY is configured.";
    }
    if (error.code === "discord_refresh_unconfigured") {
      return "This environment is missing Discord refresh configuration required by generation dependencies.";
    }
  }

  return "Recap regeneration failed. Please try again.";
}

function triggerDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function toRecapTxt(args: {
  recap: SessionRecap | null;
  sessionId: string;
  sessionTitle: string;
  campaignSlug: string;
}): string {
  const title = args.sessionTitle.trim().length > 0 ? args.sessionTitle : "Untitled Session";
  if (!args.recap) {
    return `Session: ${title}\nSession ID: ${args.sessionId}\nCampaign: ${args.campaignSlug}\n\nNo recap available.`;
  }

  return [
    `Session: ${title}`,
    `Session ID: ${args.sessionId}`,
    `Campaign: ${args.campaignSlug}`,
    `Generated At: ${args.recap.generatedAt}`,
    `Model: ${args.recap.modelVersion}`,
    "",
    "[Concise]",
    args.recap.concise,
    "",
    "[Balanced]",
    args.recap.balanced,
    "",
    "[Detailed]",
    args.recap.detailed,
  ].join("\n");
}

function resolveDefaultTab(recap: SessionRecap | null): RecapTab {
  if (!recap) return "balanced";
  if (recap.balanced.trim().length > 0) return "balanced";
  if (recap.concise.trim().length > 0) return "concise";
  if (recap.detailed.trim().length > 0) return "detailed";
  return "balanced";
}

export function RecapTabs({
  recap,
  sessionId,
  sessionTitle,
  campaignSlug,
  searchParams,
  canRegenerate,
  showRegenerateUnavailableBanner = true,
  status = "available",
  emptyDescription,
  warnings = [],
}: RecapTabsProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<RecapTab>(resolveDefaultTab(recap));
  const [isPending, setIsPending] = useState(false);
  const [banner, setBanner] = useState<BannerState>(
    canRegenerate || !showRegenerateUnavailableBanner
      ? null
      : {
          tone: "danger",
          message: "Recap regeneration is unavailable until OPENAI_API_KEY is configured.",
        }
  );

  const availableTabs = useMemo(() => {
    if (!recap) {
      return {
        concise: false,
        balanced: false,
        detailed: false,
      } as const;
    }

    return {
      concise: recap.concise.trim().length > 0,
      balanced: recap.balanced.trim().length > 0,
      detailed: recap.detailed.trim().length > 0,
    } as const;
  }, [recap]);

  useEffect(() => {
    if (!availableTabs[activeTab]) {
      setActiveTab(resolveDefaultTab(recap));
    }
  }, [activeTab, availableTabs, recap]);

  async function handleRegenerateRecap() {
    setIsPending(true);
    setBanner(null);
    try {
      await regenerateSessionRecapApi(
        sessionId,
        { reason: "manual-web-regenerate" },
        searchParams
      );
      setBanner({
        tone: "success",
        message: "Recap regenerated successfully.",
      });
      router.refresh();
    } catch (error) {
      setBanner({
        tone: "danger",
        message: mapRegenerateError(error),
      });
    } finally {
      setIsPending(false);
    }
  }

  const recapBaseName = `${campaignSlug}-${sessionId}-recap`;
  const activeRecapText = recap ? recap[activeTab] : "";
  const isTabEnabled = (tab: RecapTab) => availableTabs[tab];

  return (
    <div className="rounded-2xl card-glass">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="space-y-1">
          <h3 className="font-serif text-lg">Recap</h3>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {recap ? `Model ${recap.modelVersion}` : `Recap ${status}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border bg-background/50 p-1">
            {TABS.map((tab) => {
              const enabled = isTabEnabled(tab.id);
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    if (enabled) setActiveTab(tab.id);
                  }}
                  disabled={!enabled}
                  title={enabled ? tab.label : "This recap style is unavailable"}
                  className={`rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all ${
                    activeTab === tab.id && enabled
                      ? "bg-primary text-primary-foreground"
                      : enabled
                        ? "text-muted-foreground hover:text-foreground"
                        : "cursor-not-allowed text-muted-foreground/40"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={handleRegenerateRecap}
            disabled={isPending || !canRegenerate}
            title={canRegenerate ? "Regenerate recap" : "Recap regeneration is unavailable"}
            className="inline-flex items-center gap-2 rounded-full button-primary px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
            {isPending ? "Regenerating" : "Regenerate"}
          </button>
          <button
            type="button"
            onClick={() =>
              triggerDownload(
                `${recapBaseName}.txt`,
                toRecapTxt({ recap, sessionId, sessionTitle, campaignSlug }),
                "text/plain;charset=utf-8"
              )
            }
            disabled={!recap}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-background/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </button>
        </div>
      </div>
      <div className="space-y-4 p-6">
        {recap ? (
          <>
            <p className="text-lg italic leading-relaxed text-foreground/90">{activeRecapText}</p>
            <div className="rounded-xl border border-border/60 bg-background/35 px-3 py-2 text-[11px] uppercase tracking-widest text-muted-foreground">
              Generated {new Date(recap.generatedAt).toLocaleString()}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {emptyDescription ?? "No recap is currently available for this session."}
          </p>
        )}
        {warnings.length > 0 ? (
          <p className="text-xs text-amber-200/90">Warnings: {warnings[0]}</p>
        ) : null}
        {banner ? (
          <div
            className={`rounded-xl border px-3 py-2 text-sm ${
              banner.tone === "success"
                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                : "border-rose-400/40 bg-rose-400/10 text-rose-200"
            }`}
          >
            {banner.message}
          </div>
        ) : null}
      </div>
    </div>
  );
}
