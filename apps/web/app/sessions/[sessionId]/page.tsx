import { notFound } from "next/navigation";
import { ArchiveShell } from "@/components/layout/archive-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { RecapTabs } from "@/components/session/recap-tabs";
import { SessionHeader } from "@/components/session/session-header";
import { TranscriptViewer } from "@/components/session/transcript-viewer";
import { getSessionDetail } from "@/lib/server/readers";

type PageProps = {
  params: Promise<{ sessionId: string }>;
};

export default async function SessionPage({ params }: PageProps) {
  const { sessionId } = await params;
  const session = await getSessionDetail(sessionId);

  if (!session) {
    notFound();
  }

  return (
    <ArchiveShell section="Session" activePath="/sessions" campaignName={session.campaignName}>
      <div className="space-y-8 pb-16">
        <SessionHeader session={session} />
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="lg:col-span-7">
            {session.recap ? (
              <RecapTabs recap={session.recap} />
            ) : (
              <EmptyState
                title="Recap unavailable"
                description="Transcript exists, but this session does not have a recap yet."
              />
            )}
          </div>
          <div className="lg:col-span-5">
            {session.transcript.length > 0 ? (
              <TranscriptViewer entries={session.transcript} />
            ) : (
              <EmptyState
                title="Transcript unavailable"
                description="Recap exists, but transcript entries are currently unavailable for this session."
              />
            )}
          </div>
        </div>
      </div>
    </ArchiveShell>
  );
}
