import Link from "next/link";
import { ArchiveShell } from "@/components/layout/archive-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusChip } from "@/components/shared/status-chip";
import { getCampaignsApi } from "@/lib/api/campaigns";
import { WebApiError } from "@/lib/api/http";
import { getAuthSession } from "@/lib/server/getAuthSession";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DashboardPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const session = await getAuthSession();
  let model: Awaited<ReturnType<typeof getCampaignsApi>>["dashboard"];

  try {
    ({ dashboard: model } = await getCampaignsApi(query));
  } catch (error) {
    if (error instanceof WebApiError && error.status === 401 && error.code === "unauthorized") {
      const signedIn = Boolean(session?.user?.id);
      return (
        <ArchiveShell section="Dashboard">
          <EmptyState
            title={signedIn ? "Finishing access setup" : "Sign in to view campaigns"}
            description={
              signedIn
                ? "Your account is signed in, but authorized guild access is still being resolved."
                : "Authenticate with Discord to access campaign dashboards."
            }
          />
        </ArchiveShell>
      );
    }
    throw error;
  }

  if (model.campaigns.length === 0) {
    if (model.authState === "signed_in_no_authorized_campaigns") {
      return (
        <ArchiveShell section="Dashboard">
          <EmptyState
            title="Signed in, but no authorized campaigns resolved"
            description="Server authorization returned zero accessible campaigns for this account. Check session user id and guild authorization mapping."
          />
        </ArchiveShell>
      );
    }

    return (
      <ArchiveShell section="Dashboard">
        <EmptyState
          title="No campaigns yet"
          description="Create your first campaign to begin building your archive."
        />
      </ArchiveShell>
    );
  }

  return (
    <ArchiveShell section="Dashboard">
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
              href={`/campaigns/${campaign.slug}/sessions`}
              className="rounded-xl card-glass p-6 transition-all hover:border-primary/40"
            >
              <div className="text-xs uppercase tracking-widest text-primary/80">{campaign.guildName}</div>
              <h2 className="mt-1 text-2xl font-serif">{campaign.name}</h2>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusChip label={`${campaign.sessionCount} sessions`} tone="info" />
                {campaign.sessions.some((session) => session.status === "in_progress") ? (
                  <StatusChip label="Active" tone="warning" />
                ) : (
                  <StatusChip label="Archive stable" tone="success" />
                )}
              </div>
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
