import Link from "next/link";
import { ArrowLeft, Clock } from "lucide-react";
import type { SessionDetail } from "@/lib/types";

type SessionHeaderProps = {
  session: SessionDetail;
};

export function SessionHeader({ session }: SessionHeaderProps) {
  return (
    <header className="space-y-4">
      <Link href={`/campaigns/${session.campaignSlug}`} className="inline-flex items-center text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to campaign
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-5xl font-serif italic">{session.title}</h1>
          <p className="mt-2 text-sm uppercase tracking-widest text-primary/70">
            {session.campaignName} / {session.source}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          Recorded {session.date}
        </div>
      </div>
    </header>
  );
}
