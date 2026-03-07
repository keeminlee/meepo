import Link from "next/link";
import { ArchiveShell } from "@/components/layout/archive-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { getDashboardModel } from "@/lib/server/readers";

export default async function DashboardPage() {
  const model = await getDashboardModel();

  if (model.campaigns.length === 0) {
    return (
      <ArchiveShell section="Dashboard" activePath="/dashboard">
        <EmptyState
          title="No campaigns yet"
          description="Create your first campaign to begin building your archive."
        />
      </ArchiveShell>
    );
  }

  return (
    <ArchiveShell section="Dashboard" activePath="/dashboard">
      <div className="space-y-8">
        <h1 className="text-4xl font-serif">Dashboard</h1>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="rounded-2xl card-glass p-6">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Total Sessions</div>
            <div className="mt-2 text-4xl font-bold text-primary">{model.totalSessions}</div>
          </div>
          <div className="rounded-2xl card-glass p-6">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Campaigns</div>
            <div className="mt-2 text-4xl font-bold text-primary">{model.campaignCount}</div>
          </div>
          <div className="rounded-2xl card-glass p-6">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Words Recorded</div>
            <div className="mt-2 text-4xl font-bold text-primary">{model.wordsRecorded.toLocaleString()}</div>
          </div>
        </div>

        <div className="grid gap-4">
          {model.campaigns.map((campaign) => (
            <Link
              key={campaign.slug}
              href={`/campaigns/${campaign.slug}`}
              className="rounded-xl card-glass p-6 transition-all hover:border-primary/40"
            >
              <div className="text-xs uppercase tracking-widest text-primary/80">{campaign.guildName}</div>
              <h2 className="mt-1 text-2xl font-serif">{campaign.name}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {campaign.sessionCount} sessions / last session {campaign.lastSessionDate ?? "n/a"}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </ArchiveShell>
  );
}
