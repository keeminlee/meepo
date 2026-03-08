"use client";

import { Sparkles } from "lucide-react";
import { signIn, signOut, useSession } from "next-auth/react";
import { CampaignSelector } from "@/components/layout/campaign-selector";

type AppHeaderProps = {
  section: string;
  campaignName?: string;
};

export function AppHeader({ section, campaignName }: AppHeaderProps) {
  const { data: session, status } = useSession();
  const signedIn = status === "authenticated";
  const displayName = session?.user?.globalName ?? session?.user?.name ?? "Discord user";

  return (
    <header className="h-16 border-b border-border bg-background/50 px-8 backdrop-blur-md">
      <div className="mx-auto flex h-full w-full max-w-7xl items-center justify-between">
        <div className="flex items-center gap-3 text-sm uppercase tracking-widest text-muted-foreground">
          <span>{section}</span>
          {campaignName ? <span className="text-primary/70">/ {campaignName}</span> : null}
        </div>
        <div className="flex items-center gap-3">
          <CampaignSelector />
          <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Chronicle Mode
          </div>
          {status === "loading" ? (
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Auth loading</span>
          ) : signedIn ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{displayName}</span>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: "/" })}
                className="control-button-ghost rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider"
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => signIn("discord", { callbackUrl: "/dashboard" })}
              className="button-primary rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider"
            >
              Sign in with Discord
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
