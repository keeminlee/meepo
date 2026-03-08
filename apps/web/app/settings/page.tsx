import { ArchiveShell } from "@/components/layout/archive-shell";
import { PreferencesPanel } from "@/components/settings/preferences-panel";

export default function SettingsPage() {
  return (
    <ArchiveShell section="Settings">
      <div className="space-y-8 pb-16">
        <header className="space-y-2">
          <h1 className="text-4xl font-serif">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Configure archive atmosphere preferences. Changes apply instantly and persist across routes and reloads.
          </p>
        </header>

        <PreferencesPanel />
      </div>
    </ArchiveShell>
  );
}
