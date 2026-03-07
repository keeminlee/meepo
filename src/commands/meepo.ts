import fs from "node:fs";
import { AttachmentBuilder, GuildMember, SlashCommandBuilder } from "discord.js";
import {
  getGuildCanonPersonaId,
  getGuildCanonPersonaMode,
  getGuildConfig,
  getGuildDmRoleId,
  getGuildDmUserId,
  getGuildDefaultTalkMode,
  getGuildDefaultRecapStyle,
  getGuildHomeTextChannelId,
  getGuildHomeVoiceChannelId,
  getGuildSetupVersion,
  resolveGuildHomeVoiceChannelId,
  setGuildDefaultTalkMode,
  setGuildDmRoleId,
  setGuildHomeTextChannelId,
  setGuildHomeVoiceChannelId,
} from "../campaign/guildConfig.js";
import { ensureGuildSetup, type SetupReport } from "../campaign/ensureGuildSetup.js";
import { cfg } from "../config/env.js";
import { AwakenEngine, type AwakenRunResult } from "../awakening/AwakenEngine.js";
import { getPersona } from "../personas/index.js";
import { logSystemEvent } from "../ledger/system.js";
import { wakeMeepo, getActiveMeepo, sleepMeepo } from "../meepo/state.js";
import { getEffectivePersonaId } from "../meepo/personaState.js";
import { isElevated } from "../security/isElevated.js";
import { isDevUser } from "../security/devAccess.js";
import {
  endSession,
  getActiveSession,
  getSessionArtifact,
  getSessionArtifactMap,
  getSessionById,
  getMostRecentSession,
  listSessions,
  startSession,
} from "../sessions/sessions.js";
import { generateSessionRecap } from "../sessions/recapEngine.js";
import type { RecapStrategy } from "../sessions/recapEngine.js";
import { ensureBronzeTranscriptExportCached } from "../sessions/transcriptExport.js";
import {
  buildSessionArtifactStem,
  getAllFinalStatuses,
  getBaseStatus,
  getFinalStatus,
  type RecapPassStrategy,
} from "../sessions/megameecapArtifactLocator.js";
import { resolveEffectiveMode } from "../sessions/sessionRuntime.js";
import { joinVoice, leaveVoice } from "../voice/connection.js";
import { startReceiver, stopReceiver } from "../voice/receiver.js";
import {
  getVoiceState,
  isVoiceHushEnabled,
  setVoiceHushEnabled,
  setVoiceState,
} from "../voice/state.js";
import { getSttProviderInfo } from "../voice/stt/provider.js";
import { getTtsProviderInfo } from "../voice/tts/provider.js";
import { voicePlaybackController } from "../voice/voicePlaybackController.js";
import { getMeepoContextWorkerStatus } from "../ledger/meepoContextWorker.js";
import { initState, loadState, saveProgress } from "../ledger/awakeningStateRepo.js";
import { metaMeepoVoice, type DoctorCheck } from "../ui/metaMeepoVoice.js";
import type { CommandCtx } from "./index.js";
import { PermissionFlagsBits } from "discord.js";
import { formatUserFacingError } from "../errors/formatUserFacingError.js";
import { MeepoError, type MeepoErrorCode } from "../errors/meepoError.js";
import { loadAwakenScript } from "../scripts/awakening/_loader.js";
import {
  AWAKEN_INVOKER_USER_ID_KEY,
  clearPendingPromptPatch,
  getPendingPromptFromState,
  resolveModalTextFallback,
  repairDmDisplayNameMemory,
} from "../awakening/wakeIdentity.js";
import {
  DM_DISPLAY_NAME_KEY,
  upsertDmDisplayNameMemory,
} from "../meepoMind/meepoMindWriter.js";
import {
  getGuildMemoryByKey,
} from "../meepoMind/meepoMindMemoryRepo.js";
import {
  getGuildSttPrompt,
} from "../voice/stt/promptState.js";
import {
  AWAKEN_GUILD_CONFIG_KEYS,
} from "../campaign/awakenKeys.js";
import {
  parseChannelSelectCustomId,
  parseContinueCustomId,
  parseChoicePromptCustomId,
  parseModalOpenCustomId,
  parseModalSubmitCustomId,
  parseRegistryAddCustomId,
  parseRegistryDoneCustomId,
  parseRegistryNameModalCustomId,
  parseRegistryUserSelectCustomId,
  parseRoleSelectPromptCustomId,
  renderPendingAwakeningPrompt,
  resolveChoicePromptValue,
} from "../awakening/prompts/index.js";
import { AWAKEN_MODAL_INPUT_ID, buildModalTextSubmitModal } from "../awakening/prompts/modalTextPrompt.js";
import { AWAKEN_REGISTRY_NAME_INPUT_ID } from "../awakening/prompts/registryBuilderPrompt.js";
import { AWAKEN_CONTINUE_KEY } from "../awakening/prompts/continuePrompt.js";
import { log } from "../utils/logger.js";
import {
  getInteractionCallDiagnostics,
  getInteractionSurface,
  getPayloadDiagnostics,
  serializeInteractionError,
  shouldRetryAlternateResponsePath,
} from "../utils/interactionDiagnostics.js";

type SessionRow = {
  session_id: string;
  label: string | null;
  kind: "canon" | "noncanon" | "chat";
  mode_at_start: "canon" | "ambient" | "lab" | "dormant";
  started_at_ms: number;
  ended_at_ms: number | null;
};

type SessionArtifactRow = {
  id: string;
  session_id: string;
  artifact_type: string;
  created_at_ms: number;
  engine: string | null;
  source_hash: string | null;
  strategy: string | null;
  strategy_version: string | null;
  meta_json: string | null;
  content_text: string | null;
  file_path: string | null;
  size_bytes: number | null;
};

const DEFAULT_RECAP_STRATEGY: RecapStrategy = "balanced";
const RECAP_STRATEGIES: RecapStrategy[] = ["detailed", "balanced", "concise"];
const setupWarningDigestByGuild = new Map<string, string>();
const TRANSCRIPT_EXPORT_TIME_BUDGET_MS = 1500;
const MAX_INLINE_ATTACHMENT_BYTES = 24 * 1024 * 1024;
const RECAP_COOLDOWN_MS = 30_000;
const RECAP_MAX_CONCURRENT_PER_GUILD = 1;
const inFlightRecapRequests = new Set<string>();
const inFlightRecapCountByGuild = new Map<string, number>();
const recapCooldownByKey = new Map<string, number>();
const meepoCommandLog = log.withScope("meepo", {
  requireGuildContext: true,
  callsite: "commands/meepo.ts",
});

type AwakenBoundaryCode =
  | "ERR_AWAKEN_MODEL"
  | "ERR_AWAKEN_PROMPT"
  | "ERR_AWAKEN_MODAL"
  | "ERR_AWAKEN_STATE"
  | "ERR_AWAKEN_RESUME"
  | "ERR_AWAKEN_UNKNOWN";

function inferAwakenBoundaryCode(error: unknown, fallbackCode: AwakenBoundaryCode): AwakenBoundaryCode {
  if (error instanceof MeepoError && error.code.startsWith("ERR_AWAKEN_")) {
    return error.code as AwakenBoundaryCode;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/scene not found|state not found|invalid state|script/i.test(message)) {
    return "ERR_AWAKEN_STATE";
  }
  if (/modal|showModal|Unknown interaction|already been acknowledged/i.test(message)) {
    return "ERR_AWAKEN_MODAL";
  }
  return fallbackCode;
}

function toAwakenBoundaryError(args: {
  error: unknown;
  fallbackCode: AwakenBoundaryCode;
  metadata?: Record<string, unknown>;
  traceId?: string;
  interactionId?: string;
}): MeepoError {
  const code = inferAwakenBoundaryCode(args.error, args.fallbackCode);
  if (args.error instanceof MeepoError && args.error.code === code) {
    return args.error;
  }
  const message = args.error instanceof Error ? args.error.message : String(args.error);
  return new MeepoError(code, {
    message,
    cause: args.error,
    metadata: args.metadata,
    trace_id: args.traceId,
    interaction_id: args.interactionId,
  });
}

