import {
  ApplicationCommandOptionType,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
} from "discord.js";
// NOTE(v1.1): meepoLegacy is intentionally excluded from voice-string centralization.
// This lab-only surface is deferred and may retain inline prose until a dedicated legacy pass.
import { meepo as meepoLegacy } from "./meepoLegacy.js";
import { session } from "./session.js";
import { meeps } from "./meeps.js";
import { missions } from "./missions.js";
import { goldmem } from "./goldmem.js";
import { cfg } from "../config/env.js";
import type { CommandCtx } from "./index.js";
import fs from "node:fs";
import { getDbForCampaign } from "../db.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { resolveMeepoActionLogPaths } from "../ledger/meepoActionLogging.js";
import {
  getActiveSession,
  startSession,
  type Session,
  type SessionKind,
} from "../sessions/sessions.js";
import {
  listAnchorsForAutocomplete,
  listSessionsForAutocomplete,
  resolveLatestUserAnchorLedgerId,
  resolveSessionSelection,
} from "./shared/sessionResolve.js";

/**
 * Session-kind vocabulary for /lab wake:
 * - Official canon session: kind=canon && mode_at_start != lab
 * - Lab-created canon session: kind=canon && mode_at_start = lab
 * - Lab-created noncanon session: kind=noncanon (stored as kind=chat) && mode_at_start = lab
 */

export type LabWakeKind = "canon" | "noncanon";

type ResolveOrStartLabSessionResult = {
  action: "reused-official" | "reused-existing" | "started-new";
  session: Session;
  created: boolean;
  noLabCreated: boolean;
  requestedKind: LabWakeKind;
  resolvedLabel: string | null;
};

type ResolveOrStartLabSessionDeps = {
  getActiveSessionFn: (guildId: string) => Session | null;
  startSessionFn: (
    guildId: string,
    startedById: string | null,
    startedByName: string | null,
    opts?: { label?: string | null; source?: string | null; kind?: SessionKind; modeAtStart?: any }
  ) => Session;
  labelExistsFn: (guildId: string, label: string) => boolean;
  nowMsFn: () => number;
};

function isOfficialCanonSession(session: Session): boolean {
  return session.kind === "canon" && session.mode_at_start !== "lab";
}

