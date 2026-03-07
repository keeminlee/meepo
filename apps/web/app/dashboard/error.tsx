"use client";

import { ArchiveShell } from "@/components/layout/archive-shell";
import { RouteError } from "@/components/shared/route-error";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ArchiveShell section="Dashboard" activePath="/dashboard">
      <RouteError title="Dashboard failed to load" error={error} reset={reset} />
    </ArchiveShell>
  );
}
