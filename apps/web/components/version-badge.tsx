import { APP_VERSION } from "@/lib/version";

export default function VersionBadge() {
  if (!APP_VERSION) return null;

  return (
    <div
      style={{
        position: "fixed",
          bottom: 10,
          left: 10,
          padding: "3px 8px",
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,0.16)",
          background: "rgba(8,12,20,0.72)",
          color: "rgba(255,255,255,0.92)",
        fontSize: "11px",
          letterSpacing: "0.03em",
          opacity: 0.92,
        fontFamily: "monospace",
        zIndex: 9999,
        pointerEvents: "none",
      }}
      aria-label="app-version"
    >
        v{APP_VERSION}
    </div>
  );
}
