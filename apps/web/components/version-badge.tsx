import { APP_VERSION } from "@/lib/version";

export default function VersionBadge() {
  if (!APP_VERSION) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 8,
        left: 12,
        fontSize: "11px",
        opacity: 0.6,
        fontFamily: "monospace",
        zIndex: 9999,
        pointerEvents: "none",
      }}
      aria-label="app-version"
    >
      {APP_VERSION}
    </div>
  );
}
