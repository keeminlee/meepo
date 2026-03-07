import Link from "next/link";
import { Calendar, ChevronRight, FileText, MessageSquare } from "lucide-react";
import type { CampaignSummary } from "@/lib/types";

type CampaignOverviewProps = {
  campaign: CampaignSummary;
};

export function CampaignOverview({ campaign }: CampaignOverviewProps) {
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
            href={`/sessions/${session.id}`}
            className="group block rounded-xl card-glass p-6 transition-all hover:border-primary/40"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase tracking-widest text-primary/80">Session {index + 1}</div>
                <h2 className="mt-1 text-2xl font-serif group-hover:text-primary">{session.title}</h2>
                <div className="mt-3 flex flex-wrap items-center gap-4 text-xs uppercase tracking-wider text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{session.date}</span>
                  <span className={`inline-flex items-center gap-1 ${session.transcriptAvailable ? "text-green-400" : "text-amber-300"}`}><MessageSquare className="h-3.5 w-3.5" />Transcript</span>
                  <span className={`inline-flex items-center gap-1 ${session.recapAvailable ? "text-blue-300" : "text-amber-300"}`}><FileText className="h-3.5 w-3.5" />Recap</span>
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
