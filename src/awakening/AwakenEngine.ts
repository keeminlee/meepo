import { randomUUID } from "node:crypto";
import { advanceScene, loadState, markComplete, saveProgress, setBeatIndex, type GuildOnboardingState } from "../ledger/awakeningStateRepo.js";
import { loadAwakenScript } from "../scripts/awakening/_loader.js";
import type { AwakenScript, Beat, NextSpec, Scene, SceneSay } from "../scripts/awakening/_schema.js";
import {
  buildPendingPromptPatch,
  clearPendingPromptPatch,
  getPendingPromptFromState,
  resolveAwaitInputFromScene,
} from "./wakeIdentity.js";
import { AWAKEN_CONTINUE_KEY } from "./prompts/continuePrompt.js";
import { buildCommitContext, executeCommitAction } from "./commitActions/commitActionRegistry.js";
import { executeSceneActions } from "./actions/index.js";
import { renderTemplateTree } from "./template.js";
import { getGuildMemoryByKey } from "../meepoMind/meepoMindMemoryRepo.js";
import { DM_DISPLAY_NAME_KEY } from "../meepoMind/meepoMindWriter.js";
import { getGuildConfig } from "../campaign/guildConfig.js";

export const MAX_BEATS_PER_RUN = 25;
export const MAX_DELAY_MS = 15000;
export const MAX_TOTAL_DELAY_MS_PER_RUN = 120000;
const MAX_SCENE_STEPS_PER_RUN = 50;

const AWAKE_CAPABILITIES = new Set<string>([
  "action.join_voice_and_speak",
  "prompt.channel_select",
  "prompt.choice",
  "prompt.modal_text",
  "prompt.registry_builder",
  "prompt.role_select",
  "template.vars",
]);

export function getAwakenCapabilities(): Set<string> {
  return new Set(AWAKE_CAPABILITIES);
}

type RunOptions = {
  db: any;
  scriptId?: string;
  script?: AwakenScript;
  runtimeChannelId?: string;
  maxBeatsPerRun?: number;
  maxTotalDelayMsPerRun?: number;
  sleepFn?: (ms: number) => Promise<void>;
};

type InteractionLike = {
  guildId?: string;
  channelId?: string;
  deferred?: boolean;
  replied?: boolean;
  deferReply?: (payload: { ephemeral: boolean }) => Promise<unknown>;
  editReply?: (payload: string | { content: string }) => Promise<unknown>;
  followUp?: (payload: { content: string; ephemeral?: boolean }) => Promise<unknown>;
  reply?: (payload: { content: string; ephemeral?: boolean }) => Promise<unknown>;
  channel?: { send?: (payload: string | { content: string }) => Promise<unknown> };
  guild?: { channels?: { fetch?: (channelId: string) => Promise<any> } };
};

export type AwakenRunResult =
  | { status: "completed"; emittedBeatCount: number }
  | { status: "advanced"; emittedBeatCount: number; fromScene: string; toScene: string }
  | { status: "blocked"; emittedBeatCount: number; reason: "prompt" | "action" | "commit" | "next" | "budget" | "budget_delay"; sceneId: string }
  | { status: "noop"; emittedBeatCount: number; reason: "no_state" | "already_completed" };

type SceneRunResult =
  | { status: "completed"; emittedBeatCount: number; sleptMs: number; runtimeChannelId?: string }
  | { status: "advanced"; emittedBeatCount: number; sleptMs: number; fromScene: string; toScene: string; state: GuildOnboardingState; runtimeChannelId?: string }
  | { status: "blocked"; emittedBeatCount: number; sleptMs: number; reason: "prompt" | "action" | "commit" | "next" | "budget" | "budget_delay"; sceneId: string; state: GuildOnboardingState; runtimeChannelId?: string };

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampDelay(ms: number | undefined): number {
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    return 0;
  }

  if (ms <= 0) {
    return 0;
  }

  if (ms > MAX_DELAY_MS) {
    console.warn(`[AwakenEngine] clamped beat delay from ${ms}ms to ${MAX_DELAY_MS}ms`);
    return MAX_DELAY_MS;
  }

  return Math.floor(ms);
}

function resolveNextSceneId(next: string | NextSpec | undefined): string | null {
  if (next === undefined) {
    return null;
  }
  if (typeof next === "string") {
    return next;
  }
  if (typeof next === "object" && next !== null && next.type === "scene" && typeof (next as { id?: unknown }).id === "string") {
    return (next as { id: string }).id;
  }
  return null;
}

