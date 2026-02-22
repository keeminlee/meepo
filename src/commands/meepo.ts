import { SlashCommandBuilder, TextChannel } from "discord.js";
import { getActiveMeepo, wakeMeepo, sleepMeepo, transformMeepo } from "../meepo/state.js";
import { getActivePersonaId, getMindspace, setActivePersonaId } from "../meepo/personaState.js";
import { getGuildDefaultPersonaId, resolveCampaignSlug, setGuildCampaignSlug, setGuildDefaultPersonaId } from "../campaign/guildConfig.js";
import { getAvailableForms, getPersona } from "../personas/index.js";
import { setBotNicknameForPersona } from "../meepo/nickname.js";
import { autoJoinGeneralVoice } from "../meepo/autoJoinVoice.js";
import { overlayEmitPresence } from "../overlay/server.js";
import { appendLedgerEntry } from "../ledger/ledger.js";
import { logSystemEvent } from "../ledger/system.js";
import { joinVoice, leaveVoice } from "../voice/connection.js";
import { getVoiceState, setVoiceState, clearVoiceState } from "../voice/state.js";
import { startReceiver, stopReceiver } from "../voice/receiver.js";
import { getSttProviderInfo } from "../voice/stt/provider.js";
import { getTtsProvider } from "../voice/tts/provider.js";
import { speakInGuild } from "../voice/speaker.js";
import { applyPostTtsFx } from "../voice/audioFx.js";
import { loadRegistry } from "../registry/loadRegistry.js";
import { extractRegistryMatches } from "../registry/extractRegistryMatches.js";
import { searchEventsByTitle, type EventRow } from "../ledger/eventSearch.js";
import { getTranscriptLinesDetailed, getTranscriptLines } from "../ledger/transcripts.js";
import { loadGptcap } from "../ledger/gptcapProvider.js";
import { findRelevantBeats, type ScoredBeat } from "../recall/findRelevantBeats.js";
import { buildMemoryContext } from "../recall/buildMemoryContext.js";
import { getDb } from "../db.js";
import { log } from "../utils/logger.js";
import { getTodayAtNinePmEtUnixSeconds } from "../utils/timestamps.js";
import { getNextSessionLabel } from "../sessions/sessionLabels.js";

const meepoLog = log.withScope("meepo");

function isDm(interaction: any): boolean {
  const DM_ROLE_ID = process.env.DM_ROLE_ID || "";
  return interaction.member?.roles?.cache?.has(DM_ROLE_ID) ?? false;
}

function getSessionLabelMap(sessionIds: string[]): Map<string, string | null> {
  const db = getDb();
  const stmt = db.prepare("SELECT label FROM sessions WHERE session_id = ? LIMIT 1");
  const out = new Map<string, string | null>();

  for (const sessionId of sessionIds) {
    const row = stmt.get(sessionId) as { label: string | null } | undefined;
    out.set(sessionId, row?.label ?? null);
  }

  return out;
}