function mapLabWakeKindToSessionKind(kind: LabWakeKind): SessionKind {
  return kind === "noncanon" ? "noncanon" : "canon";
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function buildUtcLabLabel(nowMs: number): string {
  const dt = new Date(nowMs);
  return [
    "lab_",
    dt.getUTCFullYear(),
    pad2(dt.getUTCMonth() + 1),
    pad2(dt.getUTCDate()),
    "_",
    pad2(dt.getUTCHours()),
    pad2(dt.getUTCMinutes()),
    pad2(dt.getUTCSeconds()),
  ].join("");
}

function ensureUniqueLabLabel(args: {
  guildId: string;
  baseLabel: string;
  labelExistsFn: (guildId: string, label: string) => boolean;
}): string {
  if (!args.labelExistsFn(args.guildId, args.baseLabel)) {
    return args.baseLabel;
  }
  for (let suffix = 1; suffix < 1000; suffix += 1) {
    const candidate = `${args.baseLabel}_${String(suffix).padStart(2, "0")}`;
    if (!args.labelExistsFn(args.guildId, candidate)) {
      return candidate;
    }
  }
  return `${args.baseLabel}_${Date.now()}`;
}

function formatSessionTitle(session: Session): string {
  const label = (session.label ?? "").trim();
  const base = label.length > 0 ? label : "(unlabeled)";
  if (session.mode_at_start === "lab") {
    return `(dev) ${base}`;
  }
  return base;
}

function formatStartedAtUtc(ms: number): string {
  return new Date(ms).toISOString();
}

function defaultLabelExists(guildId: string, label: string): boolean {
  const db = getGuildCampaignDb({ guildId });
  const row = db
    .prepare(`SELECT 1 AS found FROM sessions WHERE guild_id = ? AND label = ? LIMIT 1`)
    .get(guildId, label) as { found: number } | undefined;
  return Boolean(row?.found);
}

export function resolveOrStartLabSession(
  args: {
    guildId: string;
    requestedKind?: LabWakeKind | null;
    label?: string | null;
    startedById?: string | null;
    startedByName?: string | null;
  },
  deps?: Partial<ResolveOrStartLabSessionDeps>
): ResolveOrStartLabSessionResult {
  const impl: ResolveOrStartLabSessionDeps = {
    getActiveSessionFn: deps?.getActiveSessionFn ?? getActiveSession,
    startSessionFn: deps?.startSessionFn ?? startSession,
    labelExistsFn: deps?.labelExistsFn ?? defaultLabelExists,
    nowMsFn: deps?.nowMsFn ?? (() => Date.now()),
  };

  const requestedKind: LabWakeKind = args.requestedKind ?? "canon";
  const activeSession = impl.getActiveSessionFn(args.guildId);
  if (activeSession) {
    if (isOfficialCanonSession(activeSession)) {
      return {
        action: "reused-official",
        session: activeSession,
        created: false,
        noLabCreated: true,
        requestedKind,
        resolvedLabel: activeSession.label,
      };
    }
    return {
      action: "reused-existing",
      session: activeSession,
      created: false,
      noLabCreated: true,
      requestedKind,
      resolvedLabel: activeSession.label,
    };
  }

  const providedLabel = (args.label ?? "").trim();
  const resolvedLabel = providedLabel.length > 0
    ? providedLabel
    : ensureUniqueLabLabel({
        guildId: args.guildId,
        baseLabel: buildUtcLabLabel(impl.nowMsFn()),
        labelExistsFn: impl.labelExistsFn,
      });

  const created = impl.startSessionFn(
    args.guildId,
    args.startedById ?? null,
    args.startedByName ?? null,
    {
      label: resolvedLabel,
      kind: mapLabWakeKindToSessionKind(requestedKind),
      modeAtStart: "lab",
    }
  );

  return {
    action: "started-new",
    session: created,
    created: true,
    noLabCreated: false,
    requestedKind,
    resolvedLabel,
  };
}

type LegacyCommand = {
  data: { toJSON(): any };
  execute: (interaction: any, ctx: CommandCtx | null) => Promise<void>;
};

function readSessionMeepoActionEvents(args: { guildId: string; guildName?: string | null; sessionId: string }): Array<Record<string, any>> {
  const campaignSlug = resolveCampaignSlug({ guildId: args.guildId, guildName: args.guildName ?? undefined });
  const db = getDbForCampaign(campaignSlug);
  const { jsonlPath } = resolveMeepoActionLogPaths(db, {
    guildId: args.guildId,
    sessionId: args.sessionId,
    runKind: "online",
  });
  if (!fs.existsSync(jsonlPath)) return [];
  return fs
    .readFileSync(jsonlPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, any>;
      } catch {
        return null;
      }
    })
    .filter((row): row is Record<string, any> => Boolean(row));
}

function getGuildCampaignDb(args: { guildId: string; guildName?: string | null }): any {
  const campaignSlug = resolveCampaignSlug({ guildId: args.guildId, guildName: args.guildName ?? undefined });
  return getDbForCampaign(campaignSlug);
}

