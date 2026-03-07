import { Sparkles } from "lucide-react";

type AppHeaderProps = {
  section: string;
  campaignName?: string;
};

export function AppHeader({ section, campaignName }: AppHeaderProps) {
  return (
    <header className="h-16 border-b border-border bg-background/50 px-8 backdrop-blur-md">
      <div className="mx-auto flex h-full w-full max-w-7xl items-center justify-between">
        <div className="flex items-center gap-3 text-sm uppercase tracking-widest text-muted-foreground">
          <span>{section}</span>
          {campaignName ? <span className="text-primary/70">/ {campaignName}</span> : null}
        </div>
        <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          Chronicle Mode
        </div>
      </div>
    </header>
  );
}