function getAwakenDiag(error: unknown): Record<string, unknown> | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as { awakenDiag?: unknown }).awakenDiag;
  if (!value || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

function withAwakenPromptDiagnosticSuffix(content: string, metadata?: Record<string, unknown>): string {
  if (process.env.NODE_ENV === "production") return content;
  const origin = typeof metadata?.origin_branch === "string" ? metadata.origin_branch : undefined;
  const op = typeof metadata?.selected_op === "string" ? metadata.selected_op : undefined;
  const helper = typeof metadata?.helper_name === "string" ? metadata.helper_name : undefined;
  if (!origin && !op && !helper) return content;

  const suffix = ` [origin=${origin ?? "unknown"} op=${op ?? "unknown"} helper=${helper ?? "unknown"}]`;
  return content.replace("(ERR_AWAKEN_PROMPT)", `(ERR_AWAKEN_PROMPT${suffix})`);
}

function logAwakenStage(args: {
  level: "info" | "error";
  stage: string;
  label: string;
  interaction: any;
  ctx: CommandCtx;
  script?: { id?: string; version?: number } | null;
  state?: any;
  pending?: { key?: string; nonce?: string; kind?: string } | null;
  awakenedFlag?: number | null;
  extra?: Record<string, unknown>;
}): void {
  const payload = {
    event_type: "AWAKEN_STAGE",
    stage: args.stage,
    interaction_id: args.ctx.interaction_id ?? args.interaction?.id,
    user_id: args.interaction?.user?.id,
    campaign_slug: args.ctx.campaignSlug,
    scene_id: args.state?.current_scene,
    script_id: args.script?.id,
    script_version: args.script?.version,
    onboarding_state_exists: Boolean(args.state),
    awakened_flag_set: args.awakenedFlag === 1,
    pending_prompt_key: args.pending?.key,
    pending_prompt_nonce: args.pending?.nonce,
    pending_prompt_kind: args.pending?.kind,
    interaction_surface: getInteractionSurface(args.interaction),
    ...args.extra,
  };

  if (args.level === "error") {
    meepoCommandLog.error(args.label, payload, {
      guild_id: args.ctx.guildId,
      campaign_slug: args.ctx.campaignSlug,
      interaction_id: args.ctx.interaction_id,
      trace_id: args.ctx.trace_id,
      session_id: undefined,
    });
    return;
  }

  meepoCommandLog.info(args.label, payload, {
    guild_id: args.ctx.guildId,
    campaign_slug: args.ctx.campaignSlug,
    interaction_id: args.ctx.interaction_id,
    trace_id: args.ctx.trace_id,
    session_id: undefined,
  });
}

function logAwakenResponseLifecycle(args: {
  marker: string;
  interaction: any;
  ctx?: CommandCtx;
  operation?: string;
  helperName?: string;
  extra?: Record<string, unknown>;
  level?: "info" | "error";
  error?: unknown;
}): void {
  const payload = {
    event_type: "AWAKEN_RESPONSE_GUARDRAIL",
    marker: args.marker,
    command_name: "meepo",
    subcommand_name: "awaken",
    helper_name: args.helperName,
    operation: args.operation,
    trace_id: args.ctx?.trace_id,
    pid: process.pid,
    error: args.error ? serializeInteractionError(args.error) : undefined,
    ...getInteractionCallDiagnostics(args.interaction),
    ...args.extra,
  };

  if (args.level === "error") {
    meepoCommandLog.error("Awakening response lifecycle", payload, {
      guild_id: args.ctx?.guildId ?? args.interaction?.guildId,
      campaign_slug: args.ctx?.campaignSlug,
      interaction_id: args.ctx?.interaction_id,
      trace_id: args.ctx?.trace_id,
      session_id: undefined,
    });
    return;
  }

  meepoCommandLog.debug("Awakening response lifecycle", payload, {
    guild_id: args.ctx?.guildId ?? args.interaction?.guildId,
    campaign_slug: args.ctx?.campaignSlug,
    interaction_id: args.ctx?.interaction_id,
    trace_id: args.ctx?.trace_id,
    session_id: undefined,
  });
}

function buildRecapDedupeKey(args: {
  guildId: string;
  campaignSlug: string;
  sessionId: string;
  strategy: RecapStrategy;
}): string {
  return [
    args.guildId.trim().toLowerCase(),
    args.campaignSlug.trim().toLowerCase(),
    args.sessionId.trim().toLowerCase(),
    "recap_final",
    args.strategy,
  ].join("|");
}

function incrementGuildRecapInFlight(guildId: string): void {
  const next = (inFlightRecapCountByGuild.get(guildId) ?? 0) + 1;
  inFlightRecapCountByGuild.set(guildId, next);
}

function decrementGuildRecapInFlight(guildId: string): void {
  const current = inFlightRecapCountByGuild.get(guildId) ?? 0;
  if (current <= 1) {
    inFlightRecapCountByGuild.delete(guildId);
    return;
  }
  inFlightRecapCountByGuild.set(guildId, current - 1);
}

function buildTaxonomyPayload(code: MeepoErrorCode, ctx: CommandCtx, metadata?: Record<string, unknown>) {
  return formatUserFacingError(
    new MeepoError(code, metadata ? { metadata } : undefined),
    {
      trace_id: ctx.trace_id,
      interaction_id: ctx.interaction_id,
    }
  );
}

function setReplyMode(db: any, guildId: string, mode: "voice" | "text"): void {
  db.prepare(
    `
      UPDATE npc_instances
      SET reply_mode = ?
      WHERE guild_id = ? AND is_active = 1
    `
  ).run(mode, guildId);
}

function hasTtsAvailable(): boolean {
  const info = getTtsProviderInfo();
  return cfg.tts.enabled && info.name !== "noop";
}

function formatChannel(channelId: string | null): string {
  if (!channelId) return "(unset)";
  return `<#${channelId}>`;
}

function summarizeSession(session: SessionRow): string {
  const label = getSessionDisplayLabel(session);
  const status = session.ended_at_ms ? "ended" : "active";
  return `${label} (${status})`;
}

function getSessionDisplayLabel(session: Pick<SessionRow, "label">): string {
  const label = session.label?.trim();
  return label && label.length > 0 ? label : "Unlabeled Session";
}

function getSessionKindTag(session: Pick<SessionRow, "kind">): "CANON" | "AMBIENT" {
  return session.kind === "canon" ? "CANON" : "AMBIENT";
}

function canGenerateRecap(session: Pick<SessionRow, "kind" | "mode_at_start">): boolean {
  return session.kind === "canon" && session.mode_at_start !== "lab";
}

function shouldPrintSetupSummary(guildId: string, report: SetupReport): boolean {
  if (report.applied.length > 0 || report.errors.length > 0 || report.setupVersionChanged) {
    if (report.warnings.length > 0) {
      const warningDigest = report.warnings.join(" | ");
      setupWarningDigestByGuild.set(guildId, warningDigest);
    }
    return true;
  }

  if (report.warnings.length === 0) {
    return false;
  }

  const warningDigest = report.warnings.join(" | ");
  const previousDigest = setupWarningDigestByGuild.get(guildId);
  if (previousDigest === warningDigest) {
    return false;
  }
  setupWarningDigestByGuild.set(guildId, warningDigest);
  return true;
}

function renderSetupSummary(report: SetupReport): string[] {
  return metaMeepoVoice.wake.setupSummaryLines(report.applied, report.warnings, report.errors);
}

function formatAwakenStatus(runResult: AwakenRunResult): string {
  if (runResult.status === "completed") {
    return "Awakening complete.";
  }
  if (runResult.status === "advanced") {
    return `Awakening advanced: ${runResult.fromScene} -> ${runResult.toScene}.`;
  }
  if (runResult.status === "blocked") {
    if (runResult.reason === "prompt") {
      return "Awakening paused: awaiting DM input.";
    }
    if (runResult.reason === "action" || runResult.reason === "commit") {
      return `Awakening paused: ${runResult.reason} steps not implemented yet (Sprint 5).`;
    }
    if (runResult.reason === "budget") {
      return "Awakening paused: beat budget reached for this run. Use /meepo awaken again to continue.";
    }
    if (runResult.reason === "budget_delay") {
      return "Awakening paused: cinematic delay budget reached for this run. Use /meepo awaken again to continue.";
    }
    return "Awakening paused: next-step shape not supported yet.";
  }
  if (runResult.reason === "already_completed") {
    return "Meepo is already awake in this world, meep.";
  }
  return "Awakening state not found.";
}

async function replyEphemeral(
  interaction: any,
  content: string,
  opts?: { ctx?: CommandCtx; marker?: string; originBranch?: string }
): Promise<void> {
  const markerBase = opts?.marker ?? "AWAKEN_REPLY_EPHEMERAL";
  const payload = { content, ephemeral: true };
  const payloadShape = getPayloadDiagnostics(payload);
  const selectedOp = interaction.deferred && typeof interaction.editReply === "function"
    ? "editReply"
    : (interaction.deferred || interaction.replied) && typeof interaction.followUp === "function"
      ? "followUp"
      : "reply";

  logAwakenResponseLifecycle({
    marker: `${markerBase}_BEFORE_SELECT_OP`,
    interaction,
    ctx: opts?.ctx,
    operation: "select-response-op",
    helperName: "replyEphemeral",
    extra: {
      origin_branch: opts?.originBranch,
      selected_op: selectedOp,
      ...payloadShape,
    },
  });

  const attempts: Array<{ op: "editReply" | "followUp" | "reply"; run: () => Promise<unknown> }> = [];
  if (interaction.deferred && typeof interaction.editReply === "function") {
    attempts.push({ op: "editReply", run: () => interaction.editReply({ content }) });
  }
  if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
    attempts.push({ op: "followUp", run: () => interaction.followUp(payload) });
  }
  if (typeof interaction.reply === "function") {
    attempts.push({ op: "reply", run: () => interaction.reply(payload) });
  }
  if (typeof interaction.followUp === "function") {
    attempts.push({ op: "followUp", run: () => interaction.followUp(payload) });
  }
  if (typeof interaction.editReply === "function") {
    attempts.push({ op: "editReply", run: () => interaction.editReply({ content }) });
  }

  const seen = new Set<string>();
  const orderedAttempts = attempts.filter((attempt) => {
    if (seen.has(attempt.op)) return false;
    seen.add(attempt.op);
    return true;
  });

  try {
    for (let idx = 0; idx < orderedAttempts.length; idx += 1) {
      const attempt = orderedAttempts[idx]!;
      logAwakenResponseLifecycle({
        marker: `${markerBase}_BEFORE_${attempt.op.toUpperCase()}`,
        interaction,
        ctx: opts?.ctx,
        operation: attempt.op,
        helperName: "replyEphemeral",
        extra: {
          origin_branch: opts?.originBranch,
          selected_op: attempt.op,
          selected_op_rank: idx + 1,
          selected_op_total: orderedAttempts.length,
          ...payloadShape,
        },
      });
      logAwakenResponseLifecycle({
        marker: "AWAKEN_OP_BEFORE",
        interaction,
        ctx: opts?.ctx,
        operation: attempt.op,
        helperName: "replyEphemeral",
        extra: {
          origin_branch: opts?.originBranch,
          selected_op: attempt.op,
          selected_op_rank: idx + 1,
          selected_op_total: orderedAttempts.length,
          op_marker_source: markerBase,
          ...payloadShape,
        },
      });
      try {
        await attempt.run();
        logAwakenResponseLifecycle({
          marker: `${markerBase}_AFTER_${attempt.op.toUpperCase()}`,
          interaction,
          ctx: opts?.ctx,
          operation: attempt.op,
          helperName: "replyEphemeral",
          extra: {
            origin_branch: opts?.originBranch,
            selected_op: attempt.op,
          },
        });
        logAwakenResponseLifecycle({
          marker: "AWAKEN_OP_AFTER",
          interaction,
          ctx: opts?.ctx,
          operation: attempt.op,
          helperName: "replyEphemeral",
          extra: {
            origin_branch: opts?.originBranch,
            selected_op: attempt.op,
            selected_op_rank: idx + 1,
            selected_op_total: orderedAttempts.length,
            op_marker_source: markerBase,
          },
        });
        return;
      } catch (attemptError) {
        logAwakenResponseLifecycle({
          marker: `${markerBase}_${attempt.op.toUpperCase()}_ERROR`,
          interaction,
          ctx: opts?.ctx,
          operation: attempt.op,
          helperName: "replyEphemeral",
          level: "error",
          error: attemptError,
          extra: {
            origin_branch: opts?.originBranch,
            selected_op: attempt.op,
            selected_op_rank: idx + 1,
            selected_op_total: orderedAttempts.length,
            should_retry_alt_response_path: shouldRetryAlternateResponsePath(attemptError),
            ...payloadShape,
          },
        });
        logAwakenResponseLifecycle({
          marker: "AWAKEN_OP_ERROR",
          interaction,
          ctx: opts?.ctx,
          operation: attempt.op,
          helperName: "replyEphemeral",
          level: "error",
          error: attemptError,
          extra: {
            origin_branch: opts?.originBranch,
            selected_op: attempt.op,
            selected_op_rank: idx + 1,
            selected_op_total: orderedAttempts.length,
            op_marker_source: markerBase,
            should_retry_alt_response_path: shouldRetryAlternateResponsePath(attemptError),
            ...payloadShape,
          },
        });
        if (!shouldRetryAlternateResponsePath(attemptError)) {
          throw attemptError;
        }
      }
    }
    throw new Error("No valid interaction response method available for replyEphemeral");
  } catch (error) {
    logAwakenResponseLifecycle({
      marker: `${markerBase}_RESPONSE_ERROR`,
      interaction,
      ctx: opts?.ctx,
      operation: "reply-path",
      helperName: "replyEphemeral",
      level: "error",
      error,
      extra: {
        origin_branch: opts?.originBranch,
        selected_op: selectedOp,
        ...payloadShape,
      },
    });
  }
}

function hasRoleOnInteractionMember(interaction: any, roleId: string): boolean {
  const roles = interaction.member?.roles;
  if (!roles) return false;
  if (Array.isArray(roles)) return roles.includes(roleId);
  if (Array.isArray(roles.cache)) return roles.cache.includes(roleId);
  if (typeof roles.cache?.has === "function") return Boolean(roles.cache.has(roleId));
  if (Array.isArray(roles.value)) return roles.value.includes(roleId);
  return false;
}

function canAnswerAwakeningPrompt(guildId: string, interaction: any, state?: any, target?: PromptTarget): boolean {
  if (target?.kind === "continue") {
    const dmRoleId = getGuildDmRoleId(guildId);
    if (dmRoleId) {
      return hasRoleOnInteractionMember(interaction, dmRoleId);
    }

    const invokerUserId = typeof state?.progress_json?.[AWAKEN_INVOKER_USER_ID_KEY] === "string"
      ? String(state.progress_json[AWAKEN_INVOKER_USER_ID_KEY]).trim()
      : "";
    if (invokerUserId.length > 0) {
      return interaction.user?.id === invokerUserId;
    }
  }

  const configuredDmUserId = getGuildDmUserId(guildId);
  if (configuredDmUserId) {
    return interaction.user?.id === configuredDmUserId;
  }
  return Boolean(interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild));
}

type PromptTarget = {
  kind: "continue" | "choice" | "role_select" | "modal_text" | "channel_select" | "registry_builder";
  sceneId: string;
  key: string;
  nonce: string;
  source:
    | "continue"
    | "choice"
    | "role_select"
    | "modal_open"
    | "modal_submit"
    | "channel_select"
    | "registry_add"
    | "registry_done"
    | "registry_user"
    | "registry_name_modal";
  optionIndex?: number;
};

function parsePromptTargetFromInteraction(interaction: any): PromptTarget | null {
  const customId = String(interaction?.customId ?? "");

  const continueTarget = parseContinueCustomId(customId);
  if (continueTarget) {
    return {
      kind: "continue",
      sceneId: "",
      key: AWAKEN_CONTINUE_KEY,
      nonce: continueTarget.nonce,
      source: "continue",
    };
  }

  const choice = parseChoicePromptCustomId(customId);
  if (choice) {
    return {
      kind: "choice",
      sceneId: choice.sceneId,
      key: choice.key,
      nonce: choice.nonce,
      source: "choice",
      optionIndex: choice.optionIndex,
    };
  }

  const role = parseRoleSelectPromptCustomId(customId);
  if (role) {
    return {
      kind: "role_select",
      sceneId: role.sceneId,
      key: role.key,
      nonce: role.nonce,
      source: "role_select",
    };
  }

  const modalOpen = parseModalOpenCustomId(customId);
  if (modalOpen) {
    return {
      kind: "modal_text",
      sceneId: modalOpen.sceneId,
      key: modalOpen.key,
      nonce: modalOpen.nonce,
      source: "modal_open",
    };
  }

  const modalSubmit = parseModalSubmitCustomId(customId);
  if (modalSubmit) {
    return {
      kind: "modal_text",
      sceneId: modalSubmit.sceneId,
      key: modalSubmit.key,
      nonce: modalSubmit.nonce,
      source: "modal_submit",
    };
  }

  const channelSelect = parseChannelSelectCustomId(customId);
  if (channelSelect) {
    return {
      kind: "channel_select",
      sceneId: channelSelect.sceneId,
      key: channelSelect.key,
      nonce: channelSelect.nonce,
      source: "channel_select",
    };
  }

  const registryAdd = parseRegistryAddCustomId(customId);
  if (registryAdd) {
    return {
      kind: "registry_builder",
      sceneId: registryAdd.sceneId,
      key: registryAdd.key,
      nonce: registryAdd.nonce,
      source: "registry_add",
    };
  }

  const registryDone = parseRegistryDoneCustomId(customId);
  if (registryDone) {
    return {
      kind: "registry_builder",
      sceneId: registryDone.sceneId,
      key: registryDone.key,
      nonce: registryDone.nonce,
      source: "registry_done",
    };
  }

  const registryUser = parseRegistryUserSelectCustomId(customId);
  if (registryUser) {
    return {
      kind: "registry_builder",
      sceneId: registryUser.sceneId,
      key: registryUser.key,
      nonce: registryUser.nonce,
      source: "registry_user",
    };
  }

  const registryNameModal = parseRegistryNameModalCustomId(customId);
  if (registryNameModal) {
    return {
      kind: "registry_builder",
      sceneId: registryNameModal.sceneId,
      key: registryNameModal.key,
      nonce: registryNameModal.nonce,
      source: "registry_name_modal",
    };
  }

  return null;
}

function currentPendingMatches(state: any, target: PromptTarget): boolean {
  const pending = getPendingPromptFromState(state);
  return Boolean(
    pending
    && pending.kind === target.kind
    && pending.sceneId === target.sceneId
    && pending.key === target.key
    && pending.nonce === target.nonce
  );
}

function hydrateContinuePromptTargetFromPending(state: any, target: PromptTarget): PromptTarget {
  if (target.kind !== "continue") return target;

  const pending = getPendingPromptFromState(state);
  if (!pending || pending.kind !== "continue") return target;

  return {
    ...target,
    sceneId: pending.sceneId,
    key: pending.key,
  };
}

