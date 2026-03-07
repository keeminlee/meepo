import { ArchiveShell } from "@/components/layout/archive-shell";
import { RouteLoading } from "@/components/shared/route-loading";

export default function Loading() {
  return (
    <ArchiveShell section="Dashboard" activePath="/dashboard">
      <RouteLoading label="Preparing dashboard" />
    </ArchiveShell>
  );
}