const actionsLab: LegacyCommand = {
  data: new SlashCommandBuilder()
    .setName("actions")
    .setDescription("Inspect meepo action observability logs")
    .addSubcommand((sub) =>
      sub
        .setName("tail")
        .setDescription("Tail meepo action events for a session")
        .addStringOption((opt) =>
          opt.setName("session").setDescription("Session").setRequired(false).setAutocomplete(true)
        )
        .addIntegerOption((opt) =>
          opt.setName("n").setDescription("Number of events").setRequired(false).setMinValue(1).setMaxValue(200)
        )
    ),

  async execute(interaction: any): Promise<void> {
    const guildId = interaction.guildId as string | null;
    if (!guildId) {
      await interaction.reply({ content: "Guild context is required.", ephemeral: true });
      return;
    }
    const db = getGuildCampaignDb({ guildId, guildName: interaction.guild?.name ?? null });

    const selectedSession = resolveSessionSelection({
      guildId,
      guildName: interaction.guild?.name ?? null,
      channelId: interaction.channelId ?? null,
      sessionOpt: interaction.options.getString("session", false),
      db,
    });
    const n = interaction.options.getInteger("n", false) ?? 20;
    if (!selectedSession) {
      await interaction.reply({ content: "No official canon sessions found.", ephemeral: true });
      return;
    }

    const rows = readSessionMeepoActionEvents({ guildId, guildName: interaction.guild?.name ?? null, sessionId: selectedSession.sessionId })
      .filter((row) => row.session_id === selectedSession.sessionId)
      .slice(-n);

    if (rows.length === 0) {
      await interaction.reply({ content: `No meepo_actions events found for session ${selectedSession.sessionId}.`, ephemeral: true });
      return;
    }

    const lines = rows.map((row) => {
      const eventName = String(row.event ?? row.event_type ?? "unknown");
      const data = (row.data ?? {}) as Record<string, any>;
      if (eventName === "heartbeat-tick") {
        return `HEARTBEAT_TICK cursor ${String(data.cursor_before ?? "?")}→${String(data.cursor_after ?? "?")} watermark ${String(data.watermark_before ?? "?")}→${String(data.watermark_after ?? "?")} enq=${String(data.enqueued_count ?? 0)} dedupe=${String(data.deduped_count ?? 0)}`;
      }
      if (eventName === "action-enqueued" || eventName === "action-deduped") {
        return `${eventName.toUpperCase().replace(/-/g, "_")} ${String(data.action_type ?? "?")} anchor=${String(row.anchor_ledger_id ?? "null")}`;
      }
      if (eventName === "prompt-bundle-built") {
        return `PROMPT_BUNDLE_BUILT anchor=${String(row.anchor_ledger_id ?? "null")} has_retrieval=${String(Boolean(data.has_retrieval))}`;
      }
      return `${eventName} anchor=${String(row.anchor_ledger_id ?? "null")}`;
    });

    const prefix = selectedSession.usedDefault
      ? [`Using session: ${selectedSession.displayName}`, ""]
      : [];

    await interaction.reply({ content: [...prefix, ...lines].join("\n"), ephemeral: true });
  },
};

