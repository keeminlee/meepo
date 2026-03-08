"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_AMBIENT_PREFERENCES,
  readAmbientPreferences,
  writeAmbientPreferences,
  type AmbientPreferences,
} from "@/lib/client/preferences";

type AmbientPreferencesContextValue = {
  ambientMotionEnabled: boolean;
  showMeepo: boolean;
  prefersReducedMotion: boolean;
  effectiveAmbientMotionEnabled: boolean;
  hasHydrated: boolean;
  setAmbientMotionEnabled: (value: boolean) => void;
  setShowMeepo: (value: boolean) => void;
};

const AmbientPreferencesContext = createContext<AmbientPreferencesContextValue | null>(null);

type AmbientPreferencesProviderProps = {
  children: ReactNode;
};

function getInitialReducedMotionValue(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function AmbientPreferencesProvider({ children }: AmbientPreferencesProviderProps) {
  const [preferences, setPreferences] = useState<AmbientPreferences>(DEFAULT_AMBIENT_PREFERENCES);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(getInitialReducedMotionValue);
  const [hasHydrated, setHasHydrated] = useState(false);

  useLayoutEffect(() => {
    const saved = readAmbientPreferences(window.localStorage);
    setPreferences((current) => {
      if (
        current.ambientMotionEnabled === saved.ambientMotionEnabled &&
        current.showMeepo === saved.showMeepo
      ) {
        return current;
      }
      return saved;
    });

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    setPrefersReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener("change", onChange);
    setHasHydrated(true);

    return () => {
      mediaQuery.removeEventListener("change", onChange);
    };
  }, []);

  const setAmbientMotionEnabled = (value: boolean) => {
    setPreferences((current) => {
      const next = { ...current, ambientMotionEnabled: value };
      if (typeof window !== "undefined") {
        writeAmbientPreferences(window.localStorage, next);
      }
      return next;
    });
  };

  const setShowMeepo = (value: boolean) => {
    setPreferences((current) => {
      const next = { ...current, showMeepo: value };
      if (typeof window !== "undefined") {
        writeAmbientPreferences(window.localStorage, next);
      }
      return next;
    });
  };

  const value = useMemo<AmbientPreferencesContextValue>(
    () => ({
      ambientMotionEnabled: preferences.ambientMotionEnabled,
      showMeepo: preferences.showMeepo,
      prefersReducedMotion,
      effectiveAmbientMotionEnabled: preferences.ambientMotionEnabled && !prefersReducedMotion,
      hasHydrated,
      setAmbientMotionEnabled,
      setShowMeepo,
    }),
    [preferences, prefersReducedMotion, hasHydrated]
  );

  return (
    <AmbientPreferencesContext.Provider value={value}>
      {children}
    </AmbientPreferencesContext.Provider>
  );
}

export function useAmbientPreferences(): AmbientPreferencesContextValue {
  const context = useContext(AmbientPreferencesContext);
  if (!context) {
    throw new Error("useAmbientPreferences must be used inside AmbientPreferencesProvider.");
  }
  return context;
}

export function MeepoVisibilityGate({ children }: { children: ReactNode }) {
  const { showMeepo } = useAmbientPreferences();
  if (!showMeepo) {
    return null;
  }
  return <>{children}</>;
}