async function resumeAwakeningAfterPromptSubmit(args: {
  interaction: any;
  ctx: CommandCtx;
  script: any;
  guildId: string;
  runtimeChannelId?: string;
  source?: string;
}): Promise<void> {
  const beforeState = loadState(args.guildId, args.script.id, { db: args.ctx.db });
  const beforePending = getPendingPromptFromState(beforeState);

  if (!args.interaction.deferred && !args.interaction.replied && typeof args.interaction.deferReply === "function") {
    await args.interaction.deferReply({ ephemeral: true });
  }

  logAwakenStage({
    level: "info",
    stage: "resume_engine_start",
    label: "Awakening resume engine start",
    interaction: args.interaction,
    ctx: args.ctx,
    script: args.script,
    state: beforeState,
    pending: beforePending,
    extra: {
      resume_source: args.source ?? "unknown",
      runtime_channel_id: args.runtimeChannelId,
    },
  });

  try {
    const runResult = await AwakenEngine.runWake(args.interaction, {
      db: args.ctx.db,
      script: args.script,
      runtimeChannelId: args.runtimeChannelId,
    });

    logAwakenStage({
      level: "info",
      stage: "resume_engine_success",
      label: "Awakening resume engine success",
      interaction: args.interaction,
      ctx: args.ctx,
      script: args.script,
      state: beforeState,
      pending: beforePending,
      extra: {
        resume_source: args.source ?? "unknown",
        run_status: runResult.status,
        run_reason: (runResult as { reason?: string }).reason,
      },
    });

    const refreshedState = loadState(args.guildId, args.script.id, { db: args.ctx.db });
    const refreshedPending = getPendingPromptFromState(refreshedState);
    if (refreshedState && refreshedPending) {
      logAwakenResponseLifecycle({
        marker: "AWAKEN_RENDER_PENDING_PROMPT_CALL",
        interaction: args.interaction,
        ctx: args.ctx,
        extra: {
          origin_branch: args.source === "modal_submit" ? "modal_submit" : "resume",
          pending_kind: refreshedPending.kind,
          pending_key: refreshedPending.key,
          pending_nonce: refreshedPending.nonce,
        },
      });
      const rendered = await renderPendingAwakeningPrompt({
        interaction: args.interaction,
        script: args.script,
        state: refreshedState,
        pending: refreshedPending,
        originBranch: args.source === "modal_submit" ? "modal_submit" : "resume",
      });
      if (rendered) return;
    }

    await args.interaction.editReply(formatAwakenStatus(runResult));
  } catch (error) {
    const diag = getAwakenDiag(error);
    const normalized = toAwakenBoundaryError({
      error,
      fallbackCode: "ERR_AWAKEN_RESUME",
      traceId: args.ctx.trace_id,
      interactionId: args.ctx.interaction_id,
      metadata: {
        stage: "resume_engine",
        script_id: args.script?.id,
        script_version: args.script?.version,
        scene_id: beforeState?.current_scene,
        pending_prompt_key: beforePending?.key,
        pending_prompt_nonce: beforePending?.nonce,
        resume_source: args.source ?? "unknown",
        ...diag,
      },
    });

    logAwakenStage({
      level: "error",
      stage: "resume_engine_error",
      label: "Awakening resume engine failed",
      interaction: args.interaction,
      ctx: args.ctx,
      script: args.script,
      state: beforeState,
      pending: beforePending,
      extra: {
        error_code: normalized.code,
        failure_class: "internal",
        error: normalized.message,
        resume_source: args.source ?? "unknown",
      },
    });

    const payload = formatUserFacingError(normalized, {
      trace_id: args.ctx.trace_id,
      interaction_id: args.ctx.interaction_id,
    });
    await replyEphemeral(args.interaction, payload.content, {
      ctx: args.ctx,
      marker: "AWAKEN_RESUME_ERROR",
      originBranch: args.source === "modal_submit" ? "modal_submit" : "resume",
    });
  }
}

async function runChannelDriftBestEffort(args: {
  interaction: any;
  scene: any;
  oldChannelId: string;
  newChannelId: string;
}): Promise<void> {
  const onChange = args.scene?.on_change?.if_different_channel;
  if (!onChange || args.oldChannelId === args.newChannelId) return;

  const sendLines = async (channelRef: string, say: any): Promise<void> => {
    const channelId = channelRef === "current_channel" ? args.oldChannelId : channelRef;
    const beats = Array.isArray(say) ? say : say ? [say] : [];
    for (const beat of beats) {
      const text = typeof beat === "string"
        ? beat
        : typeof beat?.text === "string"
          ? beat.text
          : "";
      if (!text.trim()) continue;

      try {
        const channel = await args.interaction.guild?.channels?.fetch?.(channelId);
        if (channel?.send) {
          await channel.send({ content: text.replaceAll("{{home_channel_id}}", args.newChannelId) });
        }
      } catch {
        meepoCommandLog.warn("Awakening drift send failed", {
          event_type: "AWAKEN_DRIFT_WARN",
          error_code: "DRIFT_SEND_FAILED",
          failure_class: "internal",
          interaction_id: args.interaction?.id,
          old_channel_id: args.oldChannelId,
          new_channel_id: args.newChannelId,
        }, {
          guild_id: args.interaction?.guildId,
        });
      }
    }
  };

  try {
    await sendLines(String(onChange.departure?.channel ?? args.oldChannelId), onChange.departure?.say);
    await sendLines(String(onChange.arrival?.channel ?? args.newChannelId), onChange.arrival?.say);
  } catch {
    meepoCommandLog.warn("Awakening drift processing failed", {
      event_type: "AWAKEN_DRIFT_WARN",
      error_code: "DRIFT_PROCESS_FAILED",
      failure_class: "internal",
      interaction_id: args.interaction?.id,
      old_channel_id: args.oldChannelId,
      new_channel_id: args.newChannelId,
    }, {
      guild_id: args.interaction?.guildId,
    });
  }
}

async function handleAwakeningChoicePromptInteraction(interaction: any, ctx: CommandCtx | null): Promise<boolean> {
  const parsedTarget = parsePromptTargetFromInteraction(interaction);
  if (!parsedTarget) return false;
  let target: PromptTarget = parsedTarget;

  const guildId = interaction.guildId as string | null;
  if (!guildId || !ctx?.db) {
    await replyEphemeral(interaction, metaMeepoVoice.errors.notInGuild());
    return true;
  }

  try {
    const script = await loadAwakenScript("meepo_awaken");
    const state = loadState(guildId, script.id, { db: ctx.db });
    target = state ? hydrateContinuePromptTargetFromPending(state, parsedTarget) : parsedTarget;
    if (!state || !currentPendingMatches(state, target)) {
      await replyEphemeral(interaction, "This awakening prompt is stale. Run /meepo awaken again.");
      return true;
    }

    if (!canAnswerAwakeningPrompt(guildId, interaction, state, target)) {
      const denial = target.kind === "continue"
        ? "Only the Dungeon Master may continue the ritual."
        : "Only the Dungeon Master can answer this awakening prompt.";
      await replyEphemeral(interaction, denial);
      return true;
    }

    if (target.source === "continue") {
      saveProgress(guildId, script.id, {
        [AWAKEN_CONTINUE_KEY]: target.sceneId,
        ...clearPendingPromptPatch(),
      }, { db: ctx.db });

      await resumeAwakeningAfterPromptSubmit({ interaction, ctx, script, guildId, source: target.source });
      return true;
    }

    const scene = script.scenes[target.sceneId];
    const prompt = scene?.prompt;
    if (!scene || !prompt || prompt.key !== target.key) {
      await replyEphemeral(interaction, "This awakening prompt is stale. Run /meepo awaken again.");
      return true;
    }

    if (target.source === "modal_open") {
      if (prompt.type !== "modal_text") {
        await replyEphemeral(interaction, "This awakening prompt is stale. Run /meepo awaken again.");
        return true;
      }
      if (typeof interaction.showModal !== "function") {
        await replyEphemeral(interaction, "This client cannot open the text prompt. Use /lab awaken respond text:<text>.");
        return true;
      }
      const modal = buildModalTextSubmitModal({
        prompt,
        sceneId: target.sceneId,
        key: target.key,
        nonce: target.nonce,
      });
      logAwakenResponseLifecycle({
        marker: "AWAKEN_MODAL_OPEN_BEFORE_SHOW_MODAL",
        interaction,
        ctx,
        operation: "showModal",
        helperName: "handleAwakeningChoicePromptInteraction",
        extra: {
          origin_branch: "modal_submit",
          selected_op: "showModal",
          prompt_kind: target.kind,
          prompt_type: prompt.type,
          ...getPayloadDiagnostics(modal),
        },
      });
      try {
        await interaction.showModal(modal);
      } catch (showModalError) {
        logAwakenResponseLifecycle({
          marker: "AWAKEN_MODAL_OPEN_SHOW_MODAL_ERROR",
          interaction,
          ctx,
          operation: "showModal",
          helperName: "handleAwakeningChoicePromptInteraction",
          level: "error",
          error: showModalError,
          extra: {
            origin_branch: "modal_submit",
            selected_op: "showModal",
            prompt_kind: target.kind,
            prompt_type: prompt.type,
          },
        });
        throw showModalError;
      }
      logAwakenResponseLifecycle({
        marker: "AWAKEN_MODAL_OPEN_AFTER_SHOW_MODAL",
        interaction,
        ctx,
        operation: "showModal",
        helperName: "handleAwakeningChoicePromptInteraction",
        extra: {
          origin_branch: "modal_submit",
          selected_op: "showModal",
          prompt_kind: target.kind,
          prompt_type: prompt.type,
        },
      });
      return true;
    }

    if (target.source === "choice") {
    if (prompt.type !== "choice") {
      await replyEphemeral(interaction, "This awakening prompt is stale. Run /meepo awaken again.");
      return true;
    }
    const selectedValue = resolveChoicePromptValue(prompt, target.optionIndex ?? -1);
    if (!selectedValue) {
      await replyEphemeral(interaction, "Invalid awakening choice. Run /meepo awaken again.");
      return true;
    }
    saveProgress(guildId, script.id, {
      [prompt.key]: selectedValue,
      ...clearPendingPromptPatch(),
    }, { db: ctx.db });
      await resumeAwakeningAfterPromptSubmit({ interaction, ctx, script, guildId, source: target.source });
      return true;
    }

    if (target.source === "role_select") {
    if (prompt.type !== "role_select") {
      await replyEphemeral(interaction, "This awakening prompt is stale. Run /meepo awaken again.");
      return true;
    }
    const selectedRoleId = Array.isArray(interaction.values) && interaction.values.length === 1
      ? String(interaction.values[0] ?? "").trim()
      : "";
    if (!selectedRoleId) {
      await replyEphemeral(interaction, "Invalid awakening choice. Run /meepo awaken again.");
      return true;
    }
    saveProgress(guildId, script.id, {
      [prompt.key]: selectedRoleId,
      ...clearPendingPromptPatch(),
    }, { db: ctx.db });
      await resumeAwakeningAfterPromptSubmit({ interaction, ctx, script, guildId, source: target.source });
      return true;
    }

    if (target.source === "modal_submit") {
    if (prompt.type !== "modal_text") {
      await replyEphemeral(interaction, "This awakening prompt is stale. Run /meepo awaken again.");
      return true;
    }
    const text = String(interaction.fields?.getTextInputValue?.(AWAKEN_MODAL_INPUT_ID) ?? "");
    let normalized = "";
    try {
      normalized = resolveModalTextFallback(text);
    } catch {
      await replyEphemeral(interaction, "Text prompt cannot be empty.");
      return true;
    }
    saveProgress(guildId, script.id, {
      [prompt.key]: normalized,
      ...clearPendingPromptPatch(),
    }, { db: ctx.db });
      await resumeAwakeningAfterPromptSubmit({ interaction, ctx, script, guildId, source: target.source });
      return true;
    }

    if (target.source === "channel_select") {
    if (prompt.type !== "channel_select") {
      await replyEphemeral(interaction, "This awakening prompt is stale. Run /meepo awaken again.");
      return true;
    }
    const selectedChannelId = Array.isArray(interaction.values) && interaction.values.length === 1
      ? String(interaction.values[0] ?? "").trim()
      : "";
    if (!selectedChannelId) {
      await replyEphemeral(interaction, "Invalid awakening choice. Run /meepo awaken again.");
      return true;
    }

    const selectedChannel = await interaction.guild?.channels?.fetch?.(selectedChannelId).catch(() => null);
    const filter = (prompt as Record<string, unknown>).filter === "voice" ? "voice" : "text";
    const isValidForFilter = filter === "voice"
      ? Boolean(selectedChannel?.isVoiceBased?.())
      : Boolean(selectedChannel?.isTextBased?.()) && !selectedChannel?.isVoiceBased?.();
    if (!isValidForFilter) {
      await replyEphemeral(interaction, "Invalid awakening choice. Run /meepo awaken again.");
      return true;
    }

    const oldChannelIdRaw = state.progress_json[prompt.key];
    const oldChannelId = typeof oldChannelIdRaw === "string" ? oldChannelIdRaw : interaction.channelId;
    saveProgress(guildId, script.id, {
      [prompt.key]: selectedChannelId,
      ...clearPendingPromptPatch(),
    }, { db: ctx.db });

    await runChannelDriftBestEffort({
      interaction,
      scene,
      oldChannelId: String(oldChannelId ?? interaction.channelId ?? ""),
      newChannelId: selectedChannelId,
    });

      await resumeAwakeningAfterPromptSubmit({
        interaction,
        ctx,
        script,
        guildId,
        runtimeChannelId: selectedChannelId,
        source: target.source,
      });
      return true;
    }

    if (target.source === "registry_add") {
      if (prompt.type !== "registry_builder" || typeof interaction.showModal !== "function") {
        await replyEphemeral(interaction, "This awakening prompt is stale. Run /meepo awaken again.");
        return true;
      }

      const modal = buildModalTextSubmitModal({
        prompt: { ...prompt, label: "Character name" },
        sceneId: target.sceneId,
        key: target.key,
        nonce: target.nonce,
      });
      modal.setCustomId(`awaken:rb:name:${encodeURIComponent(target.sceneId)}:${encodeURIComponent(target.key)}:${encodeURIComponent(target.nonce)}`);
      logAwakenResponseLifecycle({
        marker: "AWAKEN_REGISTRY_ADD_BEFORE_SHOW_MODAL",
        interaction,
        ctx,
        operation: "showModal",
        helperName: "handleAwakeningChoicePromptInteraction",
        extra: {
          origin_branch: "modal_submit",
          selected_op: "showModal",
          prompt_kind: target.kind,
          prompt_type: prompt.type,
          ...getPayloadDiagnostics(modal),
        },
      });
      try {
        await interaction.showModal(modal);
      } catch (showModalError) {
        logAwakenResponseLifecycle({
          marker: "AWAKEN_REGISTRY_ADD_SHOW_MODAL_ERROR",
          interaction,
          ctx,
          operation: "showModal",
          helperName: "handleAwakeningChoicePromptInteraction",
          level: "error",
          error: showModalError,
          extra: {
            origin_branch: "modal_submit",
            selected_op: "showModal",
            prompt_kind: target.kind,
            prompt_type: prompt.type,
          },
        });
        throw showModalError;
      }
      logAwakenResponseLifecycle({
        marker: "AWAKEN_REGISTRY_ADD_AFTER_SHOW_MODAL",
        interaction,
        ctx,
        operation: "showModal",
        helperName: "handleAwakeningChoicePromptInteraction",
        extra: {
          origin_branch: "modal_submit",
          selected_op: "showModal",
          prompt_kind: target.kind,
          prompt_type: prompt.type,
        },
      });
      return true;
    }

    if (target.source === "registry_name_modal") {
    if (prompt.type !== "registry_builder") {
      await replyEphemeral(interaction, "This awakening prompt is stale. Run /meepo awaken again.");
      return true;
    }
    const text = String(interaction.fields?.getTextInputValue?.(AWAKEN_MODAL_INPUT_ID) ?? interaction.fields?.getTextInputValue?.(AWAKEN_REGISTRY_NAME_INPUT_ID) ?? "");
    const characterName = text.trim();
    if (!characterName) {
      await replyEphemeral(interaction, "Character name cannot be empty.");
      return true;
    }

    saveProgress(guildId, script.id, {
      _rb_pending_character_name: characterName,
    }, { db: ctx.db });

    const refreshed = loadState(guildId, script.id, { db: ctx.db });
    const refreshedPending = getPendingPromptFromState(refreshed);
    if (refreshed && refreshedPending) {
      logAwakenResponseLifecycle({
        marker: "AWAKEN_RENDER_PENDING_PROMPT_CALL",
        interaction,
        ctx,
        extra: {
          origin_branch: "modal_submit",
          pending_kind: refreshedPending.kind,
          pending_key: refreshedPending.key,
          pending_nonce: refreshedPending.nonce,
        },
      });
      await renderPendingAwakeningPrompt({
        interaction,
        script,
        state: refreshed,
        pending: refreshedPending,
        originBranch: "modal_submit",
      });
    }
      return true;
    }

    if (target.source === "registry_user") {
    if (prompt.type !== "registry_builder") {
      await replyEphemeral(interaction, "This awakening prompt is stale. Run /meepo awaken again.");
      return true;
    }
    const selectedUserId = Array.isArray(interaction.values) && interaction.values.length === 1
      ? String(interaction.values[0] ?? "").trim()
      : "";
    const characterNameRaw = state.progress_json._rb_pending_character_name;
    const characterName = typeof characterNameRaw === "string" ? characterNameRaw.trim() : "";
    if (!selectedUserId || !characterName) {
      await replyEphemeral(interaction, "Registry entry is incomplete. Add player again.");
      return true;
    }
    const existing = Array.isArray(state.progress_json[prompt.key]) ? state.progress_json[prompt.key] as any[] : [];
    saveProgress(guildId, script.id, {
      [prompt.key]: [...existing, { user_id: selectedUserId, character_name: characterName }],
      _rb_pending_character_name: null,
    }, { db: ctx.db });

    const refreshed = loadState(guildId, script.id, { db: ctx.db });
    const refreshedPending = getPendingPromptFromState(refreshed);
    if (refreshed && refreshedPending) {
      logAwakenResponseLifecycle({
        marker: "AWAKEN_RENDER_PENDING_PROMPT_CALL",
        interaction,
        ctx,
        extra: {
          origin_branch: "resume",
          pending_kind: refreshedPending.kind,
          pending_key: refreshedPending.key,
          pending_nonce: refreshedPending.nonce,
        },
      });
      await renderPendingAwakeningPrompt({
        interaction,
        script,
        state: refreshed,
        pending: refreshedPending,
        originBranch: "resume",
      });
    }
      return true;
    }

    if (target.source === "registry_done") {
    if (prompt.type !== "registry_builder") {
      await replyEphemeral(interaction, "This awakening prompt is stale. Run /meepo awaken again.");
      return true;
    }
    saveProgress(guildId, script.id, {
      ...clearPendingPromptPatch(),
      _rb_pending_character_name: null,
    }, { db: ctx.db });
      await resumeAwakeningAfterPromptSubmit({ interaction, ctx, script, guildId, source: target.source });
      return true;
    }

    return false;
  } catch (error) {
    const fallbackCode: AwakenBoundaryCode = target.source.includes("modal") || target.source === "registry_add"
      ? "ERR_AWAKEN_MODAL"
      : "ERR_AWAKEN_PROMPT";
    const diag = getAwakenDiag(error);
    const normalized = toAwakenBoundaryError({
      error,
      fallbackCode,
      traceId: ctx.trace_id,
      interactionId: ctx.interaction_id,
      metadata: {
        stage: "prompt_interaction",
        source: target.source,
        scene_id: target.sceneId,
        pending_prompt_key: target.key,
        pending_prompt_nonce: target.nonce,
        ...diag,
      },
    });
    let content = formatUserFacingError(normalized, {
      trace_id: ctx.trace_id,
      interaction_id: ctx.interaction_id,
    }).content;
    if (normalized.code === "ERR_AWAKEN_PROMPT") {
      content = withAwakenPromptDiagnosticSuffix(content, {
        origin_branch: diag?.origin_branch ?? target.source,
        selected_op: diag?.selected_op,
        helper_name: diag?.helper_name,
      });
    }

    logAwakenStage({
      level: "error",
      stage: "prompt_interaction_error",
      label: "Awakening prompt interaction failed",
      interaction,
      ctx,
      pending: {
        key: target.key,
        nonce: target.nonce,
        kind: target.kind,
      },
      extra: {
        source: target.source,
        error_code: normalized.code,
        error: normalized.message,
        raw_error: serializeInteractionError(error),
      },
    });

    await replyEphemeral(interaction, content, {
      ctx,
      marker: "AWAKEN_PROMPT_INTERACTION_ERROR",
      originBranch: target.source === "modal_submit" || target.source.includes("modal") ? "modal_submit" : "resume",
    });
    return true;
  }
}