function resolveBlockerReason(scene: Scene): "prompt" | "commit" | null {
  if (scene.prompt) return "prompt";
  return null;
}

function parseDmDisplayNameFromMemory(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^The Dungeon Master is\s+(.+)\.$/i);
  if (!match?.[1]) return trimmed;
  return match[1].trim() || null;
}

function resolveTemplateValue(args: {
  context: Record<string, unknown>;
  key: string;
}): string | undefined {
  const value = args.context[args.key];
  if (value !== undefined && value !== null) return String(value);
  return undefined;
}

function buildTemplateContext(args: {
  db: any;
  guildId: string;
  progress: Record<string, unknown>;
  runtimeChannelId?: string;
}): Record<string, unknown> {
  const context: Record<string, unknown> = {};

  try {
    const config = getGuildConfig(args.guildId) as Record<string, unknown> | null;
    if (config) {
      Object.assign(context, config);
    }
  } catch {
    // no-op
  }

  context[DM_DISPLAY_NAME_KEY] = (() => {
    const progressValue = args.progress[DM_DISPLAY_NAME_KEY];
    if (typeof progressValue === "string" && progressValue.trim().length > 0) {
      return progressValue;
    }
    try {
      const memory = getGuildMemoryByKey({
        db: args.db,
        guildId: args.guildId,
        key: DM_DISPLAY_NAME_KEY,
      });
      if (memory?.text) {
        return parseDmDisplayNameFromMemory(memory.text) ?? memory.text;
      }
    } catch {
      // no-op
    }
    return context[DM_DISPLAY_NAME_KEY];
  })();

  Object.assign(context, args.progress);

  const homeChannelIdRaw = context.home_channel_id;
  const homeChannelId = typeof homeChannelIdRaw === "string" ? homeChannelIdRaw.trim() : "";
  if (homeChannelId) {
    context.home_channel = `<#${homeChannelId}>`;
  }

  const runtimeCurrentChannelId =
    (typeof args.runtimeChannelId === "string" && args.runtimeChannelId.trim().length > 0)
      ? args.runtimeChannelId.trim()
      : (typeof context.current_channel_id === "string" ? context.current_channel_id.trim() : "");

  if (runtimeCurrentChannelId) {
    context.current_channel_id = runtimeCurrentChannelId;
    context.current_channel = `<#${runtimeCurrentChannelId}>`;
  }

  return context;
}

function applySceneTemplates(scene: Scene, args: {
  db: any;
  guildId: string;
  progress: Record<string, unknown>;
  sceneId: string;
  runtimeChannelId?: string;
}): Scene {
  const templateContext = buildTemplateContext({
    db: args.db,
    guildId: args.guildId,
    progress: args.progress,
    runtimeChannelId: args.runtimeChannelId,
  });

  const unresolved = new Set<string>();
  const rendered = renderTemplateTree(scene, (key) => resolveTemplateValue({ context: templateContext, key }), unresolved);

  if (unresolved.size > 0) {
    const vars = [...unresolved].sort().join(",");
    console.warn(`AWAKEN_TEMPLATE_UNRESOLVED scene=${args.sceneId} vars=[${vars}]`);
  }

  return rendered;
}

function computeMissingCapabilities(scene: Scene, capabilities: Set<string>): string[] {
  const required = scene.requires ?? [];
  return required.filter((item) => !capabilities.has(item));
}

function resolveSkipNextScene(scene: Scene): string | null {
  const fallback = scene.fallback_next?.trim();
  if (fallback) return fallback;
  return resolveNextSceneId(scene.next);
}

function hasResolvedPromptInput(state: GuildOnboardingState, scene: Scene): boolean {
  const awaitInput = resolveAwaitInputFromScene(scene);
  if (!awaitInput) return false;

  if (awaitInput.kind === "registry_builder") {
    const pending = getPendingPromptFromState(state);
    if (pending && pending.kind === "registry_builder" && pending.key === awaitInput.key && pending.sceneId === state.current_scene) {
      return false;
    }
  }

  const value = state.progress_json[awaitInput.key];
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return value !== undefined && value !== null;
}

function hasContinueMarkerForScene(state: GuildOnboardingState, sceneId: string): boolean {
  return state.progress_json[AWAKEN_CONTINUE_KEY] === sceneId;
}

