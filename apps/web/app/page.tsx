import { LANDING_FEATURES, LandingPage, buildConstellationModel } from "@/components/landing/landing-page";
import { getWebDashboardModel } from "@/lib/server/campaignReaders";
import { getAuthSession } from "@/lib/server/getAuthSession";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getAuthSession();
  const userId = session?.user?.id ?? null;

  let stars: ReturnType<typeof buildConstellationModel>["stars"] = [];
  let lines: ReturnType<typeof buildConstellationModel>["lines"] = [];

  try {
    const model = await getWebDashboardModel();
    if (model.authState === "ok" || model.authState === "signed_in_no_sessions") {
      const constellation = buildConstellationModel({
        campaigns: model.campaigns.map((campaign) => ({
          slug: campaign.slug,
          name: campaign.name,
          sessions: campaign.sessions.map((session) => ({
            id: session.id,
            title: session.title,
            date: session.date,
            startedByUserId: session.startedByUserId ?? null,
          })),
        })),
        currentUserId: userId,
      });
      stars = constellation.stars;
      lines = constellation.lines;
    }
  } catch {
    // Landing page should still render for unsigned/fallback states.
  }

  return <LandingPage features={LANDING_FEATURES} stars={stars} lines={lines} />;
}
