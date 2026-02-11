import { SlashCommandBuilder, AttachmentBuilder } from "discord.js";
import { getActiveSession, getLatestIngestedSession } from "../sessions/sessions.js";
import { getLedgerInRange, getLedgerForSession } from "../ledger/ledger.js";
import type { LedgerEntry } from "../ledger/ledger.js";
import { chat } from "../llm/client.js";
import { generateMeecapStub } from "../sessions/meecap.js";
import { getDb } from "../db.js";

/**
 * Shared ledger slice logic for both transcript and recap commands
 */
function getLedgerSlice(opts: { 
  guildId: string; 
  range: string;
  primaryOnly?: boolean;
}): LedgerEntry[] | { error: string } {
  const { guildId, range, primaryOnly } = opts;
  const now = Date.now();
  let entries: LedgerEntry[] | null = null;

  if (range === "since_start") {
    const activeSession = getActiveSession(guildId);
    if (!activeSession) {
      return { error: "No active session found. Use /meepo wake to start one." };
    }
    entries = getLedgerInRange({ guildId, startMs: activeSession.started_at_ms, endMs: now, primaryOnly });
  } else if (range === "recording") {
    const ingestedSession = getLatestIngestedSession(guildId);
    if (!ingestedSession) {
      return { error: "No ingested recording sessions found. Use the ingestion tool first." };
    }
    // Query by session_id for bulletproof slicing (no time-window ambiguity)
    entries = getLedgerForSession({ sessionId: ingestedSession.session_id, primaryOnly });
  } else if (range === "last_5h") {
    entries = getLedgerInRange({ guildId, startMs: now - 5 * 60 * 60 * 1000, endMs: now, primaryOnly });
  } else if (range === "today") {
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    entries = getLedgerInRange({ guildId, startMs: todayUtc.getTime(), endMs: now, primaryOnly });
  } else {
    return { error: "Unknown range." };
  }

  if (!entries || entries.length === 0) {
    return { error: `No ledger entries found for range: ${range}` };
  }

  return entries;
}

