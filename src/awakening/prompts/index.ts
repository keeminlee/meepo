import type { GuildOnboardingState } from "../../ledger/awakeningStateRepo.js";
import type { AwakenScript } from "../../scripts/awakening/_schema.js";
import type { PendingPromptState } from "../wakeIdentity.js";
import {
  AWAKEN_CONTINUE_KEY,
  buildContinuePromptPayload,
  parseContinueCustomId,
} from "./continuePrompt.js";
import {
  buildChoicePromptPayload,
  parseChoicePromptCustomId,
  resolveChoicePromptValue,
} from "./choicePrompt.js";
import {
  buildChannelSelectPromptPayload,
  getChannelSelectFilter,
  parseChannelSelectCustomId,
} from "./channelSelectPrompt.js";
import {
  buildModalTextPromptPayload,
  parseModalOpenCustomId,
  parseModalSubmitCustomId,
} from "./modalTextPrompt.js";
import {
  buildRegistryBuilderPromptPayload,
  buildRegistryUserSelectPayload,
  parseRegistryAddCustomId,
  parseRegistryDoneCustomId,
  parseRegistryNameModalCustomId,
  parseRegistryUserSelectCustomId,
} from "./registryBuilderPrompt.js";
import {
  buildRoleSelectPromptPayload,
  parseRoleSelectPromptCustomId,
} from "./roleSelectPrompt.js";
import { log } from "../../utils/logger.js";
import { getObservabilityContext } from "../../observability/context.js";
import {
  getInteractionCallDiagnostics,
  getInteractionSurface,
  getPayloadDiagnostics,
  serializeInteractionError,
  shouldRetryAlternateResponsePath,
} from "../../utils/interactionDiagnostics.js";

type ReplyLike = {
  replied?: boolean;
  deferred?: boolean;
  reply: (payload: unknown) => Promise<unknown>;
  editReply: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
  customId?: string;
  isModalSubmit?: () => boolean;
  isStringSelectMenu?: () => boolean;
  isButton?: () => boolean;
  isChatInputCommand?: () => boolean;
  guildId?: string;
  id?: string;
};

export type PromptRenderOriginBranch =
  | "already_awakened"
  | "initial_prompt"
  | "resume"
  | "modal_submit"
  | "lab_respond";

const promptRenderLog = log.withScope("awaken-prompt-render", {
  requireGuildContext: true,
  callsite: "awakening/prompts/index.ts",
});

function logPromptResponseLifecycle(args: {
  marker: string;
  interaction: ReplyLike;
  operation?: string;
  helperName?: string;
  level?: "info" | "error";
  error?: unknown;
  extra?: Record<string, unknown>;
}): void {
  const obs = getObservabilityContext();
  const payload = {
    event_type: "AWAKEN_PROMPT_RESPONSE_GUARDRAIL",
    marker: args.marker,
    helper_name: args.helperName,
    command_name: "meepo",
    subcommand_name: "awaken",
    operation: args.operation,
    trace_id: obs.trace_id,
    pid: process.pid,
    error: args.error ? serializeInteractionError(args.error) : undefined,
    ...getInteractionCallDiagnostics(args.interaction),
    ...args.extra,
  };

  if (args.level === "error") {
    promptRenderLog.error("Awakening prompt response failed", payload, {
      guild_id: (args.interaction as any)?.guildId ?? obs.guild_id,
      campaign_slug: obs.campaign_slug,
      interaction_id: obs.interaction_id,
      trace_id: obs.trace_id,
      session_id: undefined,
    });
    return;
  }

  promptRenderLog.debug("Awakening prompt response lifecycle", payload, {
    guild_id: (args.interaction as any)?.guildId ?? obs.guild_id,
    campaign_slug: obs.campaign_slug,
    interaction_id: obs.interaction_id,
    trace_id: obs.trace_id,
    session_id: undefined,
  });
}

