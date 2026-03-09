import Link from "next/link";
import { ArrowRight, BookOpen, Sparkles, Star } from "lucide-react";
import type { ComponentType } from "react";

type LandingFeature = {
  icon: ComponentType<{ className?: string }>;
  text: string;
};

type LandingPageProps = {
  features: LandingFeature[];
  stars?: Array<{
    id: string;
    campaignSlug: string;
    campaignName: string;
    sessionTitle: string;
    isUserSession: boolean;
    x: number;
    y: number;
  }>;
  lines?: Array<{ fromId: string; toId: string }>;
};

function byCampaignThenDate<T extends { campaignSlug: string; date: string; id: string }>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => {
    if (a.campaignSlug !== b.campaignSlug) return a.campaignSlug.localeCompare(b.campaignSlug);
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.id.localeCompare(b.id);
  });
}

export function buildConstellationModel(args: {
  campaigns: Array<{
    slug: string;
    name: string;
    sessions: Array<{ id: string; title: string; date: string; startedByUserId?: string | null }>;
  }>;
  currentUserId?: string | null;
}): {
  stars: Array<{
    id: string;
    campaignSlug: string;
    campaignName: string;
    sessionTitle: string;
    isUserSession: boolean;
    x: number;
    y: number;
  }>;
  lines: Array<{ fromId: string; toId: string }>;
} {
  const sessions = byCampaignThenDate(
    args.campaigns.flatMap((campaign) =>
      campaign.sessions.map((session) => ({
        id: session.id,
        campaignSlug: campaign.slug,
        campaignName: campaign.name,
        title: session.title,
        date: session.date,
        isUserSession: Boolean(args.currentUserId && session.startedByUserId === args.currentUserId),
      }))
    )
  );

  const stars = sessions.slice(0, 36).map((session, index) => {
    const col = index % 6;
    const row = Math.floor(index / 6);
    const jitterX = ((index * 37) % 7) - 3;
    const jitterY = ((index * 53) % 7) - 3;
    return {
      id: session.id,
      campaignSlug: session.campaignSlug,
      campaignName: session.campaignName,
      sessionTitle: session.title,
      isUserSession: session.isUserSession,
      x: 40 + col * 3.6 + jitterX * 0.35,
      y: 22 + row * 3.2 + jitterY * 0.3,
    };
  });

  const byCampaign = new Map<string, typeof stars>();
  for (const star of stars) {
    if (!byCampaign.has(star.campaignSlug)) {
      byCampaign.set(star.campaignSlug, []);
    }
    byCampaign.get(star.campaignSlug)!.push(star);
  }

  const lines: Array<{ fromId: string; toId: string }> = [];
  for (const campaignStars of byCampaign.values()) {
    for (let i = 1; i < campaignStars.length; i += 1) {
      lines.push({ fromId: campaignStars[i - 1]!.id, toId: campaignStars[i]!.id });
    }
  }

  return { stars, lines };
}

export function LandingPage(props: LandingPageProps) {
  const starMap = new Map((props.stars ?? []).map((star) => [star.id, star]));
  return (
    <div className="relative min-h-screen selection:bg-primary/30">
      {props.stars && props.stars.length > 0 ? (
        <div className="pointer-events-none absolute inset-0 z-[1] opacity-90">
          <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {props.lines?.map((line) => {
              const from = starMap.get(line.fromId);
              const to = starMap.get(line.toId);
              if (!from || !to) return null;
              return (
                <line
                  key={`${line.fromId}:${line.toId}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke="rgba(255, 241, 209, 0.12)"
                  strokeWidth={0.14}
                />
              );
            })}
            {props.stars.map((star) => (
              <g key={star.id}>
                <circle
                  cx={star.x}
                  cy={star.y}
                  r={star.isUserSession ? 0.42 : 0.24}
                  fill={star.isUserSession ? "rgba(255, 245, 224, 0.6)" : "rgba(255, 245, 224, 0.36)"}
                />
              </g>
            ))}
          </svg>
        </div>
      ) : null}
      <section className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <div className="flex items-center justify-center space-x-2">
          <Sparkles className="h-6 w-6 animate-pulse text-primary" />
          <span className="text-sm uppercase tracking-widest text-primary/80">The Celestial Archive</span>
        </div>
        <h1 className="mt-6 text-7xl font-serif italic tracking-tight md:text-9xl">Meepo</h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-2xl">
          A living chronicle of D&D adventures. Every session leaves a star behind.
        </p>
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
          <Link href="/dashboard" className="button-primary rounded-full px-8 py-4 text-lg font-semibold">
            <span className="inline-flex items-center">
              Start Your Chronicle
              <ArrowRight className="ml-2 h-5 w-5" />
            </span>
          </Link>
          <a href="#features" className="rounded-full border border-border px-8 py-4 text-lg text-foreground/80 hover:bg-white/5">
            Learn More
          </a>
        </div>
      </section>

      <section id="features" className="relative z-10 mx-auto max-w-5xl px-6 pb-24">
        <div className="rounded-2xl card-glass p-8">
          <h2 className="text-3xl font-serif">What You Can See Today</h2>
          <ul className="mt-6 grid gap-4 md:grid-cols-3">
            {props.features.map((feature) => (
              <li key={feature.text} className="rounded-xl border border-border bg-muted/20 p-4 text-left">
                <feature.icon className="h-5 w-5 text-primary/70" />
                <p className="mt-3 text-sm text-foreground/85">{feature.text}</p>
              </li>
            ))}
          </ul>
          <div className="mt-8 text-xs uppercase tracking-widest text-muted-foreground">
            <span className="mr-2 inline-flex items-center"><Star className="mr-1 h-3 w-3 fill-primary text-primary" />Dark Chronicle Shell</span>
            <span className="mr-2">Celestial Landing</span>
            <span>Stable Theme Tokens</span>
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-border py-10 text-center text-sm text-muted-foreground">
        Meepo Archive Viewer - Track B Shell
      </footer>
    </div>
  );
}

export const LANDING_FEATURES: LandingFeature[] = [
  { icon: BookOpen, text: "Session transcripts preserved in detail" },
  { icon: Star, text: "Multiview recaps for every playstyle" },
  { icon: Sparkles, text: "A growing campaign history at your fingertips" },
];
