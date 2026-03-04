import fs from "node:fs";
import { AttachmentBuilder, GuildMember, SlashCommandBuilder } from "discord.js";
import {
  getGuildCanonPersonaId,
  getGuildCanonPersonaMode,
  getGuildConfig,
  getGuildDmUserId,
  getGuildDefaultRecapStyle,
  getGuildHomeTextChannelId,
  getGuildHomeVoiceChannelId,
  getGuildSetupVersion,
  resolveGuildHomeVoiceChannelId,
  setGuildCanonPersonaId,
  setGuildCanonPersonaMode,
  setGuildDefaultRecapStyle,
  setGuildDmUserId,
  setGuildHomeTextChannelId,
  setGuildHomeVoiceChannelId,
} from "../campaign/guildConfig.js";
import { ensureGuildSetup, type SetupReport } from "../campaign/ensureGuildSetup.js";
import { cfg } from "../config/env.js";
import { getAvailablePersonaIds, getPersona } from "../personas/index.js";
import { logSystemEvent } from "../ledger/system.js";
import { wakeMeepo, getActiveMeepo, sleepMeepo } from "../meepo/state.js";
import { getEffectivePersonaId } from "../meepo/personaState.js";
import { isElevated } from "../security/isElevated.js";
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
import { metaMeepoVoice, type DoctorCheck } from "../ui/metaMeepoVoice.js";
import type { CommandCtx } from "./index.js";
import { PermissionFlagsBits } from "discord.js";

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

async function runDoctorChecks(interaction: any, ctx: CommandCtx): Promise<DoctorCheck[]> {
  const guildId = interaction.guildId as string;
  const channel = interaction.channel;
  const botMember = interaction.guild?.members?.me ?? null;
  const checks: DoctorCheck[] = [];

  const campaignSlug = ctx.campaignSlug;
  checks.push(
    campaignSlug
      ? { icon: "✅", label: "Campaign slug resolved", action: "No action needed" }
      : { icon: "❌", label: "Campaign slug missing", action: "Run /meepo wake to initialize guild setup" }
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
      action: "Run /meepo wake then start a session and generate a recap",
    });
  } else {
    const baseStatus = getBaseStatus(ctx.campaignSlug, session.session_id, session.label);
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

async function handleWake(interaction: any, ctx: CommandCtx): Promise<void> {
  const guildId = interaction.guildId as string;
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

async function handleSessionsRecap(interaction: any): Promise<void> {
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

  await interaction.deferReply({ ephemeral: true });

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
  const fileStem = buildSessionArtifactStem(session.session_id, session.label);
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
      await interaction.reply({ content: metaMeepoVoice.sessions.sessionNotFound(), ephemeral: true });
      return;
    }

    const recap = getSessionArtifact(guildId, session.session_id, "recap_final") as SessionArtifactRow | null;
    const transcriptArtifact = getSessionArtifact(
      guildId,
      session.session_id,
      "transcript_export"
    ) as SessionArtifactRow | null;
    const effectiveCampaignSlug = ctx.campaignSlug;

    const baseStatus = getBaseStatus(effectiveCampaignSlug, session.session_id, session.label);
    const finalFileForDbStyle =
      recap && recap.strategy && RECAP_STRATEGIES.includes(recap.strategy as RecapPassStrategy)
        ? getFinalStatus(effectiveCampaignSlug, session.session_id, recap.strategy as RecapPassStrategy, session.label)
        : getFinalStatus(effectiveCampaignSlug, session.session_id, undefined, session.label);
    const allFinalFiles = getAllFinalStatuses(effectiveCampaignSlug, session.session_id, session.label);
    const hasAnyFinalFiles = allFinalFiles.some((status) => status.exists);

    const recapExists = Boolean(recap);
    const transcriptStatus = transcriptArtifact ? "available" : "not cached yet";

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
      transcriptMissingNotice: !transcriptArtifact,
    });

    const files: AttachmentBuilder[] = [];
    if (recap) {
      const fileStem = buildSessionArtifactStem(session.session_id, session.label);
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

    if (transcriptArtifact?.content_text) {
      const fileStem = buildSessionArtifactStem(session.session_id, session.label);
      files.push(
        new AttachmentBuilder(Buffer.from(transcriptArtifact.content_text, "utf8"), {
          name: `${fileStem}-transcript.txt`,
        })
      );
    }

    await interaction.reply({
      content: lines.join("\n"),
      files,
      ephemeral: true,
    });
    return;
  }

  if (sub === "recap") {
    await handleSessionsRecap(interaction);
    return;
  }

  await interaction.reply({ content: metaMeepoVoice.sessions.unknownAction(), ephemeral: true });
}