async function executeCommits(args: {
  db: any;
  scriptId: string;
  sceneId: string;
  scene: Scene;
  state: GuildOnboardingState;
}): Promise<void> {
  const commits = args.scene.commit ?? [];
  if (commits.length === 0) return;

  const inputs = { ...args.state.progress_json };
  const ctx = buildCommitContext({
    db: args.db,
    guildId: args.state.guild_id,
    scriptId: args.scriptId,
    sceneId: args.sceneId,
    progress: args.state.progress_json,
    inputs,
    onboardingState: args.state,
  });

  for (const commit of commits) {
    await executeCommitAction(ctx, commit);
  }
}

export function normalizeSay(say: SceneSay | undefined): Beat[] {
  if (say === undefined) return [];
  if (typeof say === "string") {
    return [{ text: say }];
  }
  if (Array.isArray(say)) {
    return say;
  }
  return [say];
}

async function ensureAck(interaction: InteractionLike): Promise<void> {
  if (interaction.deferred || interaction.replied) return;
  if (typeof interaction.deferReply === "function") {
    await interaction.deferReply({ ephemeral: true });
  }
}

async function emitBeat(interaction: InteractionLike, beat: Beat, targetChannelId?: string): Promise<void> {
  if (targetChannelId && interaction.guild?.channels?.fetch) {
    try {
      const channel = await interaction.guild.channels.fetch(targetChannelId);
      if (channel?.send) {
        await channel.send({ content: beat.text });
        return;
      }
    } catch {
      // fall through to default emission path
    }
  }

  if (typeof interaction.followUp === "function") {
    await interaction.followUp({ content: beat.text, ephemeral: false });
    return;
  }

  if (interaction.channel?.send) {
    await interaction.channel.send({ content: beat.text });
    return;
  }

  if (typeof interaction.reply === "function") {
    await interaction.reply({ content: beat.text, ephemeral: false });
    return;
  }

  throw new Error("No supported output method on interaction to emit awakening beat");
}

