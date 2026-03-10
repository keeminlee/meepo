"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Providers } from "@/components/providers";
import { PersistentAmbient } from "@/components/layout/persistent-ambient";
import VersionBadge from "@/components/version-badge";

type RootChromeProps = {
  children: ReactNode;
};

export function RootChrome({ children }: RootChromeProps) {
  const pathname = usePathname();

  if (pathname.startsWith("/openalpha")) {
    return <>{children}</>;
  }

  return (
    <Providers>
      <PersistentAmbient />
      <div className="app-foreground-root">{children}</div>
      <VersionBadge />
    </Providers>
  );
}
