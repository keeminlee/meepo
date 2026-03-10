"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Clock } from "lucide-react";
import { StatusChip } from "@/components/shared/status-chip";
import type { SessionDetail } from "@/lib/types";
import { formatSessionDisplayTitle } from "@/lib/campaigns/display";
import { updateSessionLabelApi } from "@/lib/api/sessions";
import { WebApiError } from "@/lib/api/http";

type SessionHeaderProps = {
  session: SessionDetail;
  searchParams?: Record<string, string | string[] | undefined>;
};

export function SessionHeader({ session, searchParams }: SessionHeaderProps) {
  const router = useRouter();
  const [label, setLabel] = useState(session.label);
  const [draftLabel, setDraftLabel] = useState(session.label ?? "");
  const [isEditing, setIsEditing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const statusTone = session.status === "in_progress" ? "warning" : "success";
  const sessionLabel = useMemo(
    () => formatSessionDisplayTitle({ label, sessionId: session.id }),
    [label, session.id]
  );
  const statusChips = useMemo(() => {
    const chips = [
      {
        label: session.status === "in_progress" ? "In progress" : "Completed",
        tone: statusTone,
      },
      {
        label: `Source ${session.source}`,
        tone: "info" as const,
      },
      {
        label: `Recap ${session.recapReadiness}`,
        tone:
          session.recapReadiness === "ready"
            ? "success"
            : session.recapReadiness === "failed"
              ? "danger"
              : "warning",
      },
      {
        label:
          session.artifacts.recap === "available"
            ? "Recap ready"
            : `Recap ${session.artifacts.recap}`,
        tone:
          session.artifacts.recap === "available"
            ? "success"
            : session.artifacts.recap === "unavailable"
              ? "danger"
              : "warning",
      },
      {
        label:
          session.artifacts.transcript === "available"
            ? "Transcript ready"
            : `Transcript ${session.artifacts.transcript}`,
        tone:
          session.artifacts.transcript === "available"
            ? "success"
            : session.artifacts.transcript === "unavailable"
              ? "danger"
              : "warning",
      },
    ];

    const seen = new Set<string>();
    return chips.filter((chip) => {
      const key = chip.label.trim().toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [session.artifacts.recap, session.artifacts.transcript, session.recapReadiness, session.source, session.status, statusTone]);

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
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-5xl font-serif italic">{sessionLabel}</h1>
            {session.canWrite ? (
              !isEditing ? (
                <button
                  type="button"
                  className="rounded-full border border-border px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                  onClick={() => {
                    setDraftLabel(label ?? "");
                    setIsEditing(true);
                    setErrorMessage(null);
                  }}
                >
                  Edit label
                </button>
              ) : (
                <form
                  className="inline-flex items-center gap-2"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const previous = label;
                    const normalized = draftLabel.trim();
                    if (normalized.length > 80) {
                      setErrorMessage("Session label must be 80 characters or fewer.");
                      return;
                    }

                    const nextLabel = normalized.length > 0 ? normalized : null;
                    setErrorMessage(null);
                    setLabel(nextLabel);
                    setIsEditing(false);

                    try {
                      await updateSessionLabelApi(session.id, { label: nextLabel }, searchParams);
                    } catch (error) {
                      setLabel(previous);
                      if (error instanceof WebApiError) {
                        setErrorMessage(error.message);
                      } else {
                        setErrorMessage("Unable to update session label right now.");
                      }
                      router.refresh();
                      return;
                    }

                    router.refresh();
                  }}
                >
                  <input
                    value={draftLabel}
                    maxLength={80}
                    onChange={(event) => setDraftLabel(event.currentTarget.value)}
                    className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                  />
                  <button type="submit" className="rounded-full border border-primary/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">Save</button>
                  <button
                    type="button"
                    className="rounded-full border border-border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                    onClick={() => {
                      setDraftLabel(label ?? "");
                      setIsEditing(false);
                      setErrorMessage(null);
                    }}
                  >
                    Cancel
                  </button>
                </form>
              )
            ) : null}
          </div>
          <p className="mt-2 text-sm uppercase tracking-widest text-primary/70">{session.campaignName}</p>
          {errorMessage ? <p className="mt-2 text-sm text-rose-400">{errorMessage}</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {statusChips.map((chip) => (
              <StatusChip key={chip.label} label={chip.label} tone={chip.tone} />
            ))}
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
