import { Collection, type Client } from "discord.js";
import { ping } from "./ping.js";
import { starstory } from "./starstory.js";
import { lab } from "./lab.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { getDbForCampaign } from "../db.js";
import { resolveCampaignDbPath } from "../dataPaths.js";
import { getGuildMode } from "../sessions/sessionRuntime.js";
import { logRuntimeContextBanner } from "../runtime/runtimeContextBanner.js";
import { metaMeepoVoice } from "../ui/metaMeepoVoice.js";
import { cfg } from "../config/env.js";
import { log } from "../utils/logger.js";
import {
  getOrCreateTraceId,
  getInteractionId,
  runWithObservabilityContext,
} from "../observability/context.js";
import { formatUserFacingError } from "../errors/formatUserFacingError.js";
import { MeepoError } from "../errors/meepoError.js";
import {
  getInteractionCallDiagnostics,
  getPayloadDiagnostics,
  serializeInteractionError,
} from "../utils/interactionDiagnostics.js";

export type CommandCtx = {
  guildId: string;
  guildName?: string;
  campaignSlug: string;
  dbPath: string;
  db: any;
  trace_id?: string;
  interaction_id?: string;
};

const commandLog = log.withScope("command", {
  requireGuildContext: true,
  callsite: "commands/index.ts",
});

const RECENT_INTERACTION_WINDOW_MS = 30_000;
const recentInteractionIds = new Map<string, number>();

function markRecentInteraction(interactionId: string): boolean {
  const now = Date.now();
  for (const [id, ts] of recentInteractionIds.entries()) {
    if (now - ts > RECENT_INTERACTION_WINDOW_MS) {
      recentInteractionIds.delete(id);
    }
  }
  if (recentInteractionIds.has(interactionId)) {
    return false;
  }
  recentInteractionIds.set(interactionId, now);
  return true;
}

export const globalCommands = [ping, starstory];

export const devGuildCommands = [lab];

export const commandList = [ping, starstory, lab];

export const commandMap = new Collection(
  commandList.map((c: any) => [c.data.name, c])
);

function buildCommandCtx(interaction: any): CommandCtx | null {
  const guildId = (interaction.guildId as string | null) ?? null;
  if (!guildId) return null;
  const guildName = (interaction.guild?.name as string | undefined) ?? undefined;
  const campaignSlug = resolveCampaignSlug({ guildId, guildName });
  const dbPath = resolveCampaignDbPath(campaignSlug);
  const db = getDbForCampaign(campaignSlug);
  const interactionId = getInteractionId(interaction);
  return {
    guildId,
    guildName,
    campaignSlug,
    dbPath,
    db,
    trace_id: getOrCreateTraceId(),
    interaction_id: interactionId,
  } satisfies CommandCtx;
}

