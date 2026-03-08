import type { ReactNode } from "react";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";

type ArchiveShellProps = {
  section: string;
  campaignName?: string;
  children: ReactNode;
};

export function ArchiveShell({ section, campaignName, children }: ArchiveShellProps) {
  return (
    <div className="archive-shell-root flex min-h-screen text-foreground">
      <AppSidebar />
      <main className="flex min-h-screen flex-1 flex-col overflow-hidden">
        <AppHeader section={section} campaignName={campaignName} />
        <div className="archive-shell-transition-target custom-scrollbar mx-auto w-full max-w-7xl flex-1 overflow-y-auto p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