async function sendPromptPayload(
  interaction: ReplyLike,
  payload: unknown,
  markerBase: string,
  originBranch: PromptRenderOriginBranch
): Promise<void> {
  const payloadShape = getPayloadDiagnostics(payload);
  const selectedOp = interaction.deferred && typeof interaction.editReply === "function"
    ? "editReply"
    : interaction.replied && typeof interaction.followUp === "function"
      ? "followUp"
      : typeof interaction.reply === "function"
        ? "reply"
        : typeof interaction.followUp === "function"
          ? "followUp"
          : "none";

  logPromptResponseLifecycle({
    marker: `${markerBase}_BEFORE_SELECT_OP`,
    interaction,
    operation: "select-response-op",
    helperName: "sendPromptPayload",
    extra: {
      origin_branch: originBranch,
      selected_op: selectedOp,
      ...payloadShape,
    },
  });

  const attempts: Array<{ op: "editReply" | "followUp" | "reply"; run: () => Promise<unknown> }> = [];
  if (interaction.deferred && typeof interaction.editReply === "function") {
    attempts.push({ op: "editReply", run: () => interaction.editReply(payload) });
  }
  if (interaction.replied && typeof interaction.followUp === "function") {
    attempts.push({ op: "followUp", run: () => interaction.followUp!(payload) });
  }
  if (typeof interaction.reply === "function") {
    attempts.push({ op: "reply", run: () => interaction.reply(payload) });
  }
  if (typeof interaction.followUp === "function") {
    attempts.push({ op: "followUp", run: () => interaction.followUp!(payload) });
  }

  const tried = new Set<string>();
  const orderedAttempts = attempts.filter((entry) => {
    if (tried.has(entry.op)) return false;
    tried.add(entry.op);
    return true;
  });

  try {
    let lastError: unknown;
    for (let idx = 0; idx < orderedAttempts.length; idx += 1) {
      const attempt = orderedAttempts[idx]!;
      const isFirstAttempt = idx === 0;
      logPromptResponseLifecycle({
        marker: `${markerBase}_BEFORE_${attempt.op.toUpperCase()}`,
        interaction,
        operation: attempt.op,
        helperName: "sendPromptPayload",
        extra: {
          origin_branch: originBranch,
          selected_op: attempt.op,
          selected_op_rank: idx + 1,
          selected_op_total: orderedAttempts.length,
          selected_op_first_choice: isFirstAttempt,
          ...payloadShape,
        },
      });
      logPromptResponseLifecycle({
        marker: "AWAKEN_OP_BEFORE",
        interaction,
        operation: attempt.op,
        helperName: "sendPromptPayload",
        extra: {
          origin_branch: originBranch,
          selected_op: attempt.op,
          selected_op_rank: idx + 1,
          selected_op_total: orderedAttempts.length,
          op_marker_source: markerBase,
          ...payloadShape,
        },
      });
      try {
        await attempt.run();
        logPromptResponseLifecycle({
          marker: `${markerBase}_AFTER_${attempt.op.toUpperCase()}`,
          interaction,
          operation: attempt.op,
          helperName: "sendPromptPayload",
          extra: {
            origin_branch: originBranch,
            selected_op: attempt.op,
          },
        });
        logPromptResponseLifecycle({
          marker: "AWAKEN_OP_AFTER",
          interaction,
          operation: attempt.op,
          helperName: "sendPromptPayload",
          extra: {
            origin_branch: originBranch,
            selected_op: attempt.op,
            selected_op_rank: idx + 1,
            selected_op_total: orderedAttempts.length,
            op_marker_source: markerBase,
          },
        });
        return;
      } catch (error) {
        lastError = error;
        logPromptResponseLifecycle({
          marker: `${markerBase}_${attempt.op.toUpperCase()}_ERROR`,
          interaction,
          operation: attempt.op,
          helperName: "sendPromptPayload",
          level: "error",
          error,
          extra: {
            origin_branch: originBranch,
            selected_op: attempt.op,
            selected_op_rank: idx + 1,
            selected_op_total: orderedAttempts.length,
            should_retry_alt_response_path: shouldRetryAlternateResponsePath(error),
            ...payloadShape,
          },
        });
        logPromptResponseLifecycle({
          marker: "AWAKEN_OP_ERROR",
          interaction,
          operation: attempt.op,
          helperName: "sendPromptPayload",
          level: "error",
          error,
          extra: {
            origin_branch: originBranch,
            selected_op: attempt.op,
            selected_op_rank: idx + 1,
            selected_op_total: orderedAttempts.length,
            op_marker_source: markerBase,
            should_retry_alt_response_path: shouldRetryAlternateResponsePath(error),
            ...payloadShape,
          },
        });
        if (!shouldRetryAlternateResponsePath(error)) {
          throw error;
        }
      }
    }

    if (lastError) throw lastError;

    throw new Error("No valid interaction response method available for prompt payload");
  } catch (error) {
    const enhancedError = error instanceof Error ? error : new Error(String(error));
    (enhancedError as Error & { awakenDiag?: Record<string, unknown> }).awakenDiag = {
      origin_branch: originBranch,
      selected_op: selectedOp,
      helper_name: "sendPromptPayload",
      marker_base: markerBase,
      ...payloadShape,
    };
    logPromptResponseLifecycle({
      marker: `${markerBase}_ERROR`,
      interaction,
      operation: "response-path",
      helperName: "sendPromptPayload",
      level: "error",
      error: enhancedError,
      extra: {
        origin_branch: originBranch,
        selected_op: selectedOp,
        ...payloadShape,
      },
    });
    throw enhancedError;
  }
}

