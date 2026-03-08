"use client";

import { useAmbientPreferences } from "@/providers/preferences-provider";

type ToggleControlProps = {
  id: string;
  label: string;
  helperText: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
};

function ToggleControl({ id, label, helperText, checked, onChange, disabled = false }: ToggleControlProps) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/35 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <label htmlFor={id} className="text-sm font-semibold text-foreground">
            {label}
          </label>
          <p id={`${id}-help`} className="text-xs text-muted-foreground">
            {helperText}
          </p>
        </div>
        <label htmlFor={id} className="relative inline-flex cursor-pointer items-center">
          <input
            id={id}
            type="checkbox"
            role="switch"
            aria-describedby={`${id}-help`}
            checked={checked}
            onChange={(event) => onChange(event.currentTarget.checked)}
            disabled={disabled}
            className="peer sr-only"
          />
          <span className="h-6 w-11 rounded-full border border-border bg-muted transition-colors peer-checked:bg-primary peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-primary/70 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background peer-disabled:cursor-not-allowed peer-disabled:opacity-60" />
          <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-foreground transition-transform peer-checked:translate-x-5 peer-checked:bg-primary-foreground peer-disabled:opacity-60" />
        </label>
      </div>
    </div>
  );
}

export function PreferencesPanel() {
  const {
    ambientMotionEnabled,
    showMeepo,
    hasHydrated,
    prefersReducedMotion,
    effectiveAmbientMotionEnabled,
    setAmbientMotionEnabled,
    setShowMeepo,
  } = useAmbientPreferences();

  return (
    <section className="rounded-2xl card-glass p-6" aria-busy={!hasHydrated}>
      <h2 className="text-xl font-serif">Ambient Settings</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Personalize atmospheric behavior across the archive. Preferences are saved locally and apply instantly.
      </p>

      <div className="mt-5 space-y-4">
        <ToggleControl
          id="ambient-motion-toggle"
          label="Enable ambient motion"
          helperText="When off, the current starfield stays visible and stable: no parallax, no drift, no animation loop."
          checked={ambientMotionEnabled}
          onChange={setAmbientMotionEnabled}
        />

        <ToggleControl
          id="show-meepo-toggle"
          label="Show Meepo"
          helperText="Prepares the future Meepo render gate. When off, Meepo surfaces will not render."
          checked={showMeepo}
          onChange={setShowMeepo}
        />
      </div>

      <div className="mt-4 rounded-xl border border-border/70 bg-background/35 px-4 py-3 text-xs text-muted-foreground">
        <p>
          Runtime motion status: <span className="font-semibold text-foreground">{effectiveAmbientMotionEnabled ? "enabled" : "disabled"}</span>
        </p>
        <p className="mt-1">
          System reduced-motion: <span className="font-semibold text-foreground">{prefersReducedMotion ? "on" : "off"}</span>. If on, ambient motion stays disabled regardless of the toggle value.
        </p>
      </div>
    </section>
  );
}