export async function runCurrentScene(
  interaction: InteractionLike,
  script: AwakenScript,
  state: GuildOnboardingState,
  opts: {
    db: any;
    runtimeChannelId?: string;
    maxBeatsRemaining: number;
    maxDelayRemainingMs: number;
    sleepFn: (ms: number) => Promise<void>;
  },
): Promise<SceneRunResult> {
  const rawScene = script.scenes[state.current_scene];
  const scene = rawScene
    ? applySceneTemplates(rawScene, {
      db: opts.db,
      guildId: state.guild_id,
      progress: state.progress_json,
      sceneId: state.current_scene,
      runtimeChannelId: opts.runtimeChannelId,
    })
    : undefined;
  if (!scene) {
    throw new Error(`Awakening scene not found: ${state.current_scene}`);
  }

  const capabilities = getAwakenCapabilities();
  const missingCapabilities = computeMissingCapabilities(scene, capabilities);
  if (missingCapabilities.length > 0) {
    const required = scene.requires ?? [];
    const target = resolveSkipNextScene(scene);
    console.info(
      `AWAKEN_SKIP scene=${state.current_scene} requires=[${required.join(",")}] missing=[${missingCapabilities.join(",")}] next=${target ?? "__complete__"}`
    );

    if (!target) {
      state = saveProgress(state.guild_id, state.script_id, {
        ...clearPendingPromptPatch(),
      }, { db: opts.db });
      setBeatIndex(state.guild_id, state.script_id, 0, { db: opts.db });
      markComplete(state.guild_id, state.script_id, { db: opts.db });
      return {
        status: "completed",
        emittedBeatCount: 0,
        sleptMs: 0,
        runtimeChannelId: opts.runtimeChannelId,
      };
    }

    state = saveProgress(state.guild_id, state.script_id, {
      ...clearPendingPromptPatch(),
    }, { db: opts.db });
    setBeatIndex(state.guild_id, state.script_id, 0, { db: opts.db });
    const advancedState = advanceScene(state.guild_id, state.script_id, target, { db: opts.db });
    return {
      status: "advanced",
      emittedBeatCount: 0,
      sleptMs: 0,
      fromScene: state.current_scene,
      toScene: target,
      state: advancedState,
      runtimeChannelId: opts.runtimeChannelId,
    };
  }

  const beats = normalizeSay(scene.say);
  let emitted = 0;
  let sleptMs = 0;

  for (let index = state.beat_index; index < beats.length; index += 1) {
    if (emitted >= opts.maxBeatsRemaining) {
      return {
        status: "blocked",
        emittedBeatCount: emitted,
        sleptMs,
        reason: "budget",
        sceneId: state.current_scene,
        state,
      };
    }

    const beat = beats[index]!;
    await emitBeat(interaction, beat, opts.runtimeChannelId);
    state = setBeatIndex(state.guild_id, state.script_id, index + 1, { db: opts.db });
    emitted += 1;

    const delayMs = clampDelay(beat.delay_ms);
    if (sleptMs + delayMs > opts.maxDelayRemainingMs) {
      return {
        status: "blocked",
        emittedBeatCount: emitted,
        sleptMs,
        reason: "budget_delay",
        sceneId: state.current_scene,
        state,
        runtimeChannelId: opts.runtimeChannelId,
      };
    }

    if (delayMs > 0) {
      await opts.sleepFn(delayMs);
      sleptMs += delayMs;
    }
  }

  const blocker = resolveBlockerReason(scene);
  if (blocker === "prompt" && !hasResolvedPromptInput(state, scene)) {
    const hasContinueMarker = hasContinueMarkerForScene(state, state.current_scene);
    if (!hasContinueMarker) {
      const existingPending = getPendingPromptFromState(state);
      const nonce =
        existingPending
        && existingPending.sceneId === state.current_scene
        && existingPending.key === AWAKEN_CONTINUE_KEY
        && existingPending.kind === "continue"
          ? existingPending.nonce
          : randomUUID();

      state = saveProgress(state.guild_id, state.script_id, buildPendingPromptPatch({
        key: AWAKEN_CONTINUE_KEY,
        kind: "continue",
        sceneId: state.current_scene,
        nonce,
        createdAtMs: existingPending?.createdAtMs ?? Date.now(),
      }), { db: opts.db });

      return {
        status: "blocked",
        emittedBeatCount: emitted,
        sleptMs,
        reason: "prompt",
        sceneId: state.current_scene,
        state,
        runtimeChannelId: opts.runtimeChannelId,
      };
    }

    const awaitInput = resolveAwaitInputFromScene(scene);
    if (awaitInput) {
      const existingPending = getPendingPromptFromState(state);
      const nonce =
        existingPending
        && existingPending.sceneId === state.current_scene
        && existingPending.key === awaitInput.key
        && existingPending.kind === awaitInput.kind
          ? existingPending.nonce
          : randomUUID();

      state = saveProgress(state.guild_id, state.script_id, {
        [AWAKEN_CONTINUE_KEY]: null,
      }, { db: opts.db });

      state = saveProgress(state.guild_id, state.script_id, buildPendingPromptPatch({
        key: awaitInput.key,
        kind: awaitInput.kind,
        sceneId: state.current_scene,
        nonce,
        createdAtMs: existingPending?.createdAtMs ?? Date.now(),
      }), { db: opts.db });
    }

    return {
      status: "blocked",
      emittedBeatCount: emitted,
      sleptMs,
      reason: "prompt",
      sceneId: state.current_scene,
      state,
        runtimeChannelId: opts.runtimeChannelId,
    };
  }

  state = saveProgress(state.guild_id, state.script_id, {
    ...clearPendingPromptPatch(),
  }, { db: opts.db });

  try {
    await executeCommits({
      db: opts.db,
      scriptId: script.id,
      sceneId: state.current_scene,
      scene,
      state,
    });
  } catch {
    // Recoverable path: caller surfaces rerun guidance (/meepo awaken).
    return {
      status: "blocked",
      emittedBeatCount: emitted,
      sleptMs,
      reason: "commit",
      sceneId: state.current_scene,
      state,
      runtimeChannelId: opts.runtimeChannelId,
    };
  }

  await executeSceneActions({
    db: opts.db,
    interaction,
    state,
    sceneId: state.current_scene,
    scene,
  });

  const nextSceneId = resolveNextSceneId(scene.next);
  if (scene.next !== undefined && nextSceneId === null) {
    return {
      status: "blocked",
      emittedBeatCount: emitted,
      sleptMs,
      reason: "next",
      sceneId: state.current_scene,
      state,
      runtimeChannelId: opts.runtimeChannelId,
    };
  }

  if (!nextSceneId) {
    state = saveProgress(state.guild_id, state.script_id, {
      ...clearPendingPromptPatch(),
    }, { db: opts.db });
    setBeatIndex(state.guild_id, state.script_id, 0, { db: opts.db });
    markComplete(state.guild_id, state.script_id, { db: opts.db });
    return {
      status: "completed",
      emittedBeatCount: emitted,
      sleptMs,
      runtimeChannelId: opts.runtimeChannelId,
    };
  }

  state = saveProgress(state.guild_id, state.script_id, {
    ...clearPendingPromptPatch(),
  }, { db: opts.db });
  setBeatIndex(state.guild_id, state.script_id, 0, { db: opts.db });
  const advancedState = advanceScene(state.guild_id, state.script_id, nextSceneId, { db: opts.db });
  return {
    status: "advanced",
    emittedBeatCount: emitted,
    sleptMs,
    fromScene: state.current_scene,
    toScene: nextSceneId,
    state: advancedState,
    runtimeChannelId: opts.runtimeChannelId,
  };
}

