import Link from "next/link";
import { Calendar, ChevronRight } from "lucide-react";
import { StatusChip } from "@/components/shared/status-chip";
import type { CampaignSummary } from "@/lib/types";

type CampaignOverviewProps = {
  campaign: CampaignSummary;
};

export function CampaignOverview({ campaign }: CampaignOverviewProps) {
  const artifactTone = (status: "available" | "missing" | "unavailable") => {
    if (status === "available") return "success" as const;
    if (status === "unavailable") return "danger" as const;
    return "warning" as const;
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-4xl font-serif">{campaign.name}</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">{campaign.description}</p>
      </header>

      <div className="space-y-4">
        {campaign.sessions.map((session, index) => (
          <Link
            key={session.id}
            href={`/campaigns/${campaign.slug}/sessions/${session.id}`}
            className="group block rounded-xl card-glass p-6 transition-all hover:border-primary/40"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase tracking-widest text-primary/80">Session {index + 1}</div>
                <h2 className="mt-1 text-2xl font-serif group-hover:text-primary">{session.title}</h2>
                <div className="mt-3 flex flex-wrap items-center gap-4 text-xs uppercase tracking-wider text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{session.date}</span>
                  <StatusChip label={session.status === "in_progress" ? "In progress" : "Completed"} tone={session.status === "in_progress" ? "warning" : "neutral"} />
                  <StatusChip label={`Transcript ${session.artifacts.transcript}`} tone={artifactTone(session.artifacts.transcript)} />
                  <StatusChip label={`Recap ${session.artifacts.recap}`} tone={artifactTone(session.artifacts.recap)} />
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-primary opacity-70" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
