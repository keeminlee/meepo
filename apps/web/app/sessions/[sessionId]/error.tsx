"use client";

import { ArchiveShell } from "@/components/layout/archive-shell";
import { RouteError } from "@/components/shared/route-error";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ArchiveShell section="Session" activePath="/sessions">
      <RouteError title="Session view failed to load" error={error} reset={reset} />
    </ArchiveShell>
  );
}