function buildDebugRecallResponse(args: {
  queryText: string;
  matches: Array<{ entity_id: string; canonical: string; matched_text: string }>;
  eventsByMatch: Array<{ match: { entity_id: string; canonical: string; matched_text: string }; events: EventRow[] }>;
  sessionLabelById: Map<string, string | null>;
  uniqueLineCountBySession: Map<string, number>;
  requestedLineCountBySession: Map<string, number>;
  missingLinesBySession: Map<string, number[]>;
  beatsBySession: Map<string, ScoredBeat[]>;
  memoryContextPreview: string;
}): string {
  const {
    queryText,
    matches,
    eventsByMatch,
    sessionLabelById,
    uniqueLineCountBySession,
    requestedLineCountBySession,
    missingLinesBySession,
    beatsBySession,
    memoryContextPreview,
  } = args;

  const allEvents = new Map<string, EventRow>();
  for (const group of eventsByMatch) {
    for (const event of group.events) {
      allEvents.set(event.event_id, event);
    }
  }

  const sessionsReferenced = Array.from(
    new Set(Array.from(allEvents.values()).map((e) => e.session_id))
  );

  const totalUniqueLines = Array.from(uniqueLineCountBySession.values()).reduce((acc, n) => acc + n, 0);

  const lines: string[] = [];
  lines.push("**Debug Recall (no LLM)**");
  lines.push(`Query: ${queryText}`);
  lines.push("");

  lines.push("**Registry matches**");
  if (matches.length === 0) {
    lines.push("- none");
  } else {
    for (const m of matches) {
      lines.push(`- ${m.canonical} (${m.entity_id}) via \"${m.matched_text}\"`);
    }
  }
  lines.push("");

  lines.push("**Events found per match**");
  if (eventsByMatch.length === 0 || allEvents.size === 0) {
    lines.push("- none");
  } else {
    for (const group of eventsByMatch) {
      lines.push(`- ${group.match.canonical}: ${group.events.length}`);
    }
  }
  lines.push("");

  lines.push("**Sessions referenced**");
  if (sessionsReferenced.length === 0) {
    lines.push("- none");
  } else {
    for (const sessionId of sessionsReferenced) {
      const label = sessionLabelById.get(sessionId);
      const fetched = uniqueLineCountBySession.get(sessionId) ?? 0;
      const requested = requestedLineCountBySession.get(sessionId) ?? 0;
      const missing = missingLinesBySession.get(sessionId) ?? [];
      lines.push(`- ${label ?? "(unlabeled)"} [${sessionId.slice(0, 8)}…]: requested ${requested}, fetched ${fetched}, missing ${missing.length}`);
    }
  }
  lines.push("");

  lines.push("**How many transcript lines will be fetched**");
  lines.push(`- ${totalUniqueLines} unique lines (deduped by session)`);
  lines.push("");

  lines.push("**Relevant GPTcap beats (if enabled)**");
  let totalBeats = 0;
  for (const [sessionId, beats] of beatsBySession.entries()) {
    totalBeats += beats.length;
  }
  if (totalBeats === 0) {
    lines.push("- none (GPTcaps disabled or no overlaps)");
  } else {
    for (const [sessionId, beats] of beatsBySession.entries()) {
      const label = sessionLabelById.get(sessionId);
      if (beats.length > 0) {
        lines.push(`- ${label ?? "(unlabeled)"}: ${beats.length} beats`);
        for (const scored of beats.slice(0, 3)) {
          const preview = scored.beat.text.slice(0, 60);
          lines.push(`  [${scored.beatIndex}] score=${scored.score}: ${preview}${scored.beat.text.length > 60 ? "..." : ""}`);
        }
      }
    }
  }
  lines.push("");

  lines.push("**Memory Context Preview (formatted for LLM)**");
  if (memoryContextPreview) {
    const previewLines = memoryContextPreview.split("\n").slice(0, 15); // Limit preview for Discord
    lines.push("```");
    lines.push(...previewLines);
    if (memoryContextPreview.split("\n").length > 15) {
      lines.push("...(truncated for Discord)");
    }
    lines.push("```");
  } else {
    lines.push("- none (no beats or transcript lines)");
  }

  const content = lines.join("\n");
  return content.length > 1900 ? `${content.slice(0, 1890)}\n…(truncated)` : content;
}