const promptLab: LegacyCommand = {
  data: new SlashCommandBuilder()
    .setName("prompt")
    .setDescription("Inspect prompt observability for an anchor")
    .addSubcommand((sub) =>
      sub
        .setName("inspect")
        .setDescription("Inspect prompt/context/retrieval chain for an anchor")
        .addStringOption((opt) =>
          opt.setName("session").setDescription("Session").setRequired(false).setAutocomplete(true)
        )
        .addStringOption((opt) =>
          opt.setName("anchor").setDescription("Anchor ledger id or latest").setRequired(false).setAutocomplete(true)
        )
    ),

  async execute(interaction: any): Promise<void> {
    const guildId = interaction.guildId as string | null;
    if (!guildId) {
      await interaction.reply({ content: "Guild context is required.", ephemeral: true });
      return;
    }
    const db = getGuildCampaignDb({ guildId, guildName: interaction.guild?.name ?? null });

    const selectedSession = resolveSessionSelection({
      guildId,
      guildName: interaction.guild?.name ?? null,
      channelId: interaction.channelId ?? null,
      sessionOpt: interaction.options.getString("session", false),
      db,
    });
    if (!selectedSession) {
      await interaction.reply({ content: "No official canon sessions found.", ephemeral: true });
      return;
    }

    const requestedAnchor = (interaction.options.getString("anchor", false) ?? "").trim();
    const anchorLedgerId = !requestedAnchor || requestedAnchor.toLowerCase() === "latest"
      ? resolveLatestUserAnchorLedgerId({
          guildId,
          guildName: interaction.guild?.name ?? null,
          sessionId: selectedSession.sessionId,
          db,
        })
      : requestedAnchor;

    if (!anchorLedgerId) {
      await interaction.reply({
        content: "No user-message anchors found in this session. Try /lab actions tail or choose another session.",
        ephemeral: true,
      });
      return;
    }

    const rows = readSessionMeepoActionEvents({ guildId, guildName: interaction.guild?.name ?? null, sessionId: selectedSession.sessionId })
      .filter((row) => row.session_id === selectedSession.sessionId);

    if (rows.length === 0) {
      await interaction.reply({ content: `No meepo_actions events found for session ${selectedSession.sessionId}.`, ephemeral: true });
      return;
    }

    const forAnchor = rows.filter((row) => String(row.anchor_ledger_id ?? "") === anchorLedgerId);
    const latestPrompt = [...forAnchor].reverse().find((row) => String(row.event ?? row.event_type ?? "") === "prompt-bundle-built");
    const latestSnapshot = [...forAnchor].reverse().find((row) => String(row.event ?? row.event_type ?? "") === "context-snapshot-built");
    const retrievalRows = forAnchor.filter((row) => {
      const eventName = String(row.event ?? row.event_type ?? "");
      return eventName === "RETRIEVAL_ENQUEUED"
        || eventName === "RETRIEVAL_DONE"
        || eventName === "RETRIEVAL_REUSED"
        || eventName === "action-enqueued"
        || eventName === "action-deduped";
    });

    const promptData = (latestPrompt?.data ?? {}) as Record<string, any>;
    const snapshotData = (latestSnapshot?.data ?? {}) as Record<string, any>;
    const retrievalArtifact = String(
      promptData.retrieval_artifact_relpath
      ?? retrievalRows.find((row) => String(row.event ?? row.event_type ?? "") === "RETRIEVAL_DONE")?.artifact_path
      ?? ""
    );

    const report = [
      `session_id=${selectedSession.sessionId}`,
      `anchor_ledger_id=${anchorLedgerId}`,
      `prompt_event=${latestPrompt ? String(latestPrompt.event ?? latestPrompt.event_type) : "missing"}`,
      `context_snapshot_event=${latestSnapshot ? String(latestSnapshot.event ?? latestSnapshot.event_type) : "missing"}`,
      `has_retrieval=${String(Boolean(promptData.has_retrieval))}`,
      `retrieval_events=${String(retrievalRows.length)}`,
      `retrieval_artifact=${retrievalArtifact || "missing"}`,
      `context_hash=${String(snapshotData.context_hash ?? "") || "missing"}`,
      `bundle_hash=${String(promptData.bundle_hash ?? "") || "missing"}`,
    ];

    if (selectedSession.usedDefault) {
      report.unshift(`Using session: ${selectedSession.displayName}`, "");
    }

    await interaction.reply({ content: report.join("\n"), ephemeral: true });
  },
};

