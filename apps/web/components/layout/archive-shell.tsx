import type { ReactNode } from "react";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";

type ArchiveShellProps = {
  section: string;
  activePath: string;
  campaignName?: string;
  children: ReactNode;
};

export function ArchiveShell({ section, activePath, campaignName, children }: ArchiveShellProps) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <AppSidebar activePath={activePath} />
      <main className="flex min-h-screen flex-1 flex-col overflow-hidden">
        <AppHeader section={section} campaignName={campaignName} />
        <div className="custom-scrollbar mx-auto w-full max-w-7xl flex-1 overflow-y-auto p-8">{children}</div>
      </main>
    </div>
  );
}