async function handleSettings(interaction: any): Promise<void> {
  const guildId = interaction.guildId as string;
  const sub = interaction.options.getSubcommand();

  if (sub === "show" || sub === "view") {
    const config = getGuildConfig(guildId);
    const homeText = getGuildHomeTextChannelId(guildId);
    const homeVoice = resolveGuildHomeVoiceChannelId(guildId, cfg.overlay.homeVoiceChannelId ?? null);
    const canonMode = getGuildCanonPersonaMode(guildId) ?? "meta";
    const canonPersonaId = getGuildCanonPersonaId(guildId) ?? "(auto)";
    const recapStyle = getGuildDefaultRecapStyle(guildId) ?? DEFAULT_RECAP_STRATEGY;
    const setupVersion = getGuildSetupVersion(guildId) ?? 0;
    await interaction.reply({
      content: metaMeepoVoice.settings.viewSummary({
        setupVersion,
        campaignSlug: config?.campaign_slug ?? "(unset)",
        homeTextChannel: formatChannel(homeText),
        homeVoiceChannel: formatChannel(homeVoice),
        canonMode,
        canonPersona: canonPersonaId,
        defaultRecapStyle: recapStyle,
      }),
      ephemeral: true,
    });
    return;
  }

  if (sub === "set") {
    const key = interaction.options.getString("key");
    const channel = interaction.options.getChannel("channel");
    const canonMode = interaction.options.getString("canon_mode") as "diegetic" | "meta" | null;
    const canonPersona = interaction.options.getString("canon_persona");
    const recapStyle = interaction.options.getString("recap_style") as RecapStrategy | null;
    const homeVoice = interaction.options.getChannel("home_voice");
    const dmUser = interaction.options.getUser("dm_user");

    const keyOrChannelProvided = Boolean(key) || Boolean(channel);
    const providedCount =
      (keyOrChannelProvided ? 1 : 0) +
      [canonMode, canonPersona, recapStyle, homeVoice, dmUser].filter(Boolean).length;

    if (providedCount !== 1) {
      await interaction.reply({
        content: metaMeepoVoice.settings.setExactlyOneOptionError(),
        ephemeral: true,
      });
      return;
    }

    if (keyOrChannelProvided && (!key || !channel)) {
      await interaction.reply({
        content: metaMeepoVoice.settings.keyAndChannelMustBePaired(),
        ephemeral: true,
      });
      return;
    }

    if (key && channel) {
      if (key === "home_text_channel") {
        setGuildHomeTextChannelId(guildId, channel.id);
        await interaction.reply({ content: metaMeepoVoice.settings.updatedHomeText(formatChannel(channel.id)), ephemeral: true });
        return;
      }

      if (key === "home_voice_channel") {
        setGuildHomeVoiceChannelId(guildId, channel.id);
        await interaction.reply({ content: metaMeepoVoice.settings.updatedHomeVoice(formatChannel(channel.id)), ephemeral: true });
        return;
      }

      await interaction.reply({ content: metaMeepoVoice.settings.invalidChannelSettingKey(key), ephemeral: true });
      return;
    }

    if (canonMode) {
      setGuildCanonPersonaMode(guildId, canonMode);
      await interaction.reply({ content: metaMeepoVoice.settings.updatedCanonMode(canonMode), ephemeral: true });
      return;
    }

    if (canonPersona) {
      try {
        getPersona(canonPersona);
      } catch {
        await interaction.reply({ content: metaMeepoVoice.settings.unknownPersona(canonPersona), ephemeral: true });
        return;
      }
      setGuildCanonPersonaId(guildId, canonPersona);
      await interaction.reply({ content: metaMeepoVoice.settings.updatedCanonPersona(canonPersona), ephemeral: true });
      return;
    }

    if (recapStyle) {
      setGuildDefaultRecapStyle(guildId, recapStyle);
      await interaction.reply({ content: metaMeepoVoice.settings.updatedRecapStyle(recapStyle), ephemeral: true });
      return;
    }

    if (homeVoice) {
      setGuildHomeVoiceChannelId(guildId, homeVoice.id);
      await interaction.reply({ content: metaMeepoVoice.settings.updatedHomeVoice(formatChannel(homeVoice.id)), ephemeral: true });
      return;
    }

    if (dmUser) {
      setGuildDmUserId(guildId, dmUser.id);
      await interaction.reply({ content: metaMeepoVoice.settings.updatedDmUser(`<@${dmUser.id}> (${dmUser.id})`), ephemeral: true });
      return;
    }
  }

  if (sub === "clear") {
    const key = interaction.options.getString("key", true);

    if (key === "home_text_channel") {
      setGuildHomeTextChannelId(guildId, null);
      await interaction.reply({ content: metaMeepoVoice.settings.clearedHomeText(), ephemeral: true });
      return;
    }

    if (key === "home_voice_channel") {
      setGuildHomeVoiceChannelId(guildId, null);
      await interaction.reply({ content: metaMeepoVoice.settings.clearedHomeVoice(), ephemeral: true });
      return;
    }

    if (key === "dm_user_id") {
      setGuildDmUserId(guildId, null);
      await interaction.reply({ content: metaMeepoVoice.settings.clearedDmUser(), ephemeral: true });
      return;
    }

    await interaction.reply({ content: metaMeepoVoice.settings.invalidChannelSettingKey(key), ephemeral: true });
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
    ? getBaseStatus(ctx.campaignSlug, statusSession.session_id, statusSession.label)
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
        .setName("wake")
        .setDescription("Wake Meepo; optionally start a canon session.")
        .addStringOption((opt) =>
          opt
            .setName("session")
            .setDescription("Optional session label to start canon mode.")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) => sub.setName("sleep").setDescription("Put Meepo to sleep and end active session."))
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
    .addSubcommand((sub) => sub.setName("doctor").setDescription("Run deterministic diagnostics with next actions."))
    .addSubcommandGroup((group) =>
      group
        .setName("settings")
        .setDescription("Show or edit Meepo home channels.")
        .addSubcommand((sub) => sub.setName("show").setDescription("Show saved home channels."))
        .addSubcommand((sub) =>
          sub
            .setName("set")
            .setDescription("Set one Meepo setting.")
            .addStringOption((opt) =>
              opt
                .setName("key")
                .setDescription("Channel setting key (requires channel)")
                .setRequired(false)
                .addChoices(
                  { name: "home_text_channel", value: "home_text_channel" },
                  { name: "home_voice_channel", value: "home_voice_channel" }
                )
            )
            .addChannelOption((opt) =>
              opt.setName("channel").setDescription("Channel value for key").setRequired(false)
            )
            .addStringOption((opt) =>
              opt
                .setName("canon_mode")
                .setDescription("Canon persona mode")
                .setRequired(false)
                .addChoices(
                  { name: "diegetic", value: "diegetic" },
                  { name: "meta", value: "meta" }
                )
            )
            .addStringOption((opt) =>
              opt
                .setName("canon_persona")
                .setDescription("Canon persona id")
                .setAutocomplete(true)
                .setRequired(false)
            )
            .addStringOption((opt) =>
              opt
                .setName("recap_style")
                .setDescription("Default recap style")
                .setRequired(false)
                .addChoices(
                  { name: "detailed", value: "detailed" },
                  { name: "balanced", value: "balanced" },
                  { name: "concise", value: "concise" }
                )
            )
            .addChannelOption((opt) =>
              opt
                .setName("home_voice")
                .setDescription("Set home voice channel directly")
                .setRequired(false)
            )
            .addUserOption((opt) =>
              opt
                .setName("dm_user")
                .setDescription("Bind canonical DM identity")
                .setRequired(false)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName("clear")
            .setDescription("Clear a saved home channel.")
            .addStringOption((opt) =>
              opt
                .setName("key")
                .setDescription("Setting key")
                .setRequired(true)
                .addChoices(
                  { name: "home_text_channel", value: "home_text_channel" },
                  { name: "home_voice_channel", value: "home_voice_channel" },
                  { name: "dm_user_id", value: "dm_user_id" }
                )
            )
        )
    ),

  async autocomplete(interaction: any) {
    const focused = interaction.options.getFocused(true);
    const subGroup = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(false);

    if (focused.name === "canon_persona" && subGroup === "settings" && sub === "set") {
      const query = String(focused.value ?? "").trim().toLowerCase();
      const options = getAvailablePersonaIds()
        .map((id) => {
          const persona = getPersona(id);
          return {
            name: `${persona.displayName} (${id})`.slice(0, 100),
            value: id,
          };
        })
        .filter((option) => (query ? option.value.toLowerCase().includes(query) || option.name.toLowerCase().includes(query) : true))
        .slice(0, 25);

      await interaction.respond(options);
      return;
    }

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
      subGroup === "settings" || sub === "wake" || sub === "sleep" || sub === "talk" || sub === "hush" || sub === "doctor" ||
      (subGroup === "sessions" && sub === "recap");

    if (requiresElevated && !isElevated(interaction.member as GuildMember | null)) {
      await interaction.reply({ content: metaMeepoVoice.errors.notAuthorized(), ephemeral: true });
      return;
    }

    if (subGroup === "settings") {
      await handleSettings(interaction);
      return;
    }

    if (subGroup === "sessions") {
      await handleSessions(interaction, ctx);
      return;
    }

    if (sub === "wake") {
      await handleWake(interaction, ctx);
      return;
    }

    if (sub === "sleep") {
      await handleSleep(interaction);
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
      await handleDoctor(interaction, ctx);
      return;
    }

    await interaction.reply({ content: metaMeepoVoice.errors.unknownSubcommand(), ephemeral: true });
  },
};