export const meepo = {
  data: new SlashCommandBuilder()
    .setName("meepo")
    .setDescription("Manage Meepo (wake, sleep, status, hush).")
    .addSubcommandGroup((group) =>
      group
        .setName("debug")
        .setDescription("Debug utilities.")
        .addSubcommand((sub) =>
          sub
            .setName("recall")
            .setDescription("Debug naive recall pipeline (no LLM).")
            .addStringOption((opt) =>
              opt
                .setName("query")
                .setDescription("User query to test retrieval against")
                .setRequired(true)
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("wake")
        .setDescription("Awaken Meepo and bind it to this channel.")
        .addStringOption((opt) =>
          opt
            .setName("persona")
            .setDescription("Optional persona seed (short).")
            .setRequired(false)
        )
    )
        .addSubcommand((sub) =>
      sub
        .setName("persona-set")
        .setDescription("[DM-only] Switch persona (meta, diegetic, rei, xoblob). Campaign needs active session.")
        .addStringOption((opt) =>
          opt
            .setName("persona")
            .setDescription("Persona to switch to")
            .setRequired(true)
            .addChoices(
              { name: "Meta (companion mode)", value: "meta_meepo" },
              { name: "Diegetic (in-character Meepo)", value: "diegetic_meepo" },
              { name: "Rei", value: "rei" },
              { name: "Xoblob (echo)", value: "xoblob" }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("guild-config")
        .setDescription("[DM-only] Set guild default persona or campaign slug.")
        .addStringOption((opt) =>
          opt
            .setName("key")
            .setDescription("Setting to change")
            .setRequired(true)
            .addChoices(
              { name: "Default persona (on wake)", value: "default-persona" },
              { name: "Campaign slug (registry folder)", value: "campaign-slug" }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName("value")
            .setDescription("Value (e.g. rei, meta_meepo, pandas-dd-server)")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("debug-persona")
        .setDescription("[DM-only] Show active persona, mindspace, and last memory refs.")
    )
    .addSubcommand((sub) =>
      sub
        .setName("sleep")
        .setDescription("Put Meepo to sleep.")
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Show Meepo's current state.")
    )
    .addSubcommand((sub) =>
      sub
        .setName("transform")
        .setDescription("[Deprecated] Use /meepo persona-set instead. Transform into a form (meepo, xoblob).")
        .addStringOption((opt) =>
          opt
            .setName("character")
            .setDescription("Character to mimic (meepo, xoblob)")
            .setRequired(true)
            .addChoices(
              { name: "Meepo (default)", value: "meepo" },
              { name: "Old Xoblob", value: "xoblob" }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("join")
        .setDescription("Join your voice channel (requires /meepo wake first).")
    )
    .addSubcommand((sub) =>
      sub
        .setName("leave")
        .setDescription("Leave voice channel.")
    )
    .addSubcommand((sub) =>
      sub
        .setName("stt")
        .setDescription("Manage speech-to-text (STT) transcription.")
        .addStringOption((opt) =>
          opt
            .setName("action")
            .setDescription("Enable, disable, or check STT status")
            .setRequired(true)
            .addChoices(
              { name: "on", value: "on" },
              { name: "off", value: "off" },
              { name: "status", value: "status" }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("say")
        .setDescription("[DM-only] Force Meepo to speak text aloud in voice channel.")
        .addStringOption((opt) =>
          opt
            .setName("text")
            .setDescription("Text for Meepo to speak")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("set-speaker-mask")
        .setDescription("[DM-only] Set diegetic name for a user (prevents OOC name leakage).")
        .addUserOption((opt) =>
          opt
            .setName("user")
            .setDescription("User to mask")
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("mask")
            .setDescription("Diegetic name (e.g., 'Narrator', 'Dungeon Master')")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("clear-speaker-mask")
        .setDescription("[DM-only] Remove speaker mask for a user.")
        .addUserOption((opt) =>
          opt
            .setName("user")
            .setDescription("User to unmask")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("reply")
        .setDescription("Set how Meepo responds (voice or text).")
        .addStringOption((opt) =>
          opt
            .setName("mode")
            .setDescription("Reply mode")
            .setRequired(true)
            .addChoices(
              { name: "text", value: "text" },
              { name: "voice", value: "voice" }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("announce")
        .setDescription("[DM-only] Post a session reminder to the announcement channel")
        .addIntegerOption((opt) =>
          opt.setName("timestamp").setDescription("Unix seconds for reminder (optional)").setRequired(false)
        )
        .addStringOption((opt) =>
          opt.setName("label").setDescription("Session label override (e.g., 'C2E15')").setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName("message")
            .setDescription("Custom message prefix (default: 'Reminder that our D&D session')")
            .setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt.setName("dry_run").setDescription("Preview without posting (default: false)").setRequired(false)
        )
    ),

  async execute(interaction: any) {
    const subGroup = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId as string | null;

    if (!guildId) {
      await interaction.reply({ content: "Meepo only works in a server (not DMs).", ephemeral: true });
      return;
    }

    if (subGroup === "debug" && sub === "recall") {
      const dmRoleId = process.env.DM_ROLE_ID;
      if (dmRoleId) {
        const member = interaction.member;
        const hasDmRole = member?.roles?.cache?.has(dmRoleId) ?? false;
        if (!hasDmRole) {
          await interaction.reply({ content: "This command is DM-only.", ephemeral: true });
          return;
        }
      }

      const queryText = interaction.options.getString("query", true).trim();
      if (!queryText) {
        await interaction.reply({ content: "Query cannot be empty.", ephemeral: true });
        return;
      }

      const campaignSlug = resolveCampaignSlug({
        guildId,
        guildName: interaction.guild?.name ?? undefined,
      });
      const registry = loadRegistry({ campaignSlug });
      const matches = extractRegistryMatches(queryText, registry);

      const eventsByMatch = matches.map((match) => {
        const terms = new Set([match.canonical, match.matched_text].filter(Boolean));
        const dedup = new Map<string, EventRow>();

        for (const term of terms) {
          for (const event of searchEventsByTitle(term)) {
            dedup.set(event.event_id, event);
          }
        }

        return {
          match,
          events: Array.from(dedup.values()),
        };
      });

      const allEvents = new Map<string, EventRow>();
      for (const group of eventsByMatch) {
        for (const event of group.events) {
          allEvents.set(event.event_id, event);
        }
      }

      const sessionIds = Array.from(new Set(Array.from(allEvents.values()).map((e) => e.session_id)));
      const sessionLabelById = getSessionLabelMap(sessionIds);

      const requestedLineSetBySession = new Map<string, Set<number>>();
      for (const event of allEvents.values()) {
        const start = event.start_line;
        const end = event.end_line;
        if (typeof start !== "number" || typeof end !== "number") {
          continue;
        }

        const min = Math.min(start, end);
        const max = Math.max(start, end);
        const lineSet = requestedLineSetBySession.get(event.session_id) ?? new Set<number>();
        for (let line = min; line <= max; line++) {
          lineSet.add(line);
        }
        requestedLineSetBySession.set(event.session_id, lineSet);
      }

      const uniqueLineCountBySession = new Map<string, number>();
      const requestedLineCountBySession = new Map<string, number>();
      const missingLinesBySession = new Map<string, number[]>();
      const beatsBySession = new Map<string, ScoredBeat[]>();
      for (const [sessionId, requestedLineSet] of requestedLineSetBySession.entries()) {
        const requestedLines = Array.from(requestedLineSet.values()).sort((a, b) => a - b);
        requestedLineCountBySession.set(sessionId, requestedLines.length);
        try {
          const fetched = getTranscriptLinesDetailed(sessionId, requestedLines, {
            onMissing: "skip",
          });
          uniqueLineCountBySession.set(sessionId, fetched.lines.length);
          missingLinesBySession.set(sessionId, fetched.missing);
        } catch {
          uniqueLineCountBySession.set(sessionId, 0);
          missingLinesBySession.set(sessionId, requestedLines);
        }

        // Load GPTcap for this session (if enabled) and find relevant beats
        const label = sessionLabelById.get(sessionId);
        if (label) {
          const gptcap = loadGptcap(label);
          if (gptcap) {
            const sessionEvents = Array.from(allEvents.values()).filter((e) => e.session_id === sessionId);
            if (sessionEvents.length > 0) {
              const relevantBeats = findRelevantBeats(gptcap, sessionEvents, { topK: 6 });
              beatsBySession.set(sessionId, relevantBeats);
            }
          }
        }
      }

      // Build memory context preview from all beats
      let memoryContextPreview = "";
      const allBeats: ScoredBeat[] = [];
      for (const beats of beatsBySession.values()) {
        allBeats.push(...beats);
      }
      if (allBeats.length > 0) {
        // Collect all unique line numbers needed from beats
        const neededLines = new Set<number>();
        for (const scored of allBeats) {
          for (const lineNum of scored.beat.lines) {
            neededLines.add(lineNum);
          }
        }

        // Fetch transcript lines for all beats (use first session with beats)
        const firstSessionWithBeats = Array.from(beatsBySession.keys())[0];
        if (firstSessionWithBeats && neededLines.size > 0) {
          try {
            const transcriptLines = getTranscriptLines(firstSessionWithBeats, Array.from(neededLines));
            memoryContextPreview = buildMemoryContext(allBeats, transcriptLines, {
              maxLinesPerBeat: 2,
              maxTotalChars: 1600,
            });
          } catch (err) {
            console.warn("Failed to build memory context preview:", err);
          }
        }
      }

      const response = buildDebugRecallResponse({
        queryText,
        matches,
        eventsByMatch,
        sessionLabelById,
        uniqueLineCountBySession,
        requestedLineCountBySession,
        missingLinesBySession,
        beatsBySession,
        memoryContextPreview,
      });

      await interaction.reply({ content: response, ephemeral: true });
      return;
    }

    if (sub === "wake") {
      const persona = interaction.options.getString("persona");
      const channelId = interaction.channelId as string;

      const inst = wakeMeepo({
        guildId,
        channelId,
        personaSeed: persona,
      });

      const defaultPersonaId = getGuildDefaultPersonaId(guildId) ?? "meta_meepo";
      setActivePersonaId(guildId, defaultPersonaId);

      // Log system event (narrative secondary - state change)
      logSystemEvent({
        guildId,
        channelId,
        eventType: "npc_wake",
        content: `Meepo awakens${persona ? ` with persona: ${persona}` : ""}.`,
        authorId: interaction.user.id,
        authorName: interaction.user.username,
        narrativeWeight: "secondary",
      });

      // Reset nickname to default Meepo on wake
      if (interaction.guild) {
        await setBotNicknameForPersona(interaction.guild, "meepo");
      }

      // Auto-join General voice channel on wake
      await autoJoinGeneralVoice({
        client: interaction.client,
        guildId,
        channelId,
      });

      await interaction.reply({
        content:
          "Meepo awakens.\n" +
          "Bound channel: <#" + inst.channel_id + ">\n" +
          (inst.persona_seed ? ("Persona: " + inst.persona_seed) : "Persona: (none)"),
        ephemeral: true,
      });
      return;
    }

    if (sub === "persona-set") {
      if (!isDm(interaction)) {
        await interaction.reply({ content: "Only the DM can switch persona.", ephemeral: true });
        return;
      }
      const personaId = interaction.options.getString("persona", true);

      const persona = getPersona(personaId);
      if (persona.scope === "campaign") {
        const { getActiveSessionId } = await import("../sessions/sessionRuntime.js");
        if (!getActiveSessionId(guildId)) {
          await interaction.reply({
            content: "I don't feel anchored yet—start a session first.",
            ephemeral: true,
          });
          return;
        }
      }

      setActivePersonaId(guildId, personaId);
      if (interaction.guild) {
        await setBotNicknameForPersona(interaction.guild, personaId);
      }
      const ack = persona.switchAckEnter ?? persona.switchAckExit ?? (personaId === "meta_meepo" ? "Okay—back to companion mode." : "Okay—going in-character.");
      await interaction.reply({
        content: ack,
        ephemeral: true,
      });
      return;
    }

    if (sub === "guild-config") {
      if (!isDm(interaction)) {
        await interaction.reply({ content: "Only the DM can change guild config.", ephemeral: true });
        return;
      }
      const key = interaction.options.getString("key", true);
      const value = interaction.options.getString("value", true).trim();
      if (key === "default-persona") {
        const valid = ["meta_meepo", "diegetic_meepo", "rei", "xoblob"];
        if (!valid.includes(value)) {
          await interaction.reply({
            content: `Invalid persona. Use one of: ${valid.join(", ")}`,
            ephemeral: true,
          });
          return;
        }
        setGuildDefaultPersonaId(guildId, value);
        await interaction.reply({
          content: `Default persona set to **${value}**. Future /meepo wake will use this.`,
          ephemeral: true,
        });
        return;
      }
      if (key === "campaign-slug") {
        setGuildCampaignSlug(guildId, value);
        await interaction.reply({
          content: `Campaign slug set to **${value}**. Registry folder: \`data/registry/${value}/\`.`,
          ephemeral: true,
        });
        return;
      }
      await interaction.reply({ content: "Unknown config key.", ephemeral: true });
      return;
    }

    if (sub === "debug-persona") {
      if (!isDm(interaction)) {
        await interaction.reply({ content: "Only the DM can use debug-persona.", ephemeral: true });
        return;
      }
      const personaId = getActivePersonaId(guildId);
      const mindspace = getMindspace(guildId, personaId);
      const campaignSlug = resolveCampaignSlug({
        guildId,
        guildName: interaction.guild?.name ?? undefined,
      });
      const db = getDb();
      const lastUsages = db.prepare(`
        SELECT persona_id, mindspace, used_memories
        FROM meep_usages
        WHERE guild_id = ?
        ORDER BY triggered_at_ms DESC
        LIMIT 5
      `).all(guildId) as { persona_id: string | null; mindspace: string | null; used_memories: string | null }[];
      const refsPreview = lastUsages.map((u, i) => {
        const refs = u.used_memories ? (JSON.parse(u.used_memories) as string[]) : [];
        return `#${i + 1} persona=${u.persona_id ?? "n/a"} mindspace=${u.mindspace ?? "n/a"} refs=[${refs.slice(0, 3).join(", ")}${refs.length > 3 ? "…" : ""}]`;
      }).join("\n");
      await interaction.reply({
        content:
          "**Debug Persona**\n" +
          "- active_persona_id: " + personaId + "\n" +
          "- mindspace: " + (mindspace ?? "(no session)") + "\n" +
          "- campaign_slug: " + campaignSlug + "\n" +
          "- last 5 meep_usages:\n" + (refsPreview || "(none)"),
        ephemeral: true,
      });
      return;
    }

    if (sub === "sleep") {
      const active = getActiveMeepo(guildId);
      if (active) {
        // Log system event (narrative secondary - state change)
        logSystemEvent({
          guildId,
          channelId: active.channel_id,
          eventType: "npc_sleep",
          content: "Meepo goes dormant.",
          authorId: interaction.user.id,
          authorName: interaction.user.username,
          narrativeWeight: "secondary",
        });
      }

      const changes = sleepMeepo(guildId);

      await interaction.reply({
        content: changes > 0 ? "Meepo goes dormant." : "Meepo is already asleep.",
        ephemeral: true,
      });

      // Reset nickname to default Meepo after replying (to avoid interaction timeout)
      if (interaction.guild) {
        setBotNicknameForPersona(interaction.guild, "meepo").catch(err => 
          console.warn("Failed to reset nickname on sleep:", err.message)
        );
      }

      return;
    }

    if (sub === "status") {
      const inst = getActiveMeepo(guildId);
      if (!inst) {
        await interaction.reply({ content: "Meepo is asleep. Use /meepo wake in the channel you want.", ephemeral: true });
        return;
      }

      const activePersonaId = getActivePersonaId(guildId);
      const mindspace = getMindspace(guildId, activePersonaId);
      const persona = getPersona(activePersonaId);
      await interaction.reply({
        content:
          "Meepo status:\n" +
          "- awake: yes\n" +
          "- bound channel: <#" + inst.channel_id + ">\n" +
          "- active persona: " + persona.displayName + " (" + activePersonaId + ")\n" +
          "- mindspace: " + (mindspace ?? "(no session)") + "\n" +
          "- form (cosmetic): " + inst.form_id + "\n" +
          "- persona seed: " + (inst.persona_seed ?? "(none)") + "\n" +
          "- created_at_ms: " + inst.created_at_ms,
        ephemeral: true,
      });
      return;
    }

    if (sub === "transform") {
      const character = interaction.options.getString("character", true);
      
      const active = getActiveMeepo(guildId);
      if (!active) {
        await interaction.reply({ content: "Meepo is asleep. Use /meepo wake first.", ephemeral: true });
        return;
      }

      try {
        const persona = getPersona(character); // Validate form exists
        const result = transformMeepo(guildId, character);

        if (!result.success) {
          await interaction.reply({ content: result.error ?? "Transform failed.", ephemeral: true });
          return;
        }

        const personaIdForForm = character === "xoblob" ? "xoblob" : "diegetic_meepo";
        setActivePersonaId(guildId, personaIdForForm);

        // Log system event (narrative primary)
        logSystemEvent({
          guildId,
          channelId: active.channel_id,
          eventType: "npc_transform",
          content: `Meepo transforms into ${persona.displayName}.`,
          authorId: interaction.user.id,
          authorName: interaction.user.username,
        });

        // Update bot nickname to match persona
        if (interaction.guild) {
          await setBotNicknameForPersona(interaction.guild, character);
        }

        const deprecationNote = " *(Use /meepo persona-set to switch personas.)*";
        if (character === "meepo") {
          await interaction.reply({
            content: "Meepo shimmers... and returns to itself." + deprecationNote,
            ephemeral: true,
          });
        } else if (character === "xoblob") {
          await interaction.reply({
            content: "Meepo curls up... and becomes an echo of Old Xoblob." + deprecationNote,
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content: `Meepo transforms into ${persona.displayName}.` + deprecationNote,
            ephemeral: true,
          });
        }
      } catch (err: any) {
        await interaction.reply({ content: "Unknown character form: " + character, ephemeral: true });
      }
      return;
    }

    if (sub === "join") {
      // Require Meepo to be awake before joining voice
      const active = getActiveMeepo(guildId);
      if (!active) {
        await interaction.reply({
          content: "Meepo is asleep. Use /meepo wake first.",
          ephemeral: true,
        });
        return;
      }

      // Check if user is in a voice channel
      // Fetch fresh member data to avoid cache issues
      const guild = interaction.guild;
      if (!guild) {
        await interaction.reply({
          content: "This command only works in a server.",
          ephemeral: true,
        });
        return;
      }

      const member = await guild.members.fetch(interaction.user.id);
      const userVoiceChannel = member.voice.channel;

      if (!userVoiceChannel) {
        await interaction.reply({
          content: "Meep? Meepo can't find you! Join a voice channel first, friend!",
          ephemeral: true,
        });
        return;
      }

      // Check if already connected
      const currentState = getVoiceState(guildId);
      if (currentState) {
        if (currentState.channelId === userVoiceChannel.id) {
          await interaction.reply({
            content: "Meep! Meepo is already here with you!",
            ephemeral: true,
          });
          return;
        } else {
          await interaction.reply({
            content: `Meepo is already listening in <#${currentState.channelId}>! Ask Meepo to leave first, meep?`,
            ephemeral: true,
          });
          return;
        }
      }

      // Join voice channel
      // Defer reply immediately to prevent timeout
      await interaction.deferReply({ ephemeral: true });

      try {
        const connection = await joinVoice({
          guildId,
          channelId: userVoiceChannel.id,
          adapterCreator: guild.voiceAdapterCreator,
        });

        // Store state
        setVoiceState(guildId, {
          channelId: userVoiceChannel.id,
          connection,
          guild,  // Store guild reference for member lookups
          sttEnabled: true, // Always enabled when Meepo joins voice
          connectedAt: Date.now(),
        });

        // Start receiver for STT
        startReceiver(guildId);

        // Set Meepo's overlay presence
        overlayEmitPresence("meepo", true);
        console.log(`[Overlay] Set Meepo presence on manual join`);

        // Log system event (narrative secondary - state change)
        logSystemEvent({
          guildId,
          channelId: active.channel_id,
          eventType: "voice_join",
          content: `Meepo joins voice channel: ${userVoiceChannel.name}`,
          authorId: interaction.user.id,
          authorName: interaction.user.username,
          narrativeWeight: "secondary",
        });

        // Resolve deferred interaction with success message
        await interaction.editReply({
          content: `*poof!* Meepo is here! Listening in <#${userVoiceChannel.id}>! Meep meep! 🎧`,
        }).catch((editErr: any) => {
          console.error("[Voice] Failed to edit reply after join:", editErr);
        });
      } catch (err: any) {
        console.error("[Voice] Failed to join:", err);
        
        // Ensure interaction is resolved even if join failed
        await interaction.editReply({
          content: `Meep meep... Meepo couldn't get there! (${err.message})`,
        }).catch((editErr: any) => {
          console.error("[Voice] Failed to edit reply after error:", editErr);
        });
      }
      return;
    }

    if (sub === "leave") {
      const currentState = getVoiceState(guildId);
      if (!currentState) {
        await interaction.reply({
          content: "Meep? Meepo isn't in voice right now!",
          ephemeral: true,
        });
        return;
      }

      const channelId = currentState.channelId;
      
      // Stop receiver if active
      stopReceiver(guildId);
      
      leaveVoice(guildId);

      // Log system event (narrative secondary - state change)
      const active = getActiveMeepo(guildId);
      if (active) {
        logSystemEvent({
          guildId,
          channelId: active.channel_id,
          eventType: "voice_leave",
          content: "Meepo leaves voice channel.",
          authorId: interaction.user.id,
          authorName: interaction.user.username,
          narrativeWeight: "secondary",
        });
      }

      await interaction.reply({
        content: `*poof!* Meepo leaves <#${channelId}>. Bye bye! Meep!`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "stt") {
      const action = interaction.options.getString("action", true);
      const currentState = getVoiceState(guildId);

      if (!currentState) {
        await interaction.reply({
          content: "Meep? Meepo needs to join voice first!",
          ephemeral: true,
        });
        return;
      }

      if (action === "status") {
        const active = getActiveMeepo(guildId);
        await interaction.reply({
          content:
            "**Meepo's Voice Status** 🎧\n" +
            `- Listening in: <#${currentState.channelId}>\n` +
            `- Understanding words: yes! ✨ (always on)\n` +
            `- Since: ${new Date(currentState.connectedAt).toLocaleString()}\n` +
            `\n_Meep! (Meepo forgets this if bot restarts)_`,
          ephemeral: true,
        });
        return;
      }

      if (action === "on") {
        await interaction.reply({
          content: "✨ STT is always enabled when Meepo is in voice! No need to toggle.",
          ephemeral: true,
        });
        return;
      }

      if (action === "off") {
        await interaction.reply({
          content: "⚠️ STT is always enabled when Meepo is in voice. Use `/meepo leave` to stop listening.",
          ephemeral: true,
        });
        return;
      }

      return;
    }

    if (sub === "say") {
      // DM-only enforcement
      const dmRoleId = process.env.DM_ROLE_ID;
      if (dmRoleId) {
        const member = interaction.member;
        const hasDmRole = member?.roles?.cache?.has(dmRoleId) ?? false;
        if (!hasDmRole) {
          await interaction.reply({ content: "This command is DM-only.", ephemeral: true });
          return;
        }
      }

      // Preconditions
      const active = getActiveMeepo(guildId);
      if (!active) {
        await interaction.reply({ content: "Meepo is asleep. Use /meepo wake first.", ephemeral: true });
        return;
      }

      const voiceState = getVoiceState(guildId);
      if (!voiceState) {
        await interaction.reply({ content: "Meepo is not in a voice channel. Use /meepo join first.", ephemeral: true });
        return;
      }

      const ttsEnabled = (process.env.TTS_ENABLED ?? "true").toLowerCase() !== "false";
      if (!ttsEnabled) {
        await interaction.reply({ content: "TTS is not enabled (TTS_ENABLED=false).", ephemeral: true });
        return;
      }

      const text = interaction.options.getString("text", true).trim();
      if (!text) {
        await interaction.reply({ content: "Text cannot be empty.", ephemeral: true });
        return;
      }

      // Acknowledge immediately
      await interaction.deferReply({ ephemeral: true });

      try {
        const replyMode = active.reply_mode; // Check active Meepo's reply mode

        if (replyMode === "text") {
          // Send as text message instead of voice
          const channel = interaction.channel;
          if (channel?.isTextBased()) {
            const reply = await channel.send(text);
            
            // Log bot's reply to ledger
            appendLedgerEntry({
              guild_id: guildId,
              channel_id: active.channel_id,
              message_id: reply.id,
              author_id: interaction.client.user.id,
              author_name: interaction.client.user.username,
              timestamp_ms: reply.createdTimestamp,
              content: text,
              tags: "npc,meepo,spoken",
            });

            await interaction.editReply({ content: `Sent as text (reply mode is text): "${text.substring(0, 100)}${text.length > 100 ? "..." : ""}"` });
          } else {
            await interaction.editReply({ content: "Cannot send text message in this channel." });
          }
          return;
        }

        // Voice reply enabled - use TTS
        // Get TTS provider
        const ttsProvider = await getTtsProvider();

        // Synthesize text to audio
        let mp3Buffer = await ttsProvider.synthesize(text);

        if (mp3Buffer.length === 0) {
          await interaction.editReply({ content: "TTS synthesis returned empty audio. Check provider configuration." });
          return;
        }

        // Apply post-TTS audio effects (if enabled)
        mp3Buffer = await applyPostTtsFx(mp3Buffer, "mp3");

        // Queue playback
        speakInGuild(guildId, mp3Buffer, {
          userDisplayName: "[/meepo say]",
        });

        // Log system event (tags: system,tts_say)
        logSystemEvent({
          guildId,
          channelId: active.channel_id,
          eventType: "tts_say",
          content: text,
          authorId: interaction.user.id,
          authorName: interaction.user.username,
        });

        await interaction.editReply({ content: `Speaking: "${text.substring(0, 100)}${text.length > 100 ? "..." : ""}"` });
      } catch (err: any) {
        console.error("[TTS] /meepo say error:", err);
        await interaction.editReply({ content: `TTS error: ${err.message}` });
      }
      return;
    }

    if (sub === "set-speaker-mask") {
      // DM-only command
      const dmRoleId = process.env.DM_ROLE_ID;
      if (dmRoleId) {
        const member = interaction.member;
        if (!member?.roles?.cache?.has(dmRoleId)) {
          await interaction.reply({ content: "This command is DM-only.", ephemeral: true });
          return;
        }
      }

      const user = interaction.options.getUser("user");
      const mask = interaction.options.getString("mask");

      if (!user || !mask) {
        await interaction.reply({ content: "Missing user or mask parameter.", ephemeral: true });
        return;
      }

      const db = getDb();
      const now = Date.now();

      // Upsert speaker mask
      db.prepare(`
        INSERT INTO speaker_masks (guild_id, discord_user_id, speaker_mask, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, discord_user_id) DO UPDATE SET
          speaker_mask = excluded.speaker_mask,
          updated_at_ms = excluded.updated_at_ms
      `).run(guildId, user.id, mask, now, now);

      await interaction.reply({
        content: `Speaker mask set: ${user.username} → "${mask}"`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "clear-speaker-mask") {
      // DM-only command
      const dmRoleId = process.env.DM_ROLE_ID;
      if (dmRoleId) {
        const member = interaction.member;
        if (!member?.roles?.cache?.has(dmRoleId)) {
          await interaction.reply({ content: "This command is DM-only.", ephemeral: true });
          return;
        }
      }

      const user = interaction.options.getUser("user");

      if (!user) {
        await interaction.reply({ content: "Missing user parameter.", ephemeral: true });
        return;
      }

      const db = getDb();
      const result = db.prepare(`
        DELETE FROM speaker_masks
        WHERE guild_id = ? AND discord_user_id = ?
      `).run(guildId, user.id);

      if (result.changes > 0) {
        await interaction.reply({
          content: `Speaker mask cleared for ${user.username}`,
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: `No speaker mask found for ${user.username}`,
          ephemeral: true,
        });
      }
      return;
    }

    if (sub === "reply") {
      const active = getActiveMeepo(guildId);
      if (!active) {
        await interaction.reply({ content: "Meep! Meepo is asleep. Use `/meepo wake` first.", ephemeral: true });
        return;
      }

      const mode = interaction.options.getString("mode", true) as "voice" | "text";

      const db = getDb();
      db.prepare(`
        UPDATE npc_instances
        SET reply_mode = ?
        WHERE guild_id = ? AND is_active = 1
      `).run(mode, guildId);

      await interaction.reply({
        content: `Meepo reply mode set to: **${mode}**`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "announce") {
      // DM check
      const dmRoleId = process.env.DM_ROLE_ID;
      if (!dmRoleId || !interaction.member?.roles?.cache?.has(dmRoleId)) {
        await interaction.reply({
          content: "[DM-only] This command requires the DM role.",
          ephemeral: true,
        });
        return;
      }

      // Get env-configured announcement channel
      const channelId = process.env.ANNOUNCEMENT_CHANNEL_ID;
      if (!channelId) {
        await interaction.reply({
          content: "Announcement channel not configured. Ask the admin to set `ANNOUNCEMENT_CHANNEL_ID`.",
          ephemeral: true,
        });
        return;
      }

      // Get parameters
      const override_ts = interaction.options.getInteger("timestamp");
      const override_label = interaction.options.getString("label");
      const override_message = interaction.options.getString("message");
      const dry_run = interaction.options.getBoolean("dry_run") ?? false;

      // Compute timestamp
      const ts = override_ts ?? getTodayAtNinePmEtUnixSeconds();

      // Compute label (auto-increment next episode number)
      const label = override_label ?? getNextSessionLabel();

      // Compute message
      const messagePrefix = override_message ?? "Reminder that our D&D session";
      const finalMessage = `**@everyone ${messagePrefix} begins <t:${ts}:R> (${label}).**`;

      if (dry_run) {
        meepoLog.info(`[DRY RUN] Announcement preview: ${finalMessage}`);
        await interaction.reply({
          content: `**[DRY RUN] Preview:**\n${finalMessage}`,
          ephemeral: true,
        });
        return;
      }

      // Resolve channel
      try {
        const channel = await interaction.guild?.channels.fetch(channelId);
        if (!channel || !(channel instanceof TextChannel)) {
          await interaction.reply({
            content: "Announcement channel is not a text channel or not found.",
            ephemeral: true,
          });
          return;
        }

        // Post to channel
        await channel.send(finalMessage);
        meepoLog.info(`Announcement posted: ${label} at <t:${ts}:R>`);

        await interaction.reply({
          content: `✅ Announced: **${label}** begins <t:${ts}:R>.`,
          ephemeral: true,
        });
      } catch (err: any) {
        meepoLog.warn(`Failed to post announcement: ${err.message ?? err}`);
        await interaction.reply({
          content: `Error posting announcement: ${err.message ?? "Unknown error"}`,
          ephemeral: true,
        });
      }
      return;
    }

    await interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
  },
};