export function registerHandlers(client: Client) {
  client.on("interactionCreate", async (interaction: any) => {
    const interactionIdForDedup = getInteractionId(interaction) ?? String(interaction?.id ?? "missing-interaction-id");
    if (!markRecentInteraction(interactionIdForDedup)) {
      commandLog.warn("Duplicate interaction dropped in process", {
        event_type: "INTERACTION_DUPLICATE_DROPPED",
        pid: process.pid,
        ...getInteractionCallDiagnostics(interaction),
      }, {
        interaction_id: interactionIdForDedup,
        guild_id: (interaction.guildId as string | null) ?? undefined,
      });
      return;
    }

    try {
      if (
        interaction.isButton?.() ||
        interaction.isStringSelectMenu?.() ||
        interaction.isModalSubmit?.()
      ) {
        const commandCtx = buildCommandCtx(interaction);
        if (typeof (starstory as any).handleComponentInteraction === "function") {
          const handled = await runWithObservabilityContext(
            {
              trace_id: commandCtx?.trace_id,
              interaction_id: commandCtx?.interaction_id,
              guild_id: commandCtx?.guildId,
              campaign_slug: commandCtx?.campaignSlug,
            },
            () => (starstory as any).handleComponentInteraction(interaction, commandCtx)
          );
          if (handled) return;
        }
      }

      if (!interaction.isChatInputCommand() && !interaction.isAutocomplete()) return;

      const cmd = commandMap.get(interaction.commandName);
      if (!cmd) {
        if (interaction.isChatInputCommand()) {
          const subcommandGroup = interaction.options?.getSubcommandGroup?.(false) as string | null | undefined;
          const subcommand = interaction.options?.getSubcommand?.(false) as string | null | undefined;

          if (interaction.commandName === "meepo") {
            const starstoryRedirects: Record<string, string> = {
              awaken: "Use `/starstory awaken`.",
              wake: "Use `/starstory awaken`.",
              help: "Use `/starstory help`.",
              status: "Use `/starstory status`.",
            };

            let content = "Moved: use `/starstory` commands instead.";
            if (subcommandGroup === "showtime") {
              content = `Moved: use "/starstory showtime ${subcommand ?? "start"}".`;
            } else if (subcommandGroup === "settings") {
              content = `Moved: use "/starstory settings ${subcommand ?? "show"}".`;
            } else if (subcommandGroup === "sessions") {
              content = "`/meepo sessions` is no longer part of the Closed Alpha public surface. Use `/starstory status` for live state and the web app for session history and recaps.";
            } else if (subcommand === "talk" || subcommand === "hush") {
              content = "`/meepo talk` and `/meepo hush` are retired. Use `/starstory settings talk_mode` if you still need to change the default voice mode.";
            } else if (subcommand && starstoryRedirects[subcommand]) {
              content = `Moved: ${starstoryRedirects[subcommand]}`;
            }

            await interaction.reply({
              content,
              ephemeral: true,
            }).catch(() => {});
            return;
          }

          const movedToLabByCommandName: Record<string, string> = {
            goldmem: "/lab goldmem run",
            meeps: "/lab meeps <subcommand>",
            missions: "/lab missions <subcommand>",
          };
          const replacement = movedToLabByCommandName[interaction.commandName as string];
          if (replacement) {
            await interaction.reply({
              content: `Moved: use ${replacement}.`,
              ephemeral: true,
            }).catch(() => {});
          }
        }
        return;
      }

      if (interaction.isAutocomplete()) {
        if (typeof cmd.autocomplete === "function") {
          await cmd.autocomplete(interaction);
        } else {
          await interaction.respond([]).catch(() => {});
        }
        return;
      }

      const guildId = (interaction.guildId as string | null) ?? null;
      const guildName = (interaction.guild?.name as string | undefined) ?? null;
      const mode = guildId ? getGuildMode(guildId) : cfg.mode;

      const commandCtx = guildId ? buildCommandCtx(interaction) : null;

      logRuntimeContextBanner({
        entrypoint: `command:${interaction.commandName}`,
        guildId,
        guildName,
        mode,
        dbPath: commandCtx?.dbPath,
      });

      await runWithObservabilityContext(
        {
          trace_id: commandCtx?.trace_id,
          interaction_id: commandCtx?.interaction_id ?? getInteractionId(interaction),
          guild_id: commandCtx?.guildId ?? guildId ?? undefined,
          campaign_slug: commandCtx?.campaignSlug,
        },
        () => cmd.execute(interaction, commandCtx)
      );
    } catch (err) {
      const interactionId = getInteractionId(interaction);
      const commandName = typeof interaction.commandName === "string"
        ? interaction.commandName
        : interaction.customId;
      const subcommandGroup = typeof interaction?.options?.getSubcommandGroup === "function"
        ? interaction.options.getSubcommandGroup(false)
        : null;
      const subcommand = typeof interaction?.options?.getSubcommand === "function"
        ? interaction.options.getSubcommand(false)
        : null;
      const interactionType = interaction?.isChatInputCommand?.()
        ? "chat_input"
        : interaction?.isAutocomplete?.()
          ? "autocomplete"
          : interaction?.isModalSubmit?.()
            ? "modal_submit"
            : interaction?.isStringSelectMenu?.()
              ? "string_select"
              : interaction?.isButton?.()
                ? "button"
                : `type_${String(interaction?.type ?? "unknown")}`;

      const payload = formatUserFacingError(err, {
        fallbackMessage: metaMeepoVoice.errors.genericCommandFailure(),
      });

      const isAwakenCommand =
        (commandName === "meepo" || commandName === "starstory") &&
        (subcommand === "awaken" || subcommand === "wake");
      const finalContent = isAwakenCommand
        ? `${payload.content}\n[awaken-boundary-marker:global-v1]`
        : payload.content;

      commandLog.error("Command error", {
        event_type: "GLOBAL_COMMAND_ERROR_BOUNDARY_HIT",
        helper_name: "registerHandlers",
        command_name: commandName,
        subcommand_group: subcommandGroup,
        subcommand,
        interaction_type: interactionType,
        custom_id: typeof interaction?.customId === "string" ? interaction.customId : undefined,
        deferred: Boolean(interaction?.deferred),
        replied: Boolean(interaction?.replied),
        trace_id: payload.trace_id,
        pid: process.pid,
        command: commandName,
        error_code: payload.code,
        failure_class: payload.failureClass,
        retryable: payload.retryable,
        corrective_action_required: payload.correctiveActionRequired,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }, {
        interaction_id: interactionId,
        guild_id: (interaction.guildId as string | null) ?? undefined,
      });
      if (interaction.deferred || interaction.replied) {
        const responsePayload = { content: finalContent, ephemeral: true };
        commandLog.debug("Global boundary response before followUp", {
          event_type: "GLOBAL_COMMAND_BOUNDARY_RESPONSE",
          marker: "GLOBAL_BOUNDARY_BEFORE_FOLLOW_UP",
          helper_name: "registerHandlers",
          pid: process.pid,
          ...getInteractionCallDiagnostics(interaction),
          ...getPayloadDiagnostics(responsePayload),
        }, {
          interaction_id: interactionId,
          guild_id: (interaction.guildId as string | null) ?? undefined,
        });
        await interaction.followUp(responsePayload).then(() => {
          commandLog.debug("Global boundary response after followUp", {
            event_type: "GLOBAL_COMMAND_BOUNDARY_RESPONSE",
            marker: "GLOBAL_BOUNDARY_AFTER_FOLLOW_UP",
            helper_name: "registerHandlers",
            pid: process.pid,
            ...getInteractionCallDiagnostics(interaction),
            ...getPayloadDiagnostics(responsePayload),
          }, {
            interaction_id: interactionId,
            guild_id: (interaction.guildId as string | null) ?? undefined,
          });
        }).catch((replyErr: unknown) => {
          const wrapped = new MeepoError("ERR_DISCORD_REPLY_FAILED", {
            message: "Failed to send command follow-up response",
            cause: replyErr,
            trace_id: payload.trace_id,
            interaction_id: interactionId,
          });
          commandLog.error("Command follow-up failed", {
            error_code: wrapped.code,
            error: wrapped.message,
            cause: replyErr instanceof Error ? replyErr.message : String(replyErr),
            raw_error: serializeInteractionError(replyErr),
          }, {
            interaction_id: interactionId,
            guild_id: (interaction.guildId as string | null) ?? undefined,
          });
        });
      } else {
        const responsePayload = { content: finalContent, ephemeral: true };
        commandLog.debug("Global boundary response before reply", {
          event_type: "GLOBAL_COMMAND_BOUNDARY_RESPONSE",
          marker: "GLOBAL_BOUNDARY_BEFORE_REPLY",
          helper_name: "registerHandlers",
          pid: process.pid,
          ...getInteractionCallDiagnostics(interaction),
          ...getPayloadDiagnostics(responsePayload),
        }, {
          interaction_id: interactionId,
          guild_id: (interaction.guildId as string | null) ?? undefined,
        });
        await interaction.reply(responsePayload).then(() => {
          commandLog.debug("Global boundary response after reply", {
            event_type: "GLOBAL_COMMAND_BOUNDARY_RESPONSE",
            marker: "GLOBAL_BOUNDARY_AFTER_REPLY",
            helper_name: "registerHandlers",
            pid: process.pid,
            ...getInteractionCallDiagnostics(interaction),
            ...getPayloadDiagnostics(responsePayload),
          }, {
            interaction_id: interactionId,
            guild_id: (interaction.guildId as string | null) ?? undefined,
          });
        }).catch((replyErr: unknown) => {
          const wrapped = new MeepoError("ERR_DISCORD_REPLY_FAILED", {
            message: "Failed to send command reply response",
            cause: replyErr,
            trace_id: payload.trace_id,
            interaction_id: interactionId,
          });
          commandLog.error("Command reply failed", {
            error_code: wrapped.code,
            error: wrapped.message,
            cause: replyErr instanceof Error ? replyErr.message : String(replyErr),
            raw_error: serializeInteractionError(replyErr),
          }, {
            interaction_id: interactionId,
            guild_id: (interaction.guildId as string | null) ?? undefined,
          });
        });
      }
    }
  });
}