const wakeLab: LegacyCommand = {
  data: new SlashCommandBuilder()
    .setName("wake")
    .setDescription("Resolve or start a lab session")
    .addSubcommand((sub) =>
      sub
        .setName("run")
        .setDescription("Reuse active session or start a lab session if none exists")
        .addStringOption((opt) =>
          opt
            .setName("kind")
            .setDescription("Session kind for new lab session when no active session exists")
            .setRequired(false)
            .addChoices(
              { name: "canon", value: "canon" },
              { name: "noncanon", value: "noncanon" },
            )
        )
        .addStringOption((opt) =>
          opt
            .setName("label")
            .setDescription("Session label for new lab session (optional)")
            .setRequired(false)
        )
    ),

  async execute(interaction: any): Promise<void> {
    const guildId = interaction.guildId as string | null;
    if (!guildId) {
      await interaction.reply({ content: "Guild context is required.", ephemeral: true });
      return;
    }

    const kindOpt = (interaction.options.getString("kind", false) ?? "canon") as LabWakeKind;
    const labelOpt = interaction.options.getString("label", false);
    const result = resolveOrStartLabSession({
      guildId,
      requestedKind: kindOpt,
      label: labelOpt,
      startedById: interaction.user?.id ?? null,
      startedByName: interaction.user?.displayName ?? interaction.user?.username ?? null,
    });

    const sessionTitle = formatSessionTitle(result.session);
    const sessionDetails = `Session: ${sessionTitle} • started ${formatStartedAtUtc(result.session.started_at_ms)}`;

    if (result.action === "reused-official") {
      await interaction.reply({
        content: [
          "Using existing official canon session (no changes made).",
          sessionDetails,
          "No lab session created because an official canon session is active.",
          "Use /lab session-view or /meepo sessions list to inspect sessions.",
        ].join("\n"),
        ephemeral: true,
      });
      return;
    }

    if (result.action === "reused-existing") {
      await interaction.reply({
        content: [
          `Using existing session: ${sessionTitle}`,
          sessionDetails,
        ].join("\n"),
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: [
        `Started lab session: ${sessionTitle} in <#${interaction.channelId}>`,
        sessionDetails,
      ].join("\n"),
      ephemeral: true,
    });
  },
};

const familyCommands: Record<string, LegacyCommand> = {
  meepo: meepoLegacy,
  session,
  meeps,
  missions,
  goldmem,
  actions: actionsLab,
  prompt: promptLab,
  wake: wakeLab,
};

type Route = {
  exposedSubcommand: string;
  targetSubcommand: string;
  targetSubcommandGroup: string | null;
  sourceOption: any;
};

function applyPrimitiveOption(sub: SlashCommandSubcommandBuilder, option: any): void {
  if (option.type === ApplicationCommandOptionType.String) {
    sub.addStringOption((opt) => {
      opt.setName(option.name).setDescription(option.description ?? "").setRequired(Boolean(option.required));
      if (Array.isArray(option.choices) && option.choices.length > 0) {
        opt.addChoices(...option.choices.map((choice: any) => ({ name: choice.name, value: choice.value })));
      }
      if (option.autocomplete) {
        opt.setAutocomplete(true);
      }
      return opt;
    });
    return;
  }

  if (option.type === ApplicationCommandOptionType.Integer) {
    sub.addIntegerOption((opt) => {
      opt.setName(option.name).setDescription(option.description ?? "").setRequired(Boolean(option.required));
      if (typeof option.min_value === "number") opt.setMinValue(option.min_value);
      if (typeof option.max_value === "number") opt.setMaxValue(option.max_value);
      if (Array.isArray(option.choices) && option.choices.length > 0) {
        opt.addChoices(...option.choices.map((choice: any) => ({ name: choice.name, value: choice.value })));
      }
      return opt;
    });
    return;
  }

  if (option.type === ApplicationCommandOptionType.Boolean) {
    sub.addBooleanOption((opt) =>
      opt.setName(option.name).setDescription(option.description ?? "").setRequired(Boolean(option.required))
    );
    return;
  }

  if (option.type === ApplicationCommandOptionType.User) {
    sub.addUserOption((opt) =>
      opt.setName(option.name).setDescription(option.description ?? "").setRequired(Boolean(option.required))
    );
    return;
  }

  if (option.type === ApplicationCommandOptionType.Channel) {
    sub.addChannelOption((opt) => {
      opt.setName(option.name).setDescription(option.description ?? "").setRequired(Boolean(option.required));
      if (Array.isArray(option.channel_types) && option.channel_types.length > 0) {
        opt.addChannelTypes(...option.channel_types);
      }
      return opt;
    });
    return;
  }

  if (option.type === ApplicationCommandOptionType.Number) {
    sub.addNumberOption((opt) => {
      opt.setName(option.name).setDescription(option.description ?? "").setRequired(Boolean(option.required));
      if (typeof option.min_value === "number") opt.setMinValue(option.min_value);
      if (typeof option.max_value === "number") opt.setMaxValue(option.max_value);
      return opt;
    });
    return;
  }

  if (option.type === ApplicationCommandOptionType.Role) {
    sub.addRoleOption((opt) =>
      opt.setName(option.name).setDescription(option.description ?? "").setRequired(Boolean(option.required))
    );
    return;
  }

  if (option.type === ApplicationCommandOptionType.Mentionable) {
    sub.addMentionableOption((opt) =>
      opt.setName(option.name).setDescription(option.description ?? "").setRequired(Boolean(option.required))
    );
    return;
  }

  if (option.type === ApplicationCommandOptionType.Attachment) {
    sub.addAttachmentOption((opt) =>
      opt.setName(option.name).setDescription(option.description ?? "").setRequired(Boolean(option.required))
    );
  }
}

function cloneSubcommand(targetName: string, sourceSubcommand: any): SlashCommandSubcommandBuilder {
  const sub = new SlashCommandSubcommandBuilder()
    .setName(targetName)
    .setDescription(sourceSubcommand.description ?? "");

  const optionList = Array.isArray(sourceSubcommand.options) ? sourceSubcommand.options : [];
  for (const option of optionList) {
    applyPrimitiveOption(sub, option);
  }

  return sub;
}

function buildRoutesFromCommand(command: LegacyCommand): Route[] {
  const json = command.data.toJSON();
  const options = Array.isArray(json.options) ? json.options : [];

  const hasSubcommands = options.some(
    (option: any) =>
      option.type === ApplicationCommandOptionType.Subcommand ||
      option.type === ApplicationCommandOptionType.SubcommandGroup
  );

  if (!hasSubcommands) {
    return [
      {
        exposedSubcommand: "run",
        targetSubcommand: "run",
        targetSubcommandGroup: null,
        sourceOption: {
          name: "run",
          description: json.description ?? "Run command",
          options,
        },
      },
    ];
  }

  const routes: Route[] = [];
  for (const option of options) {
    if (option.type === ApplicationCommandOptionType.Subcommand) {
      routes.push({
        exposedSubcommand: option.name,
        targetSubcommand: option.name,
        targetSubcommandGroup: null,
        sourceOption: option,
      });
      continue;
    }

    if (option.type === ApplicationCommandOptionType.SubcommandGroup) {
      for (const sub of option.options ?? []) {
        routes.push({
          exposedSubcommand: `${option.name}-${sub.name}`,
          targetSubcommand: sub.name,
          targetSubcommandGroup: option.name,
          sourceOption: sub,
        });
      }
    }
  }

  return routes;
}

const routesByFamily: Record<string, Route[]> = Object.fromEntries(
  Object.entries(familyCommands).map(([family, command]) => [family, buildRoutesFromCommand(command)])
);

function buildLabData(): SlashCommandBuilder {
  const root = new SlashCommandBuilder().setName("lab").setDescription("Legacy command quarantine namespace.");

  for (const [family, command] of Object.entries(familyCommands)) {
    const sourceDescription = command.data.toJSON().description ?? `Legacy /${family}`;
    const routes = routesByFamily[family] ?? [];

    root.addSubcommandGroup((group) => {
      group.setName(family).setDescription(`Legacy /${family}: ${sourceDescription}`);
      for (const route of routes) {
        group.addSubcommand(cloneSubcommand(route.exposedSubcommand, route.sourceOption));
      }
      return group;
    });
  }

  return root;
}

function createRoutedInteraction(interaction: any, route: Route): any {
  const baseOptions = interaction.options;
  const routedInteraction = Object.create(interaction);
  routedInteraction.options = Object.create(baseOptions);
  routedInteraction.options.getSubcommandGroup = (required?: boolean) => {
    if (route.targetSubcommandGroup) {
      return route.targetSubcommandGroup;
    }
    if (required) {
      throw new Error("Expected subcommand group");
    }
    return null;
  };
  routedInteraction.options.getSubcommand = () => route.targetSubcommand;
  routedInteraction.options.getString = (name: string, required?: boolean) =>
    baseOptions.getString(name, required);
  routedInteraction.options.getInteger = (name: string, required?: boolean) =>
    baseOptions.getInteger(name, required);
  routedInteraction.options.getBoolean = (name: string, required?: boolean) =>
    baseOptions.getBoolean(name, required);
  routedInteraction.options.getUser = (name: string, required?: boolean) =>
    baseOptions.getUser(name, required);
  routedInteraction.options.getChannel = (name: string, required?: boolean) =>
    baseOptions.getChannel(name, required);
  routedInteraction.options.getRole = (name: string, required?: boolean) =>
    baseOptions.getRole(name, required);
  routedInteraction.options.getMentionable = (name: string, required?: boolean) =>
    baseOptions.getMentionable(name, required);
  routedInteraction.options.getNumber = (name: string, required?: boolean) =>
    baseOptions.getNumber(name, required);
  routedInteraction.options.getAttachment = (name: string, required?: boolean) =>
    baseOptions.getAttachment(name, required);
  return routedInteraction;
}

export const lab = {
  data: buildLabData(),

  async autocomplete(interaction: any) {
    const guildId = interaction.guildId as string | null;
    if (!guildId) {
      await interaction.respond([]);
      return;
    }

    const focused = interaction.options.getFocused(true);
    const family = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(false);

    if (focused.name === "session") {
      const supportsSessionAutocomplete =
        (family === "actions" && sub === "tail") || (family === "prompt" && sub === "inspect");
      if (!supportsSessionAutocomplete) {
        await interaction.respond([]);
        return;
      }

      const db = getGuildCampaignDb({ guildId, guildName: interaction.guild?.name ?? null });
      const choices = listSessionsForAutocomplete({
        guildId,
        guildName: interaction.guild?.name ?? null,
        channelId: interaction.channelId ?? null,
        query: String(focused.value ?? ""),
        db,
      });
      await interaction.respond(choices.slice(0, 25));
      return;
    }

    if (focused.name === "anchor" && family === "prompt" && sub === "inspect") {
      const db = getGuildCampaignDb({ guildId, guildName: interaction.guild?.name ?? null });
      const sessionSelection = resolveSessionSelection({
        guildId,
        guildName: interaction.guild?.name ?? null,
        channelId: interaction.channelId ?? null,
        sessionOpt: interaction.options.getString("session", false),
        db,
      });

      const latestChoice = [{ name: "latest", value: "latest" }];
      if (!sessionSelection) {
        await interaction.respond(latestChoice);
        return;
      }

      const anchors = listAnchorsForAutocomplete({
        guildId,
        guildName: interaction.guild?.name ?? null,
        sessionId: sessionSelection.sessionId,
        query: String(focused.value ?? ""),
        db,
      });

      await interaction.respond([...latestChoice, ...anchors].slice(0, 25));
      return;
    }

    await interaction.respond([]);
  },

  async execute(interaction: any, ctx: CommandCtx | null) {
    const userId = interaction.user?.id as string | undefined;
    const guildId = interaction.guildId as string | null;
    const allowByUser = Boolean(userId && cfg.access.devUserIds.includes(userId));
    const allowByGuild = Boolean(guildId && cfg.access.devGuildIds.includes(guildId));

    if (!allowByUser && !allowByGuild) {
      await interaction.reply({
        content: "Not authorized. /lab is restricted to development allowlists.",
        ephemeral: true,
      });
      return;
    }

    const family = interaction.options.getSubcommandGroup(true);
    const exposedSubcommand = interaction.options.getSubcommand(true);

    const command = familyCommands[family];
    if (!command) {
      await interaction.reply({ content: `Unknown /lab family: ${family}`, ephemeral: true });
      return;
    }

    const route = (routesByFamily[family] ?? []).find((item) => item.exposedSubcommand === exposedSubcommand);
    if (!route) {
      await interaction.reply({ content: `Unknown /lab ${family} command: ${exposedSubcommand}`, ephemeral: true });
      return;
    }

    const routedInteraction = createRoutedInteraction(interaction, route);
    await command.execute(routedInteraction, ctx);
  },
};
