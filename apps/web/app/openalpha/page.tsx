import { InteractionLayer } from "@/components/openalpha/InteractionLayer";
import { NarrativeDebugPanel } from "@/components/openalpha/NarrativeDebugPanel";
import { OverlayLayer } from "@/components/openalpha/OverlayLayer";
import { SkyLayer } from "@/components/openalpha/SkyLayer";
import styles from "@/components/openalpha/openalpha.module.css";

export default function OpenAlphaPage() {
  return (
    <main className={styles.openAlphaRoot} aria-label="Open Alpha canvas">
      <SkyLayer />
      <InteractionLayer />
      <OverlayLayer />
      <NarrativeDebugPanel />
    </main>
  );
}
