import Link from "next/link";
import { ChevronRight, Clock } from "lucide-react";
import { StatusChip } from "@/components/shared/status-chip";
import type { SessionDetail } from "@/lib/types";

type SessionHeaderProps = {
  session: SessionDetail;
};

export function SessionHeader({ session }: SessionHeaderProps) {
  const statusTone = session.status === "in_progress" ? "warning" : "success";
  const sessionLabel = session.title.trim().length > 0 ? session.title : "Untitled Session";

  return (
    <header className="space-y-4">
      <nav className="flex flex-wrap items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground">
        <Link href="/dashboard" className="hover:text-primary">Dashboard</Link>
        <ChevronRight className="h-3 w-3" />
          <Link href={`/campaigns/${session.campaignSlug}/sessions`} className="hover:text-primary">{session.campaignSlug}</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground/80">{sessionLabel}</span>
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-5xl font-serif italic">{sessionLabel}</h1>
          <p className="mt-2 text-sm uppercase tracking-widest text-primary/70">{session.campaignName}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusChip label={session.status === "in_progress" ? "In progress" : "Completed"} tone={statusTone} />
            <StatusChip label={`Source ${session.source}`} tone="info" />
            <StatusChip label={session.artifacts.recap === "available" ? "Recap ready" : `Recap ${session.artifacts.recap}`} tone={session.artifacts.recap === "available" ? "success" : session.artifacts.recap === "unavailable" ? "danger" : "warning"} />
            <StatusChip label={session.artifacts.transcript === "available" ? "Transcript ready" : `Transcript ${session.artifacts.transcript}`} tone={session.artifacts.transcript === "available" ? "success" : session.artifacts.transcript === "unavailable" ? "danger" : "warning"} />
          </div>
        </div>
        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          Recorded {session.date}
        </div>
      </div>
    </header>
  );
}
