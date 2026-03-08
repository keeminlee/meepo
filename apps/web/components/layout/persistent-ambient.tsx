"use client";

import { usePathname } from "next/navigation";
import CelestialHeroBackground from "@/components/landing/celestial-hero-background";
import { useAmbientPreferences } from "@/providers/preferences-provider";

function resolveAmbientProfile(pathname: string): "landing" | "archive" {
  if (pathname === "/") return "landing";
  return "archive";
}

export function PersistentAmbient() {
  const pathname = usePathname();
  const profile = resolveAmbientProfile(pathname);
  const { effectiveAmbientMotionEnabled } = useAmbientPreferences();

  return (
    <div className={`ambient-root ambient-profile-${profile}`} aria-hidden="true">
      <CelestialHeroBackground
        className="ambient-sky"
        profile={profile}
        motionEnabled={effectiveAmbientMotionEnabled}
        parallaxEnabled={effectiveAmbientMotionEnabled}
      />
      <div className="ambient-veil ambient-veil-landing" />
      <div className="ambient-veil ambient-veil-archive" />
    </div>
  );
}