export async function renderPendingAwakeningPrompt(args: {
  interaction: ReplyLike;
  script: AwakenScript;
  state: GuildOnboardingState;
  pending: PendingPromptState;
  originBranch: PromptRenderOriginBranch;
}): Promise<boolean> {
  let rendered = false;
  logPromptResponseLifecycle({
    marker: "AWAKEN_RENDER_PENDING_PROMPT_ENTRY",
    interaction: args.interaction,
    operation: "renderPendingAwakeningPrompt",
    helperName: "renderPendingAwakeningPrompt",
    extra: {
      origin_branch: args.originBranch,
      pending_kind: args.pending.kind,
      pending_key: args.pending.key,
      pending_nonce: args.pending.nonce,
      pending_scene_id: args.pending.sceneId,
    },
  });
  try {
    const scene = args.script.scenes[args.pending.sceneId];
    if (!scene) return false;
    if (args.pending.kind === "continue") {
      if (args.pending.key !== AWAKEN_CONTINUE_KEY) return false;

      const payload = buildContinuePromptPayload({
        nonce: args.pending.nonce,
      });

      await sendPromptPayload(args.interaction, payload, `AWAKEN_${args.originBranch.toUpperCase()}_PROMPT_CONTINUE`, args.originBranch);
      rendered = true;
      return true;
    }

    const prompt = scene.prompt;
    if (!prompt || prompt.key !== args.pending.key) return false;

  if (args.pending.kind === "choice") {
    if (prompt.type !== "choice") return false;

    const payload = buildChoicePromptPayload({
      prompt,
      sceneId: args.pending.sceneId,
      key: args.pending.key,
      nonce: args.pending.nonce,
    });

    logPromptResponseLifecycle({
      marker: "AWAKEN_RENDER_PROMPT_SHAPE",
      interaction: args.interaction,
      operation: "prompt-shape",
      extra: {
        origin_branch: args.originBranch,
        prompt_kind: args.pending.kind,
        prompt_type: prompt.type,
        pending_key: args.pending.key,
        pending_nonce: args.pending.nonce,
      },
    });
      await sendPromptPayload(args.interaction, payload, `AWAKEN_${args.originBranch.toUpperCase()}_PROMPT_CHOICE`, args.originBranch);
      rendered = true;
      return true;
  }

  if (args.pending.kind === "role_select") {
    if (prompt.type !== "role_select") return false;
    const guildRoles = Array.from((args.interaction as any).guild?.roles?.cache?.values?.() ?? [])
      .filter((role: any) => role?.id && role?.name)
      .map((role: any) => ({ id: String(role.id), name: String(role.name) }))
      .filter((role: { id: string; name: string }) => role.name !== "@everyone")
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));

    const payload = buildRoleSelectPromptPayload({
      prompt,
      sceneId: args.pending.sceneId,
      key: args.pending.key,
      nonce: args.pending.nonce,
      roles: guildRoles,
    });

    logPromptResponseLifecycle({
      marker: "AWAKEN_RENDER_PROMPT_SHAPE",
      interaction: args.interaction,
      operation: "prompt-shape",
      extra: {
        origin_branch: args.originBranch,
        prompt_kind: args.pending.kind,
        prompt_type: prompt.type,
        pending_key: args.pending.key,
        pending_nonce: args.pending.nonce,
      },
    });
    await sendPromptPayload(args.interaction, payload, `AWAKEN_${args.originBranch.toUpperCase()}_PROMPT_ROLE_SELECT`, args.originBranch);
    rendered = true;
    return true;
  }

  if (args.pending.kind === "modal_text") {
    if (prompt.type !== "modal_text") return false;

    const payload = buildModalTextPromptPayload({
      prompt,
      sceneId: args.pending.sceneId,
      key: args.pending.key,
      nonce: args.pending.nonce,
    });

    logPromptResponseLifecycle({
      marker: "AWAKEN_RENDER_PROMPT_SHAPE",
      interaction: args.interaction,
      operation: "prompt-shape",
      extra: {
        origin_branch: args.originBranch,
        prompt_kind: args.pending.kind,
        prompt_type: prompt.type,
        pending_key: args.pending.key,
        pending_nonce: args.pending.nonce,
        modal_fields_present: true,
      },
    });
    await sendPromptPayload(args.interaction, payload, `AWAKEN_${args.originBranch.toUpperCase()}_PROMPT_MODAL_TEXT`, args.originBranch);
    rendered = true;
    return true;
  }

  if (args.pending.kind === "channel_select") {
    if (prompt.type !== "channel_select") return false;
    const channels = Array.from((args.interaction as any).guild?.channels?.cache?.values?.() ?? [])
      .filter((channel: any) => {
        if (!channel?.id || !channel?.name) return false;
        const filter = getChannelSelectFilter(prompt);
        if (filter === "voice") return Boolean(channel.isVoiceBased?.());
        return Boolean(channel.isTextBased?.()) && !channel.isVoiceBased?.();
      })
      .map((channel: any) => ({ id: String(channel.id), name: String(channel.name) }))
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));

    const pendingValue = typeof args.state.progress_json[args.pending.key] === "string"
      ? String(args.state.progress_json[args.pending.key])
      : null;

    const payload = buildChannelSelectPromptPayload({
      prompt,
      sceneId: args.pending.sceneId,
      key: args.pending.key,
      nonce: args.pending.nonce,
      channels,
      currentChannelName: String((args.interaction as any).channel?.name ?? ""),
      pendingValue,
    });

    logPromptResponseLifecycle({
      marker: "AWAKEN_RENDER_PROMPT_SHAPE",
      interaction: args.interaction,
      operation: "prompt-shape",
      extra: {
        origin_branch: args.originBranch,
        prompt_kind: args.pending.kind,
        prompt_type: prompt.type,
        pending_key: args.pending.key,
        pending_nonce: args.pending.nonce,
      },
    });
    await sendPromptPayload(args.interaction, payload, `AWAKEN_${args.originBranch.toUpperCase()}_PROMPT_CHANNEL_SELECT`, args.originBranch);
    rendered = true;
    return true;
  }

  if (args.pending.kind === "registry_builder") {
    if (prompt.type !== "registry_builder") return false;
    const players = Array.isArray(args.state.progress_json[args.pending.key])
      ? (args.state.progress_json[args.pending.key] as unknown[])
      : [];
    const pendingCharacterNameRaw = args.state.progress_json._rb_pending_character_name;
    const pendingCharacterName = typeof pendingCharacterNameRaw === "string"
      ? pendingCharacterNameRaw.trim()
      : "";

    if (pendingCharacterName.length > 0) {
      const members = Array.from((args.interaction as any).guild?.members?.cache?.values?.() ?? [])
        .filter((member: any) => member?.id)
        .map((member: any) => ({
          id: String(member.id),
          label: String(member.displayName ?? member.user?.username ?? member.id),
        }))
        .sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label));

      const payload = buildRegistryUserSelectPayload({
        sceneId: args.pending.sceneId,
        key: args.pending.key,
        nonce: args.pending.nonce,
        characterName: pendingCharacterName,
        members,
      });

      logPromptResponseLifecycle({
        marker: "AWAKEN_RENDER_PROMPT_SHAPE",
        interaction: args.interaction,
        operation: "prompt-shape",
        extra: {
          origin_branch: args.originBranch,
          prompt_kind: args.pending.kind,
          prompt_type: prompt.type,
          pending_key: args.pending.key,
          pending_nonce: args.pending.nonce,
        },
      });
      await sendPromptPayload(args.interaction, payload, `AWAKEN_${args.originBranch.toUpperCase()}_PROMPT_REGISTRY_USER`, args.originBranch);
      rendered = true;
      return true;
    }

    const payload = buildRegistryBuilderPromptPayload({
      prompt,
      sceneId: args.pending.sceneId,
      key: args.pending.key,
      nonce: args.pending.nonce,
      playersCount: players.length,
    });

    logPromptResponseLifecycle({
      marker: "AWAKEN_RENDER_PROMPT_SHAPE",
      interaction: args.interaction,
      operation: "prompt-shape",
      extra: {
        origin_branch: args.originBranch,
        prompt_kind: args.pending.kind,
        prompt_type: prompt.type,
        pending_key: args.pending.key,
        pending_nonce: args.pending.nonce,
      },
    });
    await sendPromptPayload(args.interaction, payload, `AWAKEN_${args.originBranch.toUpperCase()}_PROMPT_REGISTRY`, args.originBranch);
    rendered = true;
    return true;
  }

    return false;
  } catch (error) {
    logPromptResponseLifecycle({
      marker: "AWAKEN_RENDER_PENDING_PROMPT_ERROR",
      interaction: args.interaction,
      operation: "renderPendingAwakeningPrompt",
      helperName: "renderPendingAwakeningPrompt",
      level: "error",
      error,
      extra: {
        origin_branch: args.originBranch,
        pending_kind: args.pending.kind,
        pending_key: args.pending.key,
        pending_nonce: args.pending.nonce,
      },
    });
    throw error;
  } finally {
    logPromptResponseLifecycle({
      marker: "AWAKEN_RENDER_PENDING_PROMPT_EXIT",
      interaction: args.interaction,
      operation: "renderPendingAwakeningPrompt",
      helperName: "renderPendingAwakeningPrompt",
      extra: {
        origin_branch: args.originBranch,
        rendered,
      },
    });
  }
}

export {
  parseContinueCustomId,
  parseChannelSelectCustomId,
  parseChoicePromptCustomId,
  parseModalOpenCustomId,
  parseModalSubmitCustomId,
  parseRegistryAddCustomId,
  parseRegistryDoneCustomId,
  parseRegistryNameModalCustomId,
  parseRegistryUserSelectCustomId,
  parseRoleSelectPromptCustomId,
  resolveChoicePromptValue,
};