async function runDoctorChecks(interaction: any, ctx: CommandCtx): Promise<DoctorCheck[]> {
  const guildId = interaction.guildId as string;
  const channel = interaction.channel;
  const botMember = interaction.guild?.members?.me ?? null;
  const checks: DoctorCheck[] = [];

  const campaignSlug = ctx.campaignSlug;
  checks.push(
    campaignSlug
      ? { icon: "✅", label: "Campaign slug resolved", action: "No action needed" }
      : { icon: "❌", label: "Campaign slug missing", action: "Run /meepo awaken to initialize guild setup" }
  );

  const textPerms = channel && botMember ? channel.permissionsFor(botMember) : null;
  const canSend = Boolean(textPerms?.has(PermissionFlagsBits.SendMessages));
  const canEmbed = Boolean(textPerms?.has(PermissionFlagsBits.EmbedLinks));
  const canAttach = Boolean(textPerms?.has(PermissionFlagsBits.AttachFiles));
  checks.push(
    canSend
      ? { icon: "✅", label: "Send messages in current channel", action: "No action needed" }
      : { icon: "❌", label: "Cannot send messages in current channel", action: "Grant Send Messages for the bot in this channel" }
  );
  checks.push(
    canEmbed
      ? { icon: "✅", label: "Embed links in current channel", action: "No action needed" }
      : { icon: "⚠️", label: "Embed links unavailable", action: "Grant Embed Links to improve rich status output" }
  );
  checks.push(
    canAttach
      ? { icon: "✅", label: "Attach files in current channel", action: "No action needed" }
      : { icon: "⚠️", label: "Attach files unavailable", action: "Grant Attach Files so recap exports can upload" }
  );

  const homeVoice = getGuildHomeVoiceChannelId(guildId);
  if (!homeVoice) {
    checks.push({
      icon: "⚠️",
      label: "Home voice channel not configured",
      action: "Set one with /meepo settings set home-voice:<channel>",
    });
  } else {
    try {
      const voiceChannel = await interaction.guild.channels.fetch(homeVoice);
      if (!voiceChannel || !voiceChannel.isVoiceBased()) {
        checks.push({
          icon: "❌",
          label: "Home voice channel invalid",
          action: "Set a valid voice channel with /meepo settings set home-voice:<channel>",
        });
      } else {
        const voicePerms = voiceChannel.permissionsFor(botMember);
        const canConnect = Boolean(voicePerms?.has(PermissionFlagsBits.Connect));
        const canSpeak = Boolean(voicePerms?.has(PermissionFlagsBits.Speak));
        checks.push(
          canConnect && canSpeak
            ? { icon: "✅", label: "Voice connect/speak permissions", action: "No action needed" }
            : {
                icon: "❌",
                label: "Voice connect/speak missing",
                action: "Grant Connect and Speak in the configured home voice channel",
              }
        );
      }
    } catch {
      checks.push({
        icon: "❌",
        label: "Home voice channel lookup failed",
        action: "Re-set home voice with /meepo settings set home-voice:<channel>",
      });
    }
  }

  checks.push(
    cfg.openai.apiKey
      ? { icon: "✅", label: "OPENAI_API_KEY configured", action: "No action needed" }
      : { icon: "❌", label: "OPENAI_API_KEY missing", action: "Set OPENAI_API_KEY in environment before starting the bot" }
  );

  checks.push(
    hasTtsAvailable()
      ? { icon: "✅", label: "TTS provider available", action: "No action needed" }
      : { icon: "⚠️", label: "TTS unavailable (text-only mode)", action: "Set TTS_ENABLED=1 and non-noop TTS_PROVIDER to enable voice replies" }
  );

  const session = (getActiveSession(guildId) as SessionRow | null) ?? getMostRecentSession(guildId);
  if (!session) {
    checks.push({
      icon: "⚠️",
      label: "No session data yet",
      action: "Run /meepo awaken then start a session and generate a recap",
    });
  } else {
    const baseStatus = getBaseStatus(guildId, ctx.campaignSlug, session.session_id, session.label);
    checks.push(
      baseStatus.exists
        ? { icon: "✅", label: "Base recap artifact present", action: "No action needed" }
        : { icon: "⚠️", label: "Base recap artifact missing", action: "Run /meepo sessions recap to generate base + final artifacts" }
    );
  }

  if (cfg.logging.level === "debug" || cfg.logging.level === "trace") {
    const worker = getMeepoContextWorkerStatus(guildId);
    checks.push({
      icon: "✅",
      label: `Context queue q=${worker.queue.queuedCount} l=${worker.queue.leasedCount} f=${worker.queue.failedCount}`,
      action: `worker=${worker.enabled ? "enabled" : "disabled"}/${worker.running ? "running" : "stopped"}`,
    });
  }

  return checks;
}

function formatRecapStatusForList(session: SessionRow, recap: SessionArtifactRow | null): string {
  if (!canGenerateRecap(session)) return "—";
  return recap ? "✅" : "❌";
}

