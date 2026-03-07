import { ArchiveShell } from "@/components/layout/archive-shell";
import { RouteLoading } from "@/components/shared/route-loading";

export default function Loading() {
  return (
    <ArchiveShell section="Session" activePath="/sessions">
      <RouteLoading label="Loading session detail" />
    </ArchiveShell>
  );
}