export const session = {
  data: new SlashCommandBuilder()
    .setName("session")
    .setDescription("Manage D&D sessions (DM-only).")
    .addSubcommand((sub) =>
      sub
        .setName("transcript")
        .setDescription("Display session transcript from ledger.")
        .addStringOption((opt) =>
          opt
            .setName("range")
            .setDescription("Time range for transcript")
            .setRequired(true)
            .addChoices(
              { name: "Since session start", value: "since_start" },
              { name: "Last 5 hours", value: "last_5h" },
              { name: "Today (UTC)", value: "today" },
              { name: "Latest ingested recording", value: "recording" }
            )
        )
        .addBooleanOption((opt) =>
          opt
            .setName("primary")
            .setDescription("Show only primary narrative (voice + elevated text). Default: show all.")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("recap")
        .setDescription("Generate session recap summary from ledger.")
        .addStringOption((opt) =>
          opt
            .setName("range")
            .setDescription("Time range for recap")
            .setRequired(true)
            .addChoices(
              { name: "Since session start", value: "since_start" },
              { name: "Last 5 hours", value: "last_5h" },
              { name: "Today (UTC)", value: "today" },
              { name: "Latest ingested recording", value: "recording" }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName("mode")
            .setDescription("Output format: primary, full, or meecap (scenes + beats).")
            .setRequired(false)
            .addChoices(
              { name: "primary", value: "primary" },
              { name: "full", value: "full" },
              { name: "meecap", value: "meecap" }
            )
        )
    ),

  async execute(interaction: any) {
    const guildId = interaction.guildId as string | null;

    if (!guildId) {
      await interaction.reply({ content: "Sessions only work in a server (not DMs).", ephemeral: true });
      return;
    }

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

    const sub = interaction.options.getSubcommand();

    if (sub === "transcript") {
      const range = interaction.options.getString("range", true);
      const primaryOnly = interaction.options.getBoolean("primary") ?? false;
      
      const result = getLedgerSlice({ guildId, range, primaryOnly });

      if ("error" in result) {
        await interaction.reply({ content: result.error, ephemeral: true });
        return;
      }

      // Format with source and narrative_weight for debugging
      let transcript = result
        .map((e) => {
          const t = new Date(e.timestamp_ms).toISOString();
          const meta = `(${e.source}/${e.narrative_weight})`;
          return `[${t}] ${meta} ${e.author_name}: ${e.content}`;
        })
        .join("\n");

      const mode = primaryOnly ? "primary" : "full";
      const header = `**Session transcript (${range}, mode: ${mode}):**\n`;

      // Discord has a 2000 character limit per message
      // If transcript is too long, send as file attachment instead
      const maxMessageLength = 1900;

      if (transcript.length > maxMessageLength) {
        // Send as file attachment
        const buffer = Buffer.from(transcript, 'utf-8');
        const attachment = new AttachmentBuilder(buffer, { 
          name: `session-transcript-${range}-${Date.now()}.txt` 
        });
        
        await interaction.reply({
          content: `${header}(Transcript was too long for Discord, attached as file)`,
          files: [attachment],
          ephemeral: true,
        });
      } else {
        // Send as normal message
        await interaction.reply({
          content: `${header}\`\`\`\n${transcript}\n\`\`\``,
          ephemeral: true,
        });
      }
      return;
    }

    if (sub === "recap") {
      const range = interaction.options.getString("range", true);
      const mode = interaction.options.getString("mode") ?? "primary";
      
      // Determine primaryOnly based on mode
      const primaryOnly = mode === "primary"; // primary = primary only, full/meecap = include all
      
      const result = getLedgerSlice({ guildId, range, primaryOnly });

      if ("error" in result) {
        await interaction.reply({ content: result.error, ephemeral: true });
        return;
      }

      // Defer reply since LLM summarization may take time
      await interaction.deferReply({ ephemeral: true });

      // Build transcript for summarization (raw)
      const transcript = result
        .map((e) => {
          const t = new Date(e.timestamp_ms).toISOString();
          return `[${t}] ${e.author_name}: ${e.content}`;
        })
        .join("\n");

      // Build normalized transcript if available (Phase 1C)
      const transcriptNorm = result
        .map((e) => {
          const t = new Date(e.timestamp_ms).toISOString();
          const content = e.content_norm ?? e.content;
          return `[${t}] ${e.author_name}: ${content}`;
        })
        .join("\n");

      // Handle meecap mode first (different code path)
      if (mode === "meecap") {
        const activeSession = getActiveSession(guildId);
        const sessionId = activeSession?.session_id ?? `adhoc_${Date.now()}`;

        try {
          const meecapResult = await generateMeecapStub({
            sessionId,
            transcript,
            transcriptNorm,
          });

          // Persist to database if meecap was generated
          if (meecapResult.meecap) {
            const db = getDb();
            const now = Date.now();
            
            db.prepare(`
              INSERT INTO meecaps (session_id, meecap_json, created_at_ms, updated_at_ms)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(session_id) DO UPDATE SET
                meecap_json = excluded.meecap_json,
                updated_at_ms = excluded.updated_at_ms
            `).run(
              sessionId,
              JSON.stringify(meecapResult.meecap),
              now,
              now
            );
          }

          await interaction.editReply({ content: meecapResult.text });
          return;
        } catch (err: any) {
          console.error("Meecap generation error:", err);
          await interaction.editReply({
            content: "Failed to generate meecap. Error: " + (err.message ?? "Unknown"),
          });
          return;
        }
      }

      // For summary and narrative modes, use LLM summarization
      const systemPrompt = `You are a D&D session recorder for the DM. You will be given a session transcript (raw dialogue and events). Produce a structured DM recap that is detailed, skimmable, and strictly grounded in the transcript.

HARD RULES (DO NOT VIOLATE):
- Use ONLY information explicitly present in the transcript. Do NOT invent names, places, items, outcomes, motivations, or connections.
- If something is unclear, conflicting, or implied but not confirmed, label it as "Unclear:" or "Not confirmed:" rather than guessing.
- Do not add rules adjudication or "what should have happened"—only what the transcript indicates did happen.
- Do not include filler, jokes, or meta commentary.
- When possible, include a brief quote fragment (3–10 words) in quotation marks to anchor major beats (max 6 anchors total). Do not paste long quotes.

OUTPUT FORMAT (use these headings exactly):
## Overview
(3–6 sentences summarizing the session at a high level. End with: "Notable participants: ...")

## Chronological Beats
- (Bullet list of the major moments in order. Prefer 8–20 bullets depending on transcript length.)
- Each bullet should be a concrete event or decision.

## NPCs & Factions
- **NPC/Faction Name** — What they did / what was said / relationship changes (only if in transcript)

## Player Decisions & Consequences
- **Decision** — Immediate result / consequence (or "Unclear" if outcome not shown)

## Conflicts & Resolutions
- Summarize combats, chases, arguments, negotiations, or other conflicts.
- Include outcomes and any notable costs (HP drops, resources spent, captures, escapes) ONLY if explicitly stated.

## Clues, Loot, & Lore
- List discoveries, items, passwords, locations, reveals, or lore drops (only if mentioned).

## Open Threads / To Follow Up
- Bullets of unresolved questions, leads, promises, threats, or timers that appear in the transcript.

STYLE:
- Be precise and information-dense.
- Prefer specifics (names, places, actions) over generalities, but never guess.
- Keep total length roughly 300–900 words unless the transcript is extremely short.`;

      const userMessage = `Transcript:\n${transcript}`;

      try {
        const summary = await chat({
          systemPrompt,
          userMessage,
          maxTokens: 8000, // Allow longer output for summaries
        });

        // Discord has a 2000 character limit per message
        // If summary is too long, send as file attachment instead
        const maxMessageLength = 1950;
        
        const modeLabel = mode === "primary" ? "primary" : "full";
        const modeHeader = `**Session recap (${range}, mode: ${modeLabel}):**\n`;
        
        if (summary.length > maxMessageLength) {
          // Send as file attachment
          const buffer = Buffer.from(summary, 'utf-8');
          const attachment = new AttachmentBuilder(buffer, { 
            name: `session-recap-${range}-${Date.now()}.md` 
          });
          
          await interaction.editReply({
            content: `${modeHeader}(Summary was too long for Discord, attached as file)`,
            files: [attachment],
          });
        } else {
          // Send as normal message
          await interaction.editReply({
            content: `${modeHeader}${summary}`,
          });
        }
      } catch (err: any) {
        console.error("LLM recap error:", err);
        await interaction.editReply({
          content: "Failed to generate recap summary. LLM unavailable.",
        });
      }
      return;
    }

    await interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
  },
};