function formatSessionChoice(session: SessionRow, idx: number): { name: string; value: string } {
  const label = session.label ?? "(unlabeled)";
  const date = new Date(session.started_at_ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const idShort = String(session.session_id).slice(0, 8);
  return {
    name: `#${idx + 1} — ${label} (${date}, ${idShort})`.slice(0, 100),
    value: String(session.session_id),
  };
}

async function ensureVoiceConnection(interaction: any, guildId: string): Promise<{
  joinedVoiceChannelId: string | null;
  stayPutNotice: string | null;
  notInVoiceNotice: string | null;
}> {
  const guild = interaction.guild;
  const member = await guild.members.fetch(interaction.user.id);
  const invokerVoiceChannelId = member.voice.channelId ?? null;
  const currentVoiceState = getVoiceState(guildId);

  if (currentVoiceState) {
    startReceiver(guildId);
    setVoiceHushEnabled(guildId, true);
    return {
      joinedVoiceChannelId: null,
      stayPutNotice:
        invokerVoiceChannelId && invokerVoiceChannelId !== currentVoiceState.channelId
          ? metaMeepoVoice.wake.stayPutNotice(formatChannel(currentVoiceState.channelId))
          : null,
      notInVoiceNotice: null,
    };
  }

  if (!invokerVoiceChannelId) {
    return {
      joinedVoiceChannelId: null,
      stayPutNotice: null,
      notInVoiceNotice: metaMeepoVoice.wake.notInVoiceNotice(),
    };
  }

  const connection = await joinVoice({
    guildId,
    channelId: invokerVoiceChannelId,
    adapterCreator: guild.voiceAdapterCreator,
  });

  setVoiceState(guildId, {
    channelId: invokerVoiceChannelId,
    connection,
    guild,
    sttEnabled: true,
    hushEnabled: true,
    connectedAt: Date.now(),
  });

  startReceiver(guildId);

  if (!getGuildHomeVoiceChannelId(guildId)) {
    setGuildHomeVoiceChannelId(guildId, invokerVoiceChannelId);
  }

  return {
    joinedVoiceChannelId: invokerVoiceChannelId,
    stayPutNotice: null,
    notInVoiceNotice: null,
  };
}

export async function executeLabAwakenRespond(interaction: any, ctx: CommandCtx, responseTextRaw: string): Promise<void> {
  const guildId = interaction.guildId as string;
  const script = await loadAwakenScript("meepo_awaken");
  const state = loadState(guildId, script.id, { db: ctx.db });
  const pending = getPendingPromptFromState(state);
  if (!state || !pending || pending.kind !== "modal_text") {
    await interaction.reply({
      content: "No pending text prompt.",
      ephemeral: true,
    });
    return;
  }

  if (!canAnswerAwakeningPrompt(guildId, interaction)) {
    await interaction.reply({
      content: "Only the Dungeon Master can answer this awakening prompt.",
      ephemeral: true,
    });
    return;
  }

  const normalized = resolveModalTextFallback(responseTextRaw);
  saveProgress(guildId, script.id, {
    [pending.key]: normalized,
    ...clearPendingPromptPatch(),
  }, { db: ctx.db });

  repairDmDisplayNameMemory({
    db: ctx.db,
    guildId,
    scriptId: script.id,
  });

  if (!interaction.deferred && !interaction.replied && typeof interaction.deferReply === "function") {
    await interaction.deferReply({ ephemeral: true });
  }

  const stateBeforeRun = loadState(guildId, script.id, { db: ctx.db });
  const pendingBeforeRun = getPendingPromptFromState(stateBeforeRun);
  logAwakenStage({
    level: "info",
    stage: "lab_respond_engine_start",
    label: "Lab awaken respond engine start",
    interaction,
    ctx,
    script,
    state: stateBeforeRun,
    pending: pendingBeforeRun,
  });

  try {
    const result = await AwakenEngine.runWake(interaction, {
      db: ctx.db,
      script,
      runtimeChannelId: interaction.channelId,
    });

    logAwakenStage({
      level: "info",
      stage: "lab_respond_engine_success",
      label: "Lab awaken respond engine success",
      interaction,
      ctx,
      script,
      state: stateBeforeRun,
      pending: pendingBeforeRun,
      extra: {
        run_status: result.status,
        run_reason: (result as { reason?: string }).reason,
      },
    });

    const refreshedAfterRun = loadState(guildId, script.id, { db: ctx.db });
    const refreshedPending = getPendingPromptFromState(refreshedAfterRun);
    if (refreshedAfterRun && refreshedPending) {
      logAwakenResponseLifecycle({
        marker: "AWAKEN_RENDER_PENDING_PROMPT_CALL",
        interaction,
        ctx,
        extra: {
          origin_branch: "lab_respond",
          pending_kind: refreshedPending.kind,
          pending_key: refreshedPending.key,
          pending_nonce: refreshedPending.nonce,
        },
      });
      const rendered = await renderPendingAwakeningPrompt({
        interaction,
        script,
        state: refreshedAfterRun,
        pending: refreshedPending,
        originBranch: "lab_respond",
      });
      if (rendered) return;
    }

    await interaction.editReply(formatAwakenStatus(result));
  } catch (error) {
    const normalized = toAwakenBoundaryError({
      error,
      fallbackCode: "ERR_AWAKEN_MODEL",
      traceId: ctx.trace_id,
      interactionId: ctx.interaction_id,
      metadata: {
        stage: "lab_respond_engine",
        scene_id: stateBeforeRun?.current_scene,
        script_id: script.id,
        script_version: script.version,
        pending_prompt_key: pendingBeforeRun?.key,
        pending_prompt_nonce: pendingBeforeRun?.nonce,
      },
    });

    logAwakenStage({
      level: "error",
      stage: "lab_respond_engine_error",
      label: "Lab awaken respond engine failed",
      interaction,
      ctx,
      script,
      state: stateBeforeRun,
      pending: pendingBeforeRun,
      extra: {
        error_code: normalized.code,
        error: normalized.message,
      },
    });

    const payload = formatUserFacingError(normalized, {
      trace_id: ctx.trace_id,
      interaction_id: ctx.interaction_id,
    });
    await replyEphemeral(interaction, payload.content);
  }
}

async function handleAwaken(interaction: any, ctx: CommandCtx): Promise<void> {
  const guildId = interaction.guildId as string;
  logAwakenStage({
    level: "info",
    stage: "awaken_handler_enter",
    label: "Awakening handler entered",
    interaction,
    ctx,
    extra: {
      marker: "awaken-hardening-v3-2026-03-06",
      pid: process.pid,
      deferred: Boolean(interaction?.deferred),
      replied: Boolean(interaction?.replied),
    },
  });
  const alreadyAwakeMessage = "Meepo is already awake in this world, meep. Use /lab awaken reset to run onboarding again.";
  if (ctx?.db && typeof ctx.db.exec === "function") {
    logAwakenResponseLifecycle({
      marker: "AWAKEN_DB_CONTEXT_BRANCH_ENTER",
      interaction,
      ctx,
    });
    const script = await loadAwakenScript("meepo_awaken");
    const responseTextRaw = interaction.options.getString("response")?.trim() ?? "";
    const hasResponseText = responseTextRaw.length > 0;

    logAwakenResponseLifecycle({
      marker: "AWAKEN_DEV_FALLBACK_CHECK",
      interaction,
      ctx,
      extra: {
        has_response_text: hasResponseText,
      },
    });

    if (hasResponseText) {
      logAwakenResponseLifecycle({
        marker: "AWAKEN_DEV_FALLBACK_BRANCH_ENTER",
        interaction,
        ctx,
      });
      if (!isDevUser(interaction.user?.id)) {
        await replyEphemeral(
          interaction,
          "This fallback command has moved to /lab awaken respond.",
          { ctx, marker: "AWAKEN_DEV_FALLBACK_DENIED" }
        );
        return;
      }
      await executeLabAwakenRespond(interaction, ctx, responseTextRaw);
      return;
    }

    repairDmDisplayNameMemory({
      db: ctx.db,
      guildId,
      scriptId: script.id,
    });

    logAwakenResponseLifecycle({
      marker: "AWAKEN_AWAKENED_STATE_READ_START",
      interaction,
      ctx,
    });
    const guildConfig = getGuildConfig(guildId);
    logAwakenResponseLifecycle({
      marker: "AWAKEN_AWAKENED_STATE_READ_RESULT",
      interaction,
      ctx,
      extra: {
        awakened_flag: guildConfig?.awakened ?? null,
      },
    });
    if (guildConfig?.awakened === 1) {
      logAwakenResponseLifecycle({
        marker: "AWAKEN_ALREADY_AWAKENED_BRANCH_ENTER",
        interaction,
        ctx,
      });
      logAwakenResponseLifecycle({
        marker: "AWAKEN_ALREADY_AWAKENED_BEFORE_REPLY",
        interaction,
        ctx,
        operation: "replyEphemeral",
      });
      await replyEphemeral(interaction, alreadyAwakeMessage, {
        ctx,
        marker: "AWAKEN_ALREADY_AWAKENED",
        originBranch: "already_awakened",
      });
      logAwakenResponseLifecycle({
        marker: "AWAKEN_ALREADY_AWAKENED_AFTER_REPLY",
        interaction,
        ctx,
        operation: "replyEphemeral",
      });
      return;
    }

    logAwakenResponseLifecycle({
      marker: "AWAKEN_ONBOARDING_STATE_READ_START",
      interaction,
      ctx,
      extra: {
        script_id: script.id,
      },
    });
    let refreshedState = loadState(guildId, script.id, { db: ctx.db });
    logAwakenResponseLifecycle({
      marker: "AWAKEN_ONBOARDING_STATE_READ_RESULT",
      interaction,
      ctx,
      extra: {
        state_exists: Boolean(refreshedState),
        current_scene: refreshedState?.current_scene,
        completed: Boolean(refreshedState?.completed),
      },
    });

    const hasValidScene = refreshedState ? Boolean(script.scenes[refreshedState.current_scene]) : true;
    const needsStateReset = Boolean(
      refreshedState
      && (!hasValidScene || refreshedState.script_version !== script.version)
    );

    logAwakenResponseLifecycle({
      marker: "AWAKEN_STALE_STATE_CHECK",
      interaction,
      ctx,
      extra: {
        has_valid_scene: hasValidScene,
        needs_state_reset: needsStateReset,
        current_scene: refreshedState?.current_scene,
        state_script_version: refreshedState?.script_version,
        script_version: script.version,
      },
    });

    if (needsStateReset) {
      logAwakenResponseLifecycle({
        marker: "AWAKEN_STALE_STATE_RESET_START",
        interaction,
        ctx,
      });
      // Old onboarding rows can reference scenes removed by script updates.
      // Reset to script start so /meepo awaken recovers instead of bubbling ERR_UNKNOWN.
      ctx.db
        .prepare("DELETE FROM guild_onboarding_state WHERE guild_id = ? AND script_id = ?")
        .run(guildId, script.id);
      refreshedState = null;
      logAwakenResponseLifecycle({
        marker: "AWAKEN_STALE_STATE_RESET_DONE",
        interaction,
        ctx,
      });
    }

    if (refreshedState?.completed) {
      logAwakenResponseLifecycle({
        marker: "AWAKEN_ALREADY_AWAKENED_BRANCH_ENTER",
        interaction,
        ctx,
        extra: {
          source: "onboarding_state_completed",
        },
      });
      logAwakenResponseLifecycle({
        marker: "AWAKEN_ALREADY_AWAKENED_BEFORE_REPLY",
        interaction,
        ctx,
      });
      await replyEphemeral(interaction, alreadyAwakeMessage, {
        ctx,
        marker: "AWAKEN_ALREADY_AWAKENED",
        originBranch: "already_awakened",
      });
      logAwakenResponseLifecycle({
        marker: "AWAKEN_ALREADY_AWAKENED_AFTER_REPLY",
        interaction,
        ctx,
      });
      return;
    }

    if (!refreshedState) {
      logAwakenResponseLifecycle({
        marker: "AWAKEN_ONBOARDING_INIT_START",
        interaction,
        ctx,
        extra: {
          start_scene: script.start_scene,
          script_version: script.version,
        },
      });
      initState(guildId, script.id, script.version, script.start_scene, { db: ctx.db });
      logAwakenResponseLifecycle({
        marker: "AWAKEN_ONBOARDING_INIT_DONE",
        interaction,
        ctx,
      });
    }

    logAwakenResponseLifecycle({
      marker: "AWAKEN_ONBOARDING_PROGRESS_SAVE_START",
      interaction,
      ctx,
    });
    saveProgress(guildId, script.id, {
      [AWAKEN_INVOKER_USER_ID_KEY]: interaction.user?.id ?? null,
    }, { db: ctx.db });
    logAwakenResponseLifecycle({
      marker: "AWAKEN_ONBOARDING_PROGRESS_SAVE_DONE",
      interaction,
      ctx,
    });

    if (!interaction.deferred && !interaction.replied && typeof interaction.deferReply === "function") {
      logAwakenResponseLifecycle({
        marker: "AWAKEN_INITIAL_PROMPT_BEFORE_DEFER",
        interaction,
        ctx,
        operation: "deferReply",
      });
      await interaction.deferReply({ ephemeral: true });
      logAwakenResponseLifecycle({
        marker: "AWAKEN_INITIAL_PROMPT_AFTER_DEFER",
        interaction,
        ctx,
        operation: "deferReply",
      });
    }

    const stateBeforeRun = loadState(guildId, script.id, { db: ctx.db });
    const pendingBeforeRun = getPendingPromptFromState(stateBeforeRun);
    logAwakenStage({
      level: "info",
      stage: "initial_engine_start",
      label: "Awakening initial engine start",
      interaction,
      ctx,
      script,
      state: stateBeforeRun,
      pending: pendingBeforeRun,
      awakenedFlag: guildConfig?.awakened ?? null,
    });

    let result: AwakenRunResult;
    try {
      result = await AwakenEngine.runWake(interaction, {
        db: ctx.db,
        script,
        runtimeChannelId: interaction.channelId,
      });
    } catch (error) {
      const normalized = toAwakenBoundaryError({
        error,
        fallbackCode: "ERR_AWAKEN_MODEL",
        traceId: ctx.trace_id,
        interactionId: ctx.interaction_id,
        metadata: {
          stage: "initial_engine",
          script_id: script.id,
          script_version: script.version,
          scene_id: stateBeforeRun?.current_scene,
          pending_prompt_key: pendingBeforeRun?.key,
          pending_prompt_nonce: pendingBeforeRun?.nonce,
          awakened_flag: guildConfig?.awakened ?? null,
        },
      });
      logAwakenStage({
        level: "error",
        stage: "initial_engine_error",
        label: "Awakening initial engine failed",
        interaction,
        ctx,
        script,
        state: stateBeforeRun,
        pending: pendingBeforeRun,
        awakenedFlag: guildConfig?.awakened ?? null,
        extra: {
          error_code: normalized.code,
          error: normalized.message,
        },
      });
      const payload = formatUserFacingError(normalized, {
        trace_id: ctx.trace_id,
        interaction_id: ctx.interaction_id,
      });
      await replyEphemeral(interaction, payload.content, {
        ctx,
        marker: "AWAKEN_INITIAL_ENGINE_ERROR",
        originBranch: "initial_prompt",
      });
      return;
    }

    logAwakenStage({
      level: "info",
      stage: "initial_engine_success",
      label: "Awakening initial engine success",
      interaction,
      ctx,
      script,
      state: stateBeforeRun,
      pending: pendingBeforeRun,
      awakenedFlag: guildConfig?.awakened ?? null,
      extra: {
        run_status: result.status,
        run_reason: (result as { reason?: string }).reason,
      },
    });

    const editReply = async (content: string): Promise<void> => {
      if (typeof interaction.editReply === "function" && (interaction.deferred || interaction.replied)) {
        logAwakenResponseLifecycle({
          marker: "AWAKEN_HANDLE_AWAKEN_BEFORE_EDIT_REPLY",
          interaction,
          ctx,
          operation: "editReply",
        });
        await interaction.editReply(content);
        logAwakenResponseLifecycle({
          marker: "AWAKEN_HANDLE_AWAKEN_AFTER_EDIT_REPLY",
          interaction,
          ctx,
          operation: "editReply",
        });
        return;
      }
      if (typeof interaction.reply === "function" && !interaction.replied) {
        logAwakenResponseLifecycle({
          marker: "AWAKEN_HANDLE_AWAKEN_BEFORE_REPLY",
          interaction,
          ctx,
          operation: "reply",
        });
        await interaction.reply({ content, ephemeral: true });
        logAwakenResponseLifecycle({
          marker: "AWAKEN_HANDLE_AWAKEN_AFTER_REPLY",
          interaction,
          ctx,
          operation: "reply",
        });
      }
    };

    const statusText = (runResult: AwakenRunResult): string => {
      return formatAwakenStatus(runResult);
    };

    const stateAfterRun = loadState(guildId, script.id, { db: ctx.db });
    const pendingPrompt = getPendingPromptFromState(stateAfterRun);
    if (stateAfterRun && pendingPrompt) {
      logAwakenResponseLifecycle({
        marker: "AWAKEN_INITIAL_PROMPT_BRANCH_ENTER",
        interaction,
        ctx,
        extra: {
          pending_kind: pendingPrompt.kind,
          pending_key: pendingPrompt.key,
          pending_scene_id: pendingPrompt.sceneId,
          pending_nonce: pendingPrompt.nonce,
        },
      });
      if (pendingPrompt.kind !== "continue") {
        logAwakenResponseLifecycle({
          marker: pendingPrompt.kind === "modal_text"
            ? "AWAKEN_INITIAL_PROMPT_BEFORE_MODAL"
            : "AWAKEN_INITIAL_PROMPT_BEFORE_REPLY",
          interaction,
          ctx,
          operation: "edit-or-reply",
        });
        await editReply(metaMeepoVoice.wake.pausedContinuePrompt());
        logAwakenResponseLifecycle({
          marker: pendingPrompt.kind === "modal_text"
            ? "AWAKEN_INITIAL_PROMPT_AFTER_MODAL"
            : "AWAKEN_INITIAL_PROMPT_AFTER_REPLY",
          interaction,
          ctx,
          operation: "edit-or-reply",
        });
        return;
      }

      logAwakenResponseLifecycle({
        marker: "AWAKEN_INITIAL_PROMPT_BEFORE_REPLY",
        interaction,
        ctx,
        operation: "renderPendingAwakeningPrompt",
      });
      try {
        logAwakenResponseLifecycle({
          marker: "AWAKEN_RENDER_PENDING_PROMPT_CALL",
          interaction,
          ctx,
          extra: {
            origin_branch: "initial_prompt",
            pending_kind: pendingPrompt.kind,
            pending_key: pendingPrompt.key,
            pending_nonce: pendingPrompt.nonce,
          },
        });
        const rendered = await renderPendingAwakeningPrompt({
          interaction,
          script,
          state: stateAfterRun,
          pending: pendingPrompt,
          originBranch: "initial_prompt",
        });
        logAwakenResponseLifecycle({
          marker: "AWAKEN_INITIAL_PROMPT_AFTER_REPLY",
          interaction,
          ctx,
          operation: "renderPendingAwakeningPrompt",
          extra: {
            rendered,
            pending_kind: pendingPrompt.kind,
          },
        });
        if (rendered) {
          return;
        }
      } catch (error) {
        const diag = getAwakenDiag(error);
        const normalized = toAwakenBoundaryError({
          error,
          fallbackCode: "ERR_AWAKEN_PROMPT",
          traceId: ctx.trace_id,
          interactionId: ctx.interaction_id,
          metadata: {
            stage: "initial_prompt_render",
            scene_id: pendingPrompt.sceneId,
            pending_prompt_key: pendingPrompt.key,
            pending_prompt_kind: pendingPrompt.kind,
            pending_prompt_nonce: pendingPrompt.nonce,
            ...diag,
          },
        });
        logAwakenStage({
          level: "error",
          stage: "initial_prompt_render_error",
          label: "Awakening initial prompt render failed",
          interaction,
          ctx,
          script,
          state: stateAfterRun,
          pending: pendingPrompt,
          extra: {
            error_code: normalized.code,
            error: normalized.message,
          },
        });
        const payload = formatUserFacingError(normalized, {
          trace_id: ctx.trace_id,
          interaction_id: ctx.interaction_id,
        });
        const content = withAwakenPromptDiagnosticSuffix(payload.content, {
          origin_branch: diag?.origin_branch ?? "initial_prompt",
          selected_op: diag?.selected_op,
          helper_name: diag?.helper_name,
        });
        await replyEphemeral(interaction, content, {
          ctx,
          marker: "AWAKEN_INITIAL_PROMPT_RENDER_ERROR",
          originBranch: "initial_prompt",
        });
        return;
      }
    }

    logAwakenResponseLifecycle({
      marker: "AWAKEN_INITIAL_PROMPT_BEFORE_REPLY",
      interaction,
      ctx,
      operation: "final-status",
    });
    await editReply(statusText(result));
    logAwakenResponseLifecycle({
      marker: "AWAKEN_INITIAL_PROMPT_AFTER_REPLY",
      interaction,
      ctx,
      operation: "final-status",
    });
    return;
  }

  const invocationChannelId = interaction.channelId as string;
  const requestedSessionLabel = interaction.options.getString("session")?.trim() ?? null;

  const setupReport = await ensureGuildSetup({
    guildId,
    guildName: interaction.guild?.name ?? null,
    interaction,
    canonicalWake: Boolean(requestedSessionLabel),
  });

  if (setupReport.errors.length > 0) {
    const setupSummaryLines = renderSetupSummary(setupReport);
    await interaction.reply({
      content: metaMeepoVoice.wake.blockedDueToSetup(setupSummaryLines),
      ephemeral: true,
    });
    return;
  }

  if (!getActiveMeepo(guildId)) {
    wakeMeepo({ guildId, channelId: invocationChannelId });
  }

  let joinedVoiceChannelId: string | null = null;
  let stayPutNotice: string | null = null;
  let notInVoiceNotice: string | null = null;
  if (setupReport.canAttemptVoice) {
    const voiceResult = await ensureVoiceConnection(interaction, guildId);
    joinedVoiceChannelId = voiceResult.joinedVoiceChannelId;
    stayPutNotice = voiceResult.stayPutNotice;
    notInVoiceNotice = voiceResult.notInVoiceNotice;
  } else {
    notInVoiceNotice = metaMeepoVoice.wake.voiceConnectSkipped();
  }

  setReplyMode(ctx.db, guildId, "text");
  setVoiceHushEnabled(guildId, true);

  const previousSession = getActiveSession(guildId);
  let startedSession: SessionRow | null = null;
  let endedPrevious = false;

  if (previousSession) {
    if (requestedSessionLabel) {
      endSession(guildId, "session_switch");
      endedPrevious = true;
      logSystemEvent({
        guildId,
        channelId: invocationChannelId,
        eventType: "SESSION_ENDED",
        content: JSON.stringify({ id: previousSession.session_id }),
        authorId: interaction.user.id,
        authorName: interaction.user.username,
        narrativeWeight: "secondary",
      });
    } else {
      endSession(guildId, "wake_ambient");
      endedPrevious = true;
      logSystemEvent({
        guildId,
        channelId: invocationChannelId,
        eventType: "SESSION_ENDED",
        content: JSON.stringify({ id: previousSession.session_id }),
        authorId: interaction.user.id,
        authorName: interaction.user.username,
        narrativeWeight: "secondary",
      });
    }
  }

  if (requestedSessionLabel) {
    startedSession = startSession(guildId, interaction.user.id, interaction.user.username, {
      label: requestedSessionLabel,
      source: "live",
      modeAtStart: "canon",
      kind: "canon",
    }) as SessionRow;

    logSystemEvent({
      guildId,
      channelId: invocationChannelId,
      eventType: "SESSION_STARTED",
      content: JSON.stringify({ id: startedSession.session_id, label: startedSession.label }),
      authorId: interaction.user.id,
      authorName: interaction.user.username,
      narrativeWeight: "secondary",
    });
  }

  const activeSession = getActiveSession(guildId) as SessionRow | null;
  const effectiveMode = resolveEffectiveMode(guildId);
  const effectivePersonaId = getEffectivePersonaId(guildId);
  const effectivePersona = getPersona(effectivePersonaId);
  const homeText = getGuildHomeTextChannelId(guildId);
  const homeVoice = resolveGuildHomeVoiceChannelId(guildId, cfg.overlay.homeVoiceChannelId ?? null);

  const setupSummaryLines = shouldPrintSetupSummary(guildId, setupReport) ? renderSetupSummary(setupReport) : [];
  const responseLines = metaMeepoVoice.wake.replyLines({
    startedSessionLabel: startedSession?.label ?? null,
    activeSessionLabel: activeSession ? getSessionDisplayLabel(activeSession) : null,
    endedPrevious,
    effectiveMode,
    personaDisplayName: effectivePersona.displayName,
    personaId: effectivePersonaId,
    homeText: formatChannel(homeText),
    homeVoice: formatChannel(homeVoice),
    joinedVoice: joinedVoiceChannelId ? formatChannel(joinedVoiceChannelId) : null,
    stayPutNotice,
    notInVoiceNotice,
    setupSummaryLines,
  });

  await interaction.reply({ content: responseLines.join("\n"), ephemeral: true });
}

async function handleSleep(interaction: any): Promise<void> {
  const guildId = interaction.guildId as string;
  const activeSession = getActiveSession(guildId) as SessionRow | null;

  if (activeSession) {
    endSession(guildId, "sleep");
    logSystemEvent({
      guildId,
      channelId: interaction.channelId,
      eventType: "SESSION_ENDED",
      content: JSON.stringify({ id: activeSession.session_id }),
      authorId: interaction.user.id,
      authorName: interaction.user.username,
      narrativeWeight: "secondary",
    });
  }

  const currentVoiceState = getVoiceState(guildId);
  if (currentVoiceState) {
    stopReceiver(guildId);
    leaveVoice(guildId);
  }

  const changed = sleepMeepo(guildId);

  if (!changed && !activeSession) {
    await interaction.reply({ content: metaMeepoVoice.sleep.alreadyAsleep(), ephemeral: true });
    return;
  }

  if (activeSession) {
    await interaction.reply({
      content: metaMeepoVoice.sleep.sessionEnded(getSessionDisplayLabel(activeSession)),
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({ content: metaMeepoVoice.sleep.asleep(), ephemeral: true });
}

async function handleTalk(interaction: any, ctx: CommandCtx): Promise<void> {
  const guildId = interaction.guildId as string;
  const active = getActiveMeepo(guildId);
  if (!active) {
    await interaction.reply({ content: metaMeepoVoice.talk.requiresWake(), ephemeral: true });
    return;
  }

  const currentVoiceState = getVoiceState(guildId);
  if (!currentVoiceState) {
    await interaction.reply({
      content: metaMeepoVoice.talk.requiresVoiceConnection(),
      ephemeral: true,
    });
    return;
  }

  if (!hasTtsAvailable()) {
    setReplyMode(ctx.db, guildId, "text");
    setVoiceHushEnabled(guildId, true);
    const ttsInfo = getTtsProviderInfo();
    await interaction.reply({
      content: metaMeepoVoice.talk.ttsUnavailable(ttsInfo.name),
      ephemeral: true,
    });
    return;
  }

  setReplyMode(ctx.db, guildId, "voice");
  setVoiceHushEnabled(guildId, false);

  await interaction.reply({
    content: metaMeepoVoice.talk.enabled(),
    ephemeral: true,
  });
}

async function handleHush(interaction: any, ctx: CommandCtx): Promise<void> {
  const guildId = interaction.guildId as string;
  const active = getActiveMeepo(guildId);
  if (!active) {
    await interaction.reply({ content: metaMeepoVoice.hush.requiresWake(), ephemeral: true });
    return;
  }

  const voiceState = getVoiceState(guildId);
  if (voiceState) {
    setVoiceHushEnabled(guildId, true);
    voicePlaybackController.abort(guildId, "hush_mode_enabled", {
      channelId: voiceState.channelId,
      authorId: interaction.user.id,
      authorName: interaction.user.username,
      source: "command",
      logSystemEvent: true,
    });
  }

  setReplyMode(ctx.db, guildId, "text");

  await interaction.reply({
    content: metaMeepoVoice.hush.enabled(),
    ephemeral: true,
  });
}

async function handleSessionsRecap(interaction: any, ctx: CommandCtx): Promise<void> {
  const guildId = interaction.guildId as string;
  const sessionId = interaction.options.getString("session", true);
  const force = interaction.options.getBoolean("force") ?? false;
  const configuredDefaultStyle = getGuildDefaultRecapStyle(guildId);
  const strategy =
    (interaction.options.getString("style") ?? configuredDefaultStyle ?? DEFAULT_RECAP_STRATEGY) as RecapStrategy;

  const session = getSessionById(guildId, sessionId) as SessionRow | null;
  if (!session) {
    await interaction.reply({ content: metaMeepoVoice.sessions.sessionNotFound(), ephemeral: true });
    return;
  }

  if (!canGenerateRecap(session)) {
    await interaction.reply({
      content: metaMeepoVoice.sessions.recapMissingCanon(),
      ephemeral: true,
    });
    return;
  }

  const recapDedupeKey = buildRecapDedupeKey({
    guildId,
    campaignSlug: ctx.campaignSlug,
    sessionId: session.session_id,
    strategy,
  });
  if (inFlightRecapRequests.has(recapDedupeKey)) {
    const payload = formatUserFacingError(new MeepoError("ERR_RECAP_IN_PROGRESS"), {
      trace_id: ctx.trace_id,
      interaction_id: ctx.interaction_id,
    });
    await interaction.reply({
      content: payload.content,
      ephemeral: true,
    });
    return;
  }

  const inFlightForGuild = inFlightRecapCountByGuild.get(guildId) ?? 0;
  if (inFlightForGuild >= RECAP_MAX_CONCURRENT_PER_GUILD) {
    const payload = formatUserFacingError(new MeepoError("ERR_RECAP_CAPACITY_REACHED"), {
      trace_id: ctx.trace_id,
      interaction_id: ctx.interaction_id,
    });
    await interaction.reply({
      content: payload.content,
      ephemeral: true,
    });
    return;
  }

  const nowMs = Date.now();
  const cooldownUntilMs = recapCooldownByKey.get(recapDedupeKey) ?? 0;
  if (cooldownUntilMs > nowMs && !force) {
    const retryAfterSeconds = Math.max(1, Math.ceil((cooldownUntilMs - nowMs) / 1000));
    const payload = formatUserFacingError(
      new MeepoError("ERR_RECAP_RATE_LIMITED", {
        metadata: { retry_after_seconds: retryAfterSeconds },
      }),
      {
        trace_id: ctx.trace_id,
        interaction_id: ctx.interaction_id,
      }
    );
    await interaction.reply({
      content: payload.content,
      ephemeral: true,
    });
    return;
  }

  inFlightRecapRequests.add(recapDedupeKey);
  incrementGuildRecapInFlight(guildId);
  recapCooldownByKey.set(recapDedupeKey, Date.now() + RECAP_COOLDOWN_MS);

  await interaction.deferReply({ ephemeral: true });

  try {
    if (cooldownUntilMs > nowMs && force) {
      logSystemEvent({
        guildId,
        channelId: interaction.channelId,
        eventType: "SESSION_RECAP_COOLDOWN_BYPASSED",
        content: JSON.stringify({
          id: session.session_id,
          strategy,
          force: true,
          cooldown_bypassed: true,
          cooldown_remaining_ms: Math.max(0, cooldownUntilMs - nowMs),
        }),
        authorId: interaction.user.id,
        authorName: interaction.user.username,
        narrativeWeight: "secondary",
      });
    }

    logSystemEvent({
      guildId,
      channelId: interaction.channelId,
      eventType: "SESSION_RECAP_REQUESTED",
      content: JSON.stringify({ id: session.session_id, force, strategy }),
      authorId: interaction.user.id,
      authorName: interaction.user.username,
      narrativeWeight: "secondary",
    });

    const recap = await generateSessionRecap({
      guildId,
      sessionId: session.session_id,
      force,
      strategy,
    });

    const sessionLabel = getSessionDisplayLabel(session);
    const previewText = recap.text.length > 700 ? `${recap.text.slice(0, 700)}…` : recap.text;
    const fileStem = buildSessionArtifactStem({
      guildId,
      campaignSlug: ctx.campaignSlug,
      sessionId: session.session_id,
    });
    const fileName = `${fileStem}-recap-${strategy}.md`;
    const file = new AttachmentBuilder(Buffer.from(recap.text, "utf8"), { name: fileName });

    await interaction.editReply({
      content: metaMeepoVoice.sessions.recapResult({
        cacheHit: recap.cacheHit,
        sessionLabel,
        strategy: recap.strategy,
        finalVersion: recap.finalVersion,
        baseVersion: recap.baseVersion,
        sourceHashShort: recap.sourceTranscriptHash.slice(0, 12),
        previewText,
      }),
      files: [file],
    });

  } finally {
    inFlightRecapRequests.delete(recapDedupeKey);
    decrementGuildRecapInFlight(guildId);
  }
}

async function handleSessions(interaction: any, ctx: CommandCtx): Promise<void> {
  const guildId = interaction.guildId as string;
  const sub = interaction.options.getSubcommand();

  if (sub === "list") {
    const limit = interaction.options.getInteger("limit") ?? 10;
    const rows = listSessions(guildId, limit) as SessionRow[];
    if (rows.length === 0) {
      await interaction.reply({ content: metaMeepoVoice.sessions.listEmpty(), ephemeral: true });
      return;
    }

    const recapBySession = getSessionArtifactMap(
      guildId,
      rows.map((session) => session.session_id),
      "recap_final"
    );

    const lines = metaMeepoVoice.sessions.listLines(
      rows.map((session, index) => {
        const date = new Date(session.started_at_ms).toISOString().replace("T", " ").slice(0, 16);
        const recap = recapBySession.get(session.session_id) as SessionArtifactRow | undefined;
        return {
          index,
          date,
          label: getSessionDisplayLabel(session),
          kindTag: getSessionKindTag(session),
          recapStatus: formatRecapStatusForList(session, recap ?? null),
        };
      })
    );

    await interaction.reply({ content: lines.join("\n"), ephemeral: true });
    return;
  }

  if (sub === "view") {
    const sessionId = interaction.options.getString("session", true);
    const session = getSessionById(guildId, sessionId) as SessionRow | null;

    if (!session) {
      const payload = buildTaxonomyPayload("ERR_NO_ACTIVE_SESSION", ctx, {
        command_surface: "sessions.view",
        requested_session_id: sessionId,
      });
      await interaction.reply({ content: payload.content, ephemeral: true });
      return;
    }

    const recap = getSessionArtifact(guildId, session.session_id, "recap_final") as SessionArtifactRow | null;
    let transcriptArtifact = getSessionArtifact(
      guildId,
      session.session_id,
      "transcript_export"
    ) as SessionArtifactRow | null;
    const effectiveCampaignSlug = ctx.campaignSlug;

    try {
      ensureBronzeTranscriptExportCached({
        guildId,
        campaignSlug: effectiveCampaignSlug,
        sessionId: session.session_id,
        sessionLabel: session.label,
        db: ctx.db,
        timeBudgetMs: TRANSCRIPT_EXPORT_TIME_BUDGET_MS,
      });
      transcriptArtifact = getSessionArtifact(
        guildId,
        session.session_id,
        "transcript_export"
      ) as SessionArtifactRow | null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isTimeBudgetExceeded = message.includes("transcript_export_time_budget_exceeded");
      const payload = buildTaxonomyPayload(
        isTimeBudgetExceeded ? "ERR_STALE_INTERACTION" : "ERR_TRANSCRIPT_UNAVAILABLE",
        ctx,
        {
          command_surface: "sessions.view",
          session_id: session.session_id,
          transcript_state: isTimeBudgetExceeded ? "time_budget_exceeded" : "export_failed",
        }
      );
      await interaction.reply({
        content: payload.content,
        ephemeral: true,
      });
      return;
    }

    if (!transcriptArtifact) {
      const payload = buildTaxonomyPayload("ERR_TRANSCRIPT_UNAVAILABLE", ctx, {
        command_surface: "sessions.view",
        session_id: session.session_id,
        transcript_state: "missing_artifact",
      });
      await interaction.reply({
        content: payload.content,
        ephemeral: true,
      });
      return;
    }

    const baseStatus = getBaseStatus(guildId, effectiveCampaignSlug, session.session_id, session.label);
    const finalFileForDbStyle =
      recap && recap.strategy && RECAP_STRATEGIES.includes(recap.strategy as RecapPassStrategy)
        ? getFinalStatus(guildId, effectiveCampaignSlug, session.session_id, recap.strategy as RecapPassStrategy, session.label)
        : getFinalStatus(guildId, effectiveCampaignSlug, session.session_id, undefined, session.label);
    const allFinalFiles = getAllFinalStatuses(guildId, effectiveCampaignSlug, session.session_id, session.label);
    const hasAnyFinalFiles = allFinalFiles.some((status) => status.exists);

    const recapExists = Boolean(recap);
    let transcriptStatus = transcriptArtifact ? "available" : "unavailable";

    let recapMeta: Record<string, unknown> = {};
    try {
      recapMeta = recap?.meta_json ? (JSON.parse(recap.meta_json) as Record<string, unknown>) : {};
    } catch {
      recapMeta = {};
    }

    const finalStyle = (recapMeta.final_style as string | undefined) ?? recap?.strategy ?? "(n/a)";
    const finalVersion =
      (recapMeta.final_version as string | undefined) ?? recap?.strategy_version ?? "(n/a)";
    const baseVersion = (recapMeta.base_version as string | undefined) ?? "(n/a)";

    let nextActionLine: string | null = null;
    if (!baseStatus.exists && canGenerateRecap(session)) {
      nextActionLine = metaMeepoVoice.sessions.nextActionGenerateBase(session.session_id, DEFAULT_RECAP_STRATEGY);
    } else if (!recapExists && canGenerateRecap(session)) {
      nextActionLine = metaMeepoVoice.sessions.nextActionGenerateFinal(session.session_id, DEFAULT_RECAP_STRATEGY);
    } else if (recapExists) {
      nextActionLine = metaMeepoVoice.sessions.nextActionRegenerate(session.session_id, DEFAULT_RECAP_STRATEGY);
    }

    const lines = metaMeepoVoice.sessions.viewLines({
      sessionId: session.session_id,
      label: getSessionDisplayLabel(session),
      startedIso: new Date(session.started_at_ms).toISOString(),
      endedIso: session.ended_at_ms ? new Date(session.ended_at_ms).toISOString() : "(active)",
      kind: session.kind,
      baseExists: baseStatus.exists,
      baseHash: baseStatus.sourceHash ? `${baseStatus.sourceHash.slice(0, 12)}…` : "(n/a)",
      baseVersion: baseStatus.baseVersion ?? "(n/a)",
      recapExists,
      finalStyle,
      finalCreatedAt: recap?.created_at_ms ? new Date(recap.created_at_ms).toISOString() : "(n/a)",
      finalHash: recap?.source_hash ? `${recap.source_hash.slice(0, 12)}…` : "(n/a)",
      finalVersion,
      linkedBaseVersion: baseVersion,
      transcriptStatus,
      dbRowMissingFileNotice: recapExists && !finalFileForDbStyle.exists,
      hasUnindexedFilesNotice: !recapExists && hasAnyFinalFiles,
      nextActionLine,
      transcriptMissingNotice: false,
    });

    const files: AttachmentBuilder[] = [];
    if (recap) {
      const fileStem = buildSessionArtifactStem({
        guildId,
        campaignSlug: effectiveCampaignSlug,
        sessionId: session.session_id,
      });
      const fileName = `${fileStem}-recap-final-${recap.strategy ?? DEFAULT_RECAP_STRATEGY}.md`;
      if (finalFileForDbStyle.exists && finalFileForDbStyle.paths?.recapPath && fs.existsSync(finalFileForDbStyle.paths.recapPath)) {
        files.push(
          new AttachmentBuilder(fs.readFileSync(finalFileForDbStyle.paths.recapPath), {
            name: fileName,
          })
        );
      } else if (recap.content_text) {
        files.push(
          new AttachmentBuilder(Buffer.from(recap.content_text, "utf8"), {
            name: fileName,
          })
        );
      }
    }

    if (transcriptArtifact?.file_path && fs.existsSync(transcriptArtifact.file_path)) {
      const fileStem = buildSessionArtifactStem({
        guildId,
        campaignSlug: effectiveCampaignSlug,
        sessionId: session.session_id,
      });
      const bytes = Number(transcriptArtifact.size_bytes ?? fs.statSync(transcriptArtifact.file_path).size);
      if (bytes <= MAX_INLINE_ATTACHMENT_BYTES) {
        files.push(
          new AttachmentBuilder(transcriptArtifact.file_path, {
            name: `${fileStem}-transcript-bronze.log`,
          })
        );
      } else {
        transcriptStatus = "cached (too large to attach inline)";
      }
    } else if (transcriptArtifact?.content_text) {
      const fileStem = buildSessionArtifactStem({
        guildId,
        campaignSlug: effectiveCampaignSlug,
        sessionId: session.session_id,
      });
      const bytes = Buffer.byteLength(transcriptArtifact.content_text, "utf8");
      if (bytes <= MAX_INLINE_ATTACHMENT_BYTES) {
        files.push(
          new AttachmentBuilder(Buffer.from(transcriptArtifact.content_text, "utf8"), {
            name: `${fileStem}-transcript.txt`,
          })
        );
      } else {
        transcriptStatus = "cached (too large to attach inline)";
      }
    }

    await interaction.reply({
      content: lines.join("\n"),
      files,
      ephemeral: true,
    });
    return;
  }

  if (sub === "recap") {
    await handleSessionsRecap(interaction, ctx);
    return;
  }

  await interaction.reply({ content: metaMeepoVoice.sessions.unknownAction(), ephemeral: true });
}

async function handleSettings(interaction: any, ctx: CommandCtx): Promise<void> {
  const guildId = interaction.guildId as string;
  const sub = interaction.options.getSubcommand();

  const parseDmDisplayName = (memoryText: string | null | undefined): string | null => {
    if (!memoryText || !memoryText.trim()) return null;
    const match = memoryText.trim().match(/^The Dungeon Master is\s+(.+)\.$/i);
    if (!match?.[1]) return memoryText.trim();
    return match[1].trim() || null;
  };

  const formatSttPromptCurrent = (prompt: string | undefined): string => {
    const value = (prompt ?? "").trim();
    if (!value) return "(unset)";
    if (value.length <= 180) return value;
    return `${value.slice(0, 177)}...`;
  };

  const isDmAllowed = canAnswerAwakeningPrompt(guildId, interaction);
  const isEditAction = sub !== "show" && sub !== "view";
  if (isEditAction && !isDmAllowed) {
    await interaction.reply({
      content: "Only the Dungeon Master can edit awakening settings.",
      ephemeral: true,
    });
    return;
  }

  if (sub === "show" || sub === "view") {
    const config = getGuildConfig(guildId);
    const homeText = config?.home_text_channel_id ?? null;
    const homeVoice = config?.home_voice_channel_id ?? null;
    const dmRole = getGuildDmRoleId(guildId);
    const talkMode = getGuildDefaultTalkMode(guildId) ?? "(unset)";
    const dmUserId = config?.dm_user_id ?? null;
    const dmNameMemory = getGuildMemoryByKey({ db: ctx.db, guildId, key: DM_DISPLAY_NAME_KEY });
    const setupVersion = config?.setup_version ?? getGuildSetupVersion(guildId) ?? 0;
    const sttPromptCurrent = formatSttPromptCurrent(getGuildSttPrompt(guildId) ?? cfg.stt.prompt);
    await interaction.reply({
      content: metaMeepoVoice.settings.viewSummary({
        setupVersion,
        campaignSlug: config?.campaign_slug ?? "(unset)",
        homeTextChannel: formatChannel(homeText),
        homeVoiceChannel: formatChannel(homeVoice),
        dmRole: dmRole ? `<@&${dmRole}>` : "(unset)",
        dmDisplayName: parseDmDisplayName(dmNameMemory?.text) ?? "(unset)",
        defaultTalkMode: talkMode,
        dmUser: dmUserId ? `<@${dmUserId}> (${dmUserId})` : "(unset)",
        sttPromptCurrent,
        awakened: config?.awakened === 1,
        awakenKeys: AWAKEN_GUILD_CONFIG_KEYS.map((item) => `${item.key}${item.editable ? "" : " (read-only)"}`).join(", "),
      }),
      ephemeral: true,
    });
    return;
  }

  if (sub === "home_text_channel") {
    const channel = interaction.options.getChannel("channel", true);
    const isValid = Boolean(channel?.isTextBased?.()) && !Boolean(channel?.isVoiceBased?.());
    if (!isValid) {
      await interaction.reply({ content: metaMeepoVoice.settings.selectTextChannel(), ephemeral: true });
      return;
    }
    setGuildHomeTextChannelId(guildId, channel.id);
    await interaction.reply({ content: metaMeepoVoice.settings.updatedHomeText(formatChannel(channel.id)), ephemeral: true });
    return;
  }

  if (sub === "home_voice_channel") {
    const channel = interaction.options.getChannel("channel", true);
    const isValid = Boolean(channel?.isVoiceBased?.());
    if (!isValid) {
      await interaction.reply({ content: metaMeepoVoice.settings.selectVoiceChannel(), ephemeral: true });
      return;
    }
    setGuildHomeVoiceChannelId(guildId, channel.id);
    await interaction.reply({ content: metaMeepoVoice.settings.updatedHomeVoice(formatChannel(channel.id)), ephemeral: true });
    return;
  }

  if (sub === "dm_role") {
    const role = interaction.options.getRole("role", true);
    setGuildDmRoleId(guildId, role.id);
    await interaction.reply({ content: metaMeepoVoice.settings.updatedDmRole(role.id), ephemeral: true });
    return;
  }

  if (sub === "talk_mode") {
    const mode = interaction.options.getString("mode", true) as "hush" | "talk";
    if (mode !== "hush" && mode !== "talk") {
      await interaction.reply({ content: metaMeepoVoice.settings.invalidTalkMode(), ephemeral: true });
      return;
    }
    setGuildDefaultTalkMode(guildId, mode);
    await interaction.reply({ content: metaMeepoVoice.settings.updatedTalkMode(mode), ephemeral: true });
    return;
  }

  if (sub === "dm_name") {
    const raw = String(interaction.options.getString("name", true) ?? "");
    const trimmed = raw.trim();
    if (!trimmed) {
      await interaction.reply({ content: metaMeepoVoice.settings.emptyDmName(), ephemeral: true });
      return;
    }
    upsertDmDisplayNameMemory({
      db: ctx.db,
      guildId,
      displayName: trimmed,
      source: "settings_dm_name",
    });
    await interaction.reply({ content: metaMeepoVoice.settings.updatedDmName(), ephemeral: true });
    return;
  }

  await interaction.reply({ content: metaMeepoVoice.settings.unknownAction(), ephemeral: true });
}

async function handleHelp(interaction: any): Promise<void> {
  await interaction.reply({ content: metaMeepoVoice.help.summary(), ephemeral: true });
}

async function handleDoctor(interaction: any, ctx: CommandCtx): Promise<void> {
  const checks = await runDoctorChecks(interaction, ctx);
  await interaction.reply({ content: metaMeepoVoice.doctor.report(checks), ephemeral: true });
}

export async function executeLabSleep(interaction: any): Promise<void> {
  await handleSleep(interaction);
}

export async function executeLabDoctor(interaction: any, ctx: CommandCtx): Promise<void> {
  await handleDoctor(interaction, ctx);
}

async function handleStatus(interaction: any, ctx: CommandCtx): Promise<void> {
  const guildId = interaction.guildId as string;
  const active = getActiveMeepo(guildId);
  const voiceState = getVoiceState(guildId);
  const homeText = getGuildHomeTextChannelId(guildId);
  const homeVoice = resolveGuildHomeVoiceChannelId(guildId, cfg.overlay.homeVoiceChannelId ?? null);
  const sttInfo = getSttProviderInfo();
  const ttsInfo = getTtsProviderInfo();
  const effectiveMode = resolveEffectiveMode(guildId);
  const canonMode = getGuildCanonPersonaMode(guildId) ?? "meta";
  const dmBinding = getGuildDmUserId(guildId);
  const configuredCanonPersona = getGuildCanonPersonaId(guildId) ?? "(auto)";
  const effectivePersonaId = getEffectivePersonaId(guildId);
  const effectivePersona = getPersona(effectivePersonaId);
  const setupVersion = getGuildSetupVersion(guildId) ?? 0;

  const activeSession = getActiveSession(guildId) as SessionRow | null;
  const statusSession = activeSession ?? getMostRecentSession(guildId);

  const lastTranscriptionRow = ctx.db
    .prepare(
      `
      SELECT MAX(timestamp_ms) AS ts
      FROM ledger_entries
      WHERE guild_id = ?
        AND tags LIKE '%voice%'
      `
    )
    .get(guildId) as { ts: number | null } | undefined;

  const awake = Boolean(active);
  const talkMode = awake && active?.reply_mode === "voice" && Boolean(voiceState) && !isVoiceHushEnabled(guildId);
  const voiceMode = awake ? (talkMode ? "talk" : "hush") : "asleep";

  const hints: string[] = [];
  if (awake && !voiceState) {
    hints.push(metaMeepoVoice.status.hintJoinVoice());
  }
  if (!hasTtsAvailable()) {
    hints.push(metaMeepoVoice.status.hintEnableTts());
  }
  if (!homeText) {
    hints.push(metaMeepoVoice.status.hintSetHomeText());
  }

  const baseStatus = statusSession
    ? getBaseStatus(guildId, ctx.campaignSlug, statusSession.session_id, statusSession.label)
    : null;
  const recapFinal = statusSession
    ? (getSessionArtifact(guildId, statusSession.session_id, "recap_final") as SessionArtifactRow | null)
    : null;
  let recapFinalMeta: Record<string, unknown> | null = null;
  try {
    recapFinalMeta = recapFinal?.meta_json ? (JSON.parse(recapFinal.meta_json) as Record<string, unknown>) : null;
  } catch {
    recapFinalMeta = null;
  }
  const finalStyle = ((recapFinalMeta?.final_style as string | undefined) ?? recapFinal?.strategy ?? "(none)");
  const finalCreatedAt = recapFinal?.created_at_ms
    ? new Date(recapFinal.created_at_ms).toISOString()
    : "(none)";
  const finalHash = recapFinal?.source_hash ? `${recapFinal.source_hash.slice(0, 12)}…` : "(none)";
  const showInternalDebug = cfg.logging.level === "debug" || cfg.logging.level === "trace";
  const workerStatus = showInternalDebug ? getMeepoContextWorkerStatus(guildId) : null;
  const internalDebugLines = workerStatus
    ? [
        `Context worker: ${workerStatus.enabled ? "enabled" : "disabled"} (${workerStatus.running ? "running" : "stopped"})`,
        `Queue: queued=${workerStatus.queue.queuedCount} leased=${workerStatus.queue.leasedCount} failed=${workerStatus.queue.failedCount}`,
        `Oldest queued age: ${workerStatus.queue.oldestQueuedAgeMs == null ? "(none)" : `${workerStatus.queue.oldestQueuedAgeMs}ms`}`,
        `Last action completed: ${workerStatus.queue.lastCompletedAtMs ? new Date(workerStatus.queue.lastCompletedAtMs).toISOString() : "(none)"}`,
      ]
    : undefined;

  await interaction.reply({
    content: metaMeepoVoice.status.snapshot({
      setupVersion,
      awake,
      voiceMode,
      effectiveMode,
      canonMode,
      dmBinding: dmBinding ? `<@${dmBinding}> (${dmBinding})` : "(unset)",
      configuredCanonPersona,
      effectivePersonaDisplayName: effectivePersona.displayName,
      effectivePersonaId,
      activeSessionId: activeSession?.session_id ?? null,
      activeSessionSummary: activeSession ? summarizeSession(activeSession) : "(none)",
      homeText: formatChannel(homeText),
      homeVoice: formatChannel(homeVoice),
      inVoice: Boolean(voiceState),
      connectedVoice: formatChannel(voiceState?.channelId ?? null),
      sttActive: Boolean(voiceState?.sttEnabled),
      sttProviderName: sttInfo.name,
      lastTranscription: lastTranscriptionRow?.ts ? new Date(lastTranscriptionRow.ts).toISOString() : "(none)",
      baseRecapCached: Boolean(baseStatus?.exists),
      finalStyle,
      finalCreatedAt,
      finalHash,
      ttsAvailable: hasTtsAvailable(),
      ttsProviderName: ttsInfo.name,
      hints,
      internalDebugLines,
    }),
    ephemeral: false,
  });
}

export const meepo = {
  data: new SlashCommandBuilder()
    .setName("meepo")
    .setDescription("Minimal Meepo controls.")
    .addSubcommand((sub) =>
      sub
        .setName("awaken")
        .setDescription("Begin Meepo's awakening ritual.")
    )
    .addSubcommandGroup((group) =>
      group
        .setName("sessions")
        .setDescription("Browse sessions.")
        .addSubcommand((sub) =>
          sub
            .setName("list")
            .setDescription("List recent sessions.")
            .addIntegerOption((opt) =>
              opt
                .setName("limit")
                .setDescription("How many sessions to show (default 10, max 50).")
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(50)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName("view")
            .setDescription("View a session by id.")
            .addStringOption((opt) =>
              opt
                .setName("session")
                .setDescription("Session id")
                .setAutocomplete(true)
                .setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName("recap")
            .setDescription("Generate or regenerate a recap for a canon session.")
            .addStringOption((opt) =>
              opt
                .setName("session")
                .setDescription("Session id")
                .setAutocomplete(true)
                .setRequired(true)
            )
            .addStringOption((opt) =>
              opt
                .setName("style")
                .setDescription("Final recap style")
                .setRequired(false)
                .addChoices(
                  { name: "detailed", value: "detailed" },
                  { name: "balanced", value: "balanced" },
                  { name: "concise", value: "concise" }
                )
            )
            .addBooleanOption((opt) =>
              opt
                .setName("force")
                .setDescription("Force regeneration even if a recap already exists.")
                .setRequired(false)
            )
        )
    )
    .addSubcommand((sub) => sub.setName("talk").setDescription("Enable voice replies (requires awake)."))
    .addSubcommand((sub) => sub.setName("hush").setDescription("Disable voice replies (requires awake)."))
    .addSubcommand((sub) => sub.setName("help").setDescription("Show a command reference for /meepo."))
    .addSubcommand((sub) => sub.setName("status").setDescription("Show current Meepo state and diagnostics."))
    .addSubcommandGroup((group) =>
      group
        .setName("settings")
        .setDescription("Show or edit awakening settings.")
        .addSubcommand((sub) => sub.setName("show").setDescription("Show awakening settings."))
        .addSubcommand((sub) =>
          sub
            .setName("home_text_channel")
            .setDescription("Set the home text channel.")
            .addChannelOption((opt) =>
              opt.setName("channel").setDescription("Home text channel").setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName("home_voice_channel")
            .setDescription("Set the home voice channel.")
            .addChannelOption((opt) =>
              opt.setName("channel").setDescription("Home voice channel").setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName("dm_role")
            .setDescription("Set the Dungeon Master role.")
            .addRoleOption((opt) =>
              opt.setName("role").setDescription("Dungeon Master role").setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName("talk_mode")
            .setDescription("Set default awaken talk mode.")
            .addStringOption((opt) =>
              opt
                .setName("mode")
                .setDescription("Default talk mode")
                .setRequired(true)
                .addChoices(
                  { name: "hush", value: "hush" },
                  { name: "talk", value: "talk" }
                )
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName("dm_name")
            .setDescription("Set Dungeon Master display name memory.")
            .addStringOption((opt) =>
              opt.setName("name").setDescription("Dungeon Master display name").setRequired(true)
            )
        )
    ),

  async handleComponentInteraction(interaction: any, ctx: CommandCtx | null): Promise<boolean> {
    return handleAwakeningChoicePromptInteraction(interaction, ctx);
  },

  async autocomplete(interaction: any) {
    const focused = interaction.options.getFocused(true);
    const subGroup = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(false);

    const guildId = interaction.guildId as string | null;
    if (!guildId) {
      await interaction.respond([]);
      return;
    }

    if (focused.name !== "session") {
      await interaction.respond([]);
      return;
    }

    const supportsAutocomplete =
      subGroup === "sessions" && (sub === "view" || sub === "recap");

    if (!supportsAutocomplete) {
      await interaction.respond([]);
      return;
    }

    const query = String(focused.value ?? "").trim().toLowerCase();
    const sessions = listSessions(guildId, 25) as SessionRow[];

    const options = sessions
      .filter((session) => {
        if (!query) return true;
        const label = (session.label ?? "").toLowerCase();
        return label.includes(query) || session.session_id.toLowerCase().includes(query);
      })
      .slice(0, 25)
      .map((session, index) => formatSessionChoice(session, index));

    await interaction.respond(options);
  },

  async execute(interaction: any, ctx: CommandCtx | null) {
    const guildId = interaction.guildId as string | null;
    const guild = interaction.guild;
    if (!guildId || !guild || !ctx?.db) {
      await interaction.reply({ content: metaMeepoVoice.errors.notInGuild(), ephemeral: true });
      return;
    }

    const subGroup = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const requiresElevated =
      sub === "awaken" || sub === "wake" || sub === "talk" || sub === "hush" ||
      (subGroup === "sessions" && sub === "recap");

    if (requiresElevated && !isElevated(interaction.member as GuildMember | null)) {
      await interaction.reply({ content: metaMeepoVoice.errors.notAuthorized(), ephemeral: true });
      return;
    }

    if (subGroup === "settings") {
      await handleSettings(interaction, ctx);
      return;
    }

    if (subGroup === "sessions") {
      await handleSessions(interaction, ctx);
      return;
    }

    if (sub === "awaken" || sub === "wake") {
      await handleAwaken(interaction, ctx);
      return;
    }

    if (sub === "sleep") {
      await interaction.reply({
        content: "Moved: use `/lab sleep`.",
        ephemeral: true,
      });
      return;
    }

    if (sub === "talk") {
      await handleTalk(interaction, ctx);
      return;
    }

    if (sub === "hush") {
      await handleHush(interaction, ctx);
      return;
    }

    if (sub === "help") {
      await handleHelp(interaction);
      return;
    }

    if (sub === "status") {
      await handleStatus(interaction, ctx);
      return;
    }

    if (sub === "doctor") {
      await interaction.reply({
        content: "Moved: use `/lab doctor`.",
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({ content: metaMeepoVoice.errors.unknownSubcommand(), ephemeral: true });
  },
};