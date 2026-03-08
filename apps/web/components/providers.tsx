"use client";

import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { AmbientPreferencesProvider } from "@/providers/preferences-provider";
import { ActiveCampaignGate } from "@/components/guards/active-campaign-gate";

type ProvidersProps = {
  children: ReactNode;
};

export function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider>
      <ActiveCampaignGate>
        <AmbientPreferencesProvider>{children}</AmbientPreferencesProvider>
      </ActiveCampaignGate>
    </SessionProvider>
  );
}