export const AwakenEngine = {
  async runWake(interaction: InteractionLike, options: RunOptions): Promise<AwakenRunResult> {
    const script = options.script ?? await loadAwakenScript(options.scriptId ?? "meepo_awaken");
    const guildId = interaction.guildId as string;
    const maxBeatsPerRun = options.maxBeatsPerRun ?? MAX_BEATS_PER_RUN;
    const maxTotalDelayMsPerRun = options.maxTotalDelayMsPerRun ?? MAX_TOTAL_DELAY_MS_PER_RUN;
    const sleepFn = options.sleepFn ?? defaultSleep;

    let state = loadState(guildId, script.id, { db: options.db });
    if (!state) {
      return { status: "noop", reason: "no_state", emittedBeatCount: 0 };
    }

    console.log(`[AwakenEngine] runWake guild=${guildId} scene=${state.current_scene} beat=${state.beat_index}`);

    if (state.completed) {
      return { status: "noop", reason: "already_completed", emittedBeatCount: 0 };
    }

    await ensureAck(interaction);

    let emittedTotal = 0;
    let totalSleptMs = 0;
    let lastAdvance: { fromScene: string; toScene: string } | null = null;
    let runtimeChannelId = options.runtimeChannelId ?? interaction.channelId;

    if (runtimeChannelId && state.progress_json.current_channel_id !== runtimeChannelId) {
      state = saveProgress(guildId, script.id, {
        current_channel_id: runtimeChannelId,
      }, { db: options.db });
    }

    for (let sceneSteps = 0; sceneSteps < MAX_SCENE_STEPS_PER_RUN; sceneSteps += 1) {
      const remainingBudget = Math.max(0, maxBeatsPerRun - emittedTotal);
      const remainingDelayBudget = Math.max(0, maxTotalDelayMsPerRun - totalSleptMs);
      if (remainingBudget === 0) {
        return {
          status: "blocked",
          reason: "budget",
          sceneId: state.current_scene,
          emittedBeatCount: emittedTotal,
        };
      }
      if (remainingDelayBudget === 0) {
        return {
          status: "blocked",
          reason: "budget_delay",
          sceneId: state.current_scene,
          emittedBeatCount: emittedTotal,
        };
      }

      const result = await runCurrentScene(interaction, script, state, {
        db: options.db,
        runtimeChannelId,
        maxBeatsRemaining: remainingBudget,
        maxDelayRemainingMs: remainingDelayBudget,
        sleepFn,
      });

      emittedTotal += result.emittedBeatCount;
      totalSleptMs += result.sleptMs;
  runtimeChannelId = result.runtimeChannelId ?? runtimeChannelId;

      if (result.status === "completed") {
        console.log(`[AwakenEngine] script completed: ${script.id}`);
        return {
          status: "completed",
          emittedBeatCount: emittedTotal,
        };
      }

      if (result.status === "blocked") {
        return {
          status: "blocked",
          reason: result.reason,
          sceneId: result.sceneId,
          emittedBeatCount: emittedTotal,
        };
      }

      lastAdvance = {
        fromScene: result.fromScene,
        toScene: result.toScene,
      };
      state = result.state;
    }

    if (lastAdvance) {
      return {
        status: "advanced",
        emittedBeatCount: emittedTotal,
        fromScene: lastAdvance.fromScene,
        toScene: lastAdvance.toScene,
      };
    }

    return {
      status: "blocked",
      reason: "next",
      sceneId: state.current_scene,
      emittedBeatCount: emittedTotal,
    };
  },
};
