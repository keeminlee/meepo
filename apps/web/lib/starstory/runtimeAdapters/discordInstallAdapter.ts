import type { NarrativeEngineState, NarrativeStateEngine } from "@/lib/starstory/domain/narrative";

export function handleDiscordInstallCompleted(
  engine: NarrativeStateEngine,
  guildId: string,
  at: number = Date.now()
): NarrativeEngineState {
  return engine.dispatch({
    type: "DISCORD_INSTALL_COMPLETED",
    at,
    guildId,
  });
}
