import Link from "next/link";
import { ArchiveShell } from "@/components/layout/archive-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusChip } from "@/components/shared/status-chip";
import { getCampaignsApi } from "@/lib/api/campaigns";
import { WebApiError } from "@/lib/api/http";
import { getAuthSession } from "@/lib/server/getAuthSession";

export const dynamic = "force-dynamic";

const DISCORD_SIGN_IN_URL = "/api/auth/signin/discord";
const DISCORD_INVITE_URL = "https://discord.com/oauth2/authorize?client_id=1470521616747200524&permissions=3214336&integration_type=0&scope=bot+applications.commands";

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
            title={signedIn ? "Signed in, but access is unresolved" : "Sign in with Discord"}
            description={
              signedIn
                ? "Try reloading. If access still fails, verify your Discord account has guild membership for the target server."
                : "Sign in with Discord to access your campaigns."
            }
            actionLabel={signedIn ? undefined : "Sign in with Discord"}
            actionHref={signedIn ? undefined : DISCORD_SIGN_IN_URL}
          />
        </ArchiveShell>
      );
    }
    throw error;
  }

  const isUnsigned = model.authState === "unsigned";
  const visibleCampaigns = isUnsigned
    ? model.campaigns.filter((campaign) => campaign.slug === "demo")
    : model.campaigns;

  if (model.authState === "signed_in_no_authorized_guilds" || model.authState === "signed_in_no_meepo_installed") {
    return (
      <ArchiveShell section="Dashboard">
        <EmptyState
          title="Add StarStory to a Discord server"
          description="Add StarStory to a Discord server to begin capturing sessions."
          actionLabel="Invite StarStory"
          actionHref={DISCORD_INVITE_URL}
        />
      </ArchiveShell>
    );
  }

  if (model.authState === "signed_in_no_sessions") {
    return (
      <ArchiveShell section="Dashboard">
        <EmptyState
          title="No sessions yet"
          description="Start your first session in Discord with /starstory showtime start"
        />
      </ArchiveShell>
    );
  }

  const guildBuckets = new Map<string, {
    guildName: string;
    guildIconUrl: string | null;
    campaigns: Array<(typeof visibleCampaigns)[number]>;
  }>();
  for (const campaign of visibleCampaigns) {
    const key = campaign.guildId ?? campaign.guildName;
    if (!guildBuckets.has(key)) {
      guildBuckets.set(key, {
        guildName: campaign.guildName,
        guildIconUrl: campaign.guildIconUrl ?? null,
        campaigns: [],
      });
    }
    guildBuckets.get(key)!.campaigns.push(campaign);
  }

  return (
    <ArchiveShell section="Dashboard">
      <div className="space-y-8">
        <h1 className="text-4xl font-serif">Dashboard</h1>
        {isUnsigned ? (
          <EmptyState
            title="Sign in with Discord"
            description="Sign in with Discord to access your campaigns."
            actionLabel="Sign in with Discord"
            actionHref={DISCORD_SIGN_IN_URL}
          />
        ) : (
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
        )}

        <div className="space-y-8">
          {Array.from(guildBuckets.entries()).map(([key, bucket]) => (
            <section key={key} className="space-y-3">
              <h2 className="flex items-center gap-3 text-2xl font-serif">
                {bucket.guildIconUrl ? (
                  <img
                    src={bucket.guildIconUrl}
                    alt={`${bucket.guildName} icon`}
                    className="h-8 w-8 rounded-full border border-border/60 object-cover"
                    loading="lazy"
                  />
                ) : null}
                <span>{bucket.guildName}</span>
              </h2>
              <div className="grid gap-4">
                {bucket.campaigns.map((campaign) => (
                  <Link
                    key={`${campaign.slug}::${campaign.guildId ?? ""}`}
                    href={{
                      pathname: `/campaigns/${campaign.slug}/sessions`,
                      ...(campaign.guildId ? { query: { guild_id: campaign.guildId } } : {}),
                    }}
                    className="rounded-xl card-glass p-6 transition-all hover:border-primary/40"
                  >
                    <div className="mt-1 flex items-center gap-2">
                      <h3 className="text-2xl font-serif">{campaign.name}</h3>
                      {campaign.isDm ? (
                        <span className="rounded-full border border-emerald-300/40 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-200">
                          DM
                        </span>
                      ) : null}
                    </div>
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
            </section>
          ))}
        </div>
      </div>
    </ArchiveShell>
  );
}
