import { SlashCommandBuilder, AttachmentBuilder } from "discord.js";
import { getActiveSession, getLatestIngestedSession, getLatestSessionForLabel } from "../sessions/sessions.js";
import { getLedgerInRange, getLedgerForSession } from "../ledger/ledger.js";
import type { LedgerEntry } from "../ledger/ledger.js";
import { chat } from "../llm/client.js";
import { generateMeecapStub, validateMeecapV1 } from "../sessions/meecap.js";
import { getDb } from "../db.js";
import path from "path";
import fs from "fs";

/**
 * Shared ledger slice logic for both transcript and recap commands
 */
function getLedgerSlice(opts: { 
  guildId: string; 
  range: string;
  primaryOnly?: boolean;
  sessionLabel?: string | null;  // Optional: filter "recording" range by label
}): LedgerEntry[] | { error: string } {
  const { guildId, range, primaryOnly, sessionLabel } = opts;
  const now = Date.now();
  let entries: LedgerEntry[] | null = null;

  if (range === "since_start") {
    const activeSession = getActiveSession(guildId);
    if (!activeSession) {
      return { error: "No active session found. Use /meepo wake to start one." };
    }
    entries = getLedgerInRange({ guildId, startMs: activeSession.started_at_ms, endMs: now, primaryOnly });
  } else if (range === "recording") {
    let ingestedSession;
    
    if (sessionLabel) {
      // If label provided, use latest session with that label
      ingestedSession = getLatestSessionForLabel(sessionLabel);
      if (!ingestedSession) {
        return { error: `No sessions found with label: ${sessionLabel}` };
      }
    } else {
      // Otherwise, use latest ingested overall
      ingestedSession = getLatestIngestedSession(guildId);
      if (!ingestedSession) {
        return { error: "No ingested recording sessions found. Use the ingestion tool first." };
      }
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
            .setName("style")
            .setDescription("Recap style: dm, narrative (meecap-driven), or party")
            .setRequired(false)
            .addChoices(
              { name: "DM recap", value: "dm" },
              { name: "Narrative (meecap-driven)", value: "narrative" },
              { name: "Party recap", value: "party" }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName("source")
            .setDescription("Ledger entries to include: primary (voice-focused) or full (all)")
            .setRequired(false)
            .addChoices(
              { name: "Primary (voice-focused)", value: "primary" },
              { name: "Full (all entries)", value: "full" }
            )
        )
        .addBooleanOption((opt) =>
          opt
            .setName("force_meecap")
            .setDescription("Regenerate meecap before rendering. Use with narrative/dm styles.")
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName("label")
            .setDescription("Episode label filter (e.g., C2E01). Optional; uses latest ingested if omitted.")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("meecap")
        .setDescription("Generate or regenerate session Meecap (structured scenes + beats).")
        .addBooleanOption((opt) =>
          opt
            .setName("force")
            .setDescription("Regenerate even if meecap already exists. Default: false")
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName("source")
            .setDescription("Ledger entries to include: primary (voice-focused) or full (all)")
            .setRequired(false)
            .addChoices(
              { name: "Primary (voice-focused)", value: "primary" },
              { name: "Full (all entries)", value: "full" }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName("label")
            .setDescription("Episode label filter (e.g., C2E01). Optional; uses latest ingested if omitted.")
            .setRequired(false)
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
      const style = interaction.options.getString("style") ?? "dm";
      const source = interaction.options.getString("source") ?? "primary";
      const label = interaction.options.getString("label") ?? null;
      const forceMeecap = interaction.options.getBoolean("force_meecap") ?? false;
      
      // Determine primaryOnly based on source
      const primaryOnly = source === "primary";
      
      const result = getLedgerSlice({ guildId, range, primaryOnly, sessionLabel: label });

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

      // Handle narrative style (meecap-driven)
      if (style === "narrative") {
        const activeSession = getActiveSession(guildId);
        const sessionId = activeSession?.session_id ?? `adhoc_${Date.now()}`;

        let meecap: any;
        const meecapMode = process.env.MEE_CAP_MODE ?? "narrative";

        // If force_meecap is true, generate a fresh meecap
        if (forceMeecap) {
          try {
            const meecapResult = await generateMeecapStub({
              sessionId,
              entries: result,
            });
            
            if (!meecapResult.text || (!meecapResult.meecap && !meecapResult.narrative)) {
              await interaction.editReply({
                content: "Failed to generate meecap: " + meecapResult.text,
              });
              return;
            }

            // Handle based on mode
            if (meecapMode === "narrative") {
              // Narrative mode: persist prose
              if (!meecapResult.narrative) {
                await interaction.editReply({
                  content: "Failed to generate narrative: " + meecapResult.text,
                });
                return;
              }

              const db = getDb();
              const now = Date.now();
              db.prepare(`
                INSERT INTO meecaps (session_id, meecap_json, meecap_narrative, model, created_at_ms, updated_at_ms)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                  meecap_json = excluded.meecap_json,
                  meecap_narrative = excluded.meecap_narrative,
                  model = excluded.model,
                  updated_at_ms = excluded.updated_at_ms
              `).run(
                sessionId,
                null,
                meecapResult.narrative,
                "claude-opus", // TODO: Extract actual model from chat response
                now,
                now
              );

              // For narrative mode, meecap is null (prose is the artifact)
              meecap = null;
            } else {
              // V1 JSON mode: validate and persist JSON
              if (!meecapResult.meecap) {
                await interaction.editReply({
                  content: "Failed to generate meecap: " + meecapResult.text,
                });
                return;
              }

              const validationErrors = validateMeecapV1(meecapResult.meecap, result);
              if (validationErrors.length > 0) {
                const errorSummary = validationErrors
                  .map((e) => `- ${e.field}: ${e.message}`)
                  .join("\n");
                await interaction.editReply({
                  content: `Meecap validation failed:\n\`\`\`\n${errorSummary}\n\`\`\``,
                });
                return;
              }

              const db = getDb();
              const now = Date.now();
              db.prepare(`
                INSERT INTO meecaps (session_id, meecap_json, meecap_narrative, model, created_at_ms, updated_at_ms)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                  meecap_json = excluded.meecap_json,
                  meecap_narrative = excluded.meecap_narrative,
                  model = excluded.model,
                  updated_at_ms = excluded.updated_at_ms
              `).run(
                sessionId,
                JSON.stringify(meecapResult.meecap),
                null,
                "claude-opus", // TODO: Extract actual model from chat response
                now,
                now
              );

              meecap = meecapResult.meecap;
            }

            // Send success response
            await interaction.editReply({
              content: meecapResult.text,
            });
          } catch (err: any) {
            console.error("Failed to regenerate meecap with --force_meecap:", err);
            await interaction.editReply({
              content: "Failed to regenerate meecap: " + (err.message ?? "Unknown error"),
            });
            return;
          }
        } else {
          // Load existing meecap from database
          const db = getDb();
          const meecapRow = db
            .prepare("SELECT meecap_json, meecap_narrative FROM meecaps WHERE session_id = ?")
            .get(sessionId) as { meecap_json?: string; meecap_narrative?: string } | undefined;
          
          if (!meecapRow || (!meecapRow.meecap_json && !meecapRow.meecap_narrative)) {
            await interaction.editReply({
              content: "❯ No meecap found for this session. Run `/session meecap` first, or use `--force_meecap` to regenerate.",
            });
            return;
          }

          try {
            if (meecapRow.meecap_json) {
              meecap = JSON.parse(meecapRow.meecap_json);
            } else if (meecapRow.meecap_narrative) {
              // In narrative mode, meecap is null; prose is stored separately
              meecap = null;
            }
          } catch (err: any) {
            console.error("Failed to parse meecap JSON:", err);
            await interaction.editReply({
              content: "Failed to load meecap. It may be corrupted.",
            });
            return;
          }
        }

        try {
          // Handle narrative mode vs. V1 mode
          if (meecapMode === "narrative") {
            // In narrative mode, we already have the prose narrative stored
            // Load and return it directly
            const db = getDb();
            const narrativeRow = db
              .prepare("SELECT meecap_narrative FROM meecaps WHERE session_id = ?")
              .get(sessionId) as { meecap_narrative?: string } | undefined;

            if (!narrativeRow?.meecap_narrative) {
              await interaction.editReply({
                content: "Narrative meecap not found. Try regenerating with `--force_meecap`.",
              });
              return;
            }

            const narrative = narrativeRow.meecap_narrative;
            const wordCount = narrative.split(/\s+/).length;
            const charCount = narrative.length;

            // Always output as file for consistency and editability
            const filename = `meecap-narrative-${Date.now()}.md`;
            const buffer = Buffer.from(narrative, 'utf-8');
            const attachment = new AttachmentBuilder(buffer, {
              name: filename,
            });
            await interaction.editReply({
              content: `✅ **Meecap Narrative**\n\n📊 **Stats:**\n- Word count: ~${wordCount}\n- Character count: ${charCount}\n\n📄 Narrative attached below (editable in Discord)`,
              files: [attachment],
            });
          } else {
            // V1 mode: build narrative from meecap structure
            if (!meecap || !meecap.scenes) {
              await interaction.editReply({
                content: "Meecap structure not available. Cannot generate recap.",
              });
              return;
            }

            // Build narrative recap using meecap structure + transcript detail
            const systemPrompt = `You are a D&D session recorder for the DM. You will be given:
1. A Meecap (structured scenes with beats and evidence references)
2. A session transcript (detailed conversation)

Produce a narrative recap organized by scene headings from the meecap, but with rich detail from the transcript.

HARD RULES:
- Use ONLY information from the transcript. Do NOT invent.
- Organize narrative by meecap scenes (use scene titles as headings).
- Within each scene, include the beats and supporting dialogue/details.
- Exclude out-of-character/table talk from the recap. Focus only on in-character gameplay events.
- If you are unsure whether something is OOC, omit it.
- Keep between 800-1500 words. Prioritize density over brevity.
- Be narrative and engaging while staying faithful to what happened.

STYLE: Write as a polished session recap for the DM's notes.`;

            const userMessage = `Meecap Structure:
${JSON.stringify(meecap.scenes.map((s: any) => ({
  number: s.number,
  title: s.title,
  beats: s.beats.map((b: any) => ({ title: b.moment }))
})), null, 2)}

Transcript:
${transcript}`;

            try {
              const narrative = await chat({
                systemPrompt,
                userMessage,
                maxTokens: 2500, // ~1500 words max (conservative)
              });

              const maxMessageLength = 1950;
              if (narrative.length > maxMessageLength) {
                const buffer = Buffer.from(narrative, 'utf-8');
                const attachment = new AttachmentBuilder(buffer, {
                  name: `session-recap-narrative-${Date.now()}.md`,
                });
                await interaction.editReply({
                  content: `**Narrative Recap:**\n(Summary was too long for Discord, attached as file)`,
                  files: [attachment],
                });
              } else {
                await interaction.editReply({
                  content: `**Narrative Recap:**\n${narrative}`,
                });
              }
            } catch (err: any) {
              console.error("LLM narrative error:", err);
              await interaction.editReply({
                content: "Failed to generate narrative recap. LLM unavailable.",
              });
            }
          }
        } catch (err: any) {
          console.error("Failed during narrative recap:", err);
          await interaction.editReply({
            content: "Failed to generate recap. " + (err.message ?? "Unknown error"),
          });
        }
        return;
      }

      // For dm and party styles, use LLM summarization
      const systemPrompt = `You are a D&D session recorder for the DM. You will be given a session transcript (raw dialogue and events). Produce a structured DM recap that is detailed, skimmable, and strictly grounded in the transcript.

TARGET: 800-1500 words. Prioritize density and detail.

OUT-OF-CHARACTER EXCLUSION:
Exclude out-of-character/table talk from the recap. Focus only on in-character gameplay events.
If you are unsure whether something is OOC, omit it.

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
          maxTokens: 3000, // ~1500 words max for dm/party
        });

        // Discord has a 2000 character limit per message
        // If summary is too long, send as file attachment instead
        const maxMessageLength = 1950;
        
        const sourceLabel = source === "primary" ? "primary" : "full";
        const styleLabel = style === "dm" ? "DM" : "Party";
        const modeHeader = `**Session recap (${range}, style: ${styleLabel}, source: ${sourceLabel}):**\n`;
        
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

    if (sub === "meecap") {
      const force = interaction.options.getBoolean("force") ?? false;
      const source = interaction.options.getString("source") ?? "primary";
      const label = interaction.options.getString("label") ?? null;
      const primaryOnly = source === "primary";

      // Resolve most recent session
      let session: any = null;
      
      if (label) {
        // If label provided, use latest session with that label
        session = getLatestSessionForLabel(label);
        if (!session) {
          await interaction.reply({
            content: `No sessions found with label: ${label}`,
            ephemeral: true,
          });
          return;
        }
      } else {
        // Otherwise, prefer latest ingested, fallback to active
        const ingestedSession = getLatestIngestedSession(guildId);
        const activeSession = getActiveSession(guildId);
        session = ingestedSession ?? activeSession;
      }
      
      if (!session) {
        await interaction.reply({
          content: "No active or ingested session found. Use /meepo wake to start one, or ingest a recording.",
          ephemeral: true,
        });
        return;
      }

      // Check if meecap already exists (unless --force)
      if (!force) {
        const db = getDb();
        const existing = db
          .prepare("SELECT session_id FROM meecaps WHERE session_id = ?")
          .get(session.session_id);
        
        if (existing) {
          await interaction.reply({
            content: `✅ Meecap already exists for this session. Use \`--force\` to regenerate.`,
            ephemeral: true,
          });
          return;
        }
      }

      // Fetch ledger entries for session
      const entries = getLedgerForSession({ sessionId: session.session_id, primaryOnly });
      if (!entries || entries.length === 0) {
        await interaction.reply({
          content: `No ledger entries found for session ${session.session_id}`,
          ephemeral: true,
        });
        return;
      }

      // Defer reply for LLM work
      await interaction.deferReply({ ephemeral: true });

      try {
        const meecapResult = await generateMeecapStub({
          sessionId: session.session_id,
          entries,
        });

        const meecapMode = process.env.MEE_CAP_MODE ?? "narrative";

        // Handle based on mode
        if (meecapMode === "narrative") {
          // Narrative mode: persist prose
          if (!meecapResult.narrative) {
            await interaction.editReply({
              content: "Failed to generate narrative: " + meecapResult.text,
            });
            return;
          }

          const db = getDb();
          const now = Date.now();
          
          // Check if new narrative columns exist (migration check)
          const columns = db.pragma("table_info(meecaps)") as any[];
          const hasNarrativeCol = columns.some((col: any) => col.name === "meecap_narrative");
          
          if (hasNarrativeCol) {
            // New schema: use narrative columns
            db.prepare(`
              INSERT INTO meecaps (session_id, meecap_json, meecap_narrative, model, created_at_ms, updated_at_ms)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(session_id) DO UPDATE SET
                meecap_json = excluded.meecap_json,
                meecap_narrative = excluded.meecap_narrative,
                model = excluded.model,
                updated_at_ms = excluded.updated_at_ms
            `).run(
              session.session_id,
              null,
              meecapResult.narrative,
              "claude-opus",
              now,
              now
            );
          } else {
            // Old schema fallback: store in meecap_json (narrative mode not supported on old schema)
            await interaction.editReply({
              content: "⚠️ Database schema outdated. Please restart the bot to apply migrations, then try again.",
            });
            return;
          }

          // Export prose to disk
          const meecapsDir = path.join(process.cwd(), "data", "meecaps");
          if (!fs.existsSync(meecapsDir)) {
            fs.mkdirSync(meecapsDir, { recursive: true });
          }
          const meecapFilename = `${session.session_id}__${now}.md`;
          const meecapPath = path.join(meecapsDir, meecapFilename);
          fs.writeFileSync(meecapPath, meecapResult.narrative);

          // Export prose as attachment
          const mdBuffer = Buffer.from(meecapResult.narrative, 'utf-8');
          const attachment = new AttachmentBuilder(mdBuffer, {
            name: `meecap-narrative-${Date.now()}.md`,
          });

          await interaction.editReply({
            content: meecapResult.text,
            files: [attachment],
          });
        } else {
          // V1 JSON mode: validate and persist JSON
          if (!meecapResult.meecap) {
            await interaction.editReply({
              content: "Failed to generate meecap: " + meecapResult.text,
            });
            return;
          }

          const validationErrors = validateMeecapV1(meecapResult.meecap, entries);
          
          if (validationErrors.length > 0) {
            const errorSummary = validationErrors
              .map((e) => `- ${e.field}: ${e.message}`)
              .join("\n");
            console.error("Meecap validation failed:", errorSummary);
            await interaction.editReply({
              content: `❌ Meecap validation failed:\n\`\`\`\n${errorSummary}\n\`\`\``,
            });
            return;
          }

          // Validation passed, persist to database
          const db = getDb();
          const now = Date.now();
          
          db.prepare(`
            INSERT INTO meecaps (session_id, meecap_json, meecap_narrative, model, created_at_ms, updated_at_ms)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
              meecap_json = excluded.meecap_json,
              meecap_narrative = excluded.meecap_narrative,
              model = excluded.model,
              updated_at_ms = excluded.updated_at_ms
          `).run(
            session.session_id,
            JSON.stringify(meecapResult.meecap),
            null,
            "claude-opus", // TODO: Extract actual model from chat response
            now,
            now
          );

          // Export to disk for inspection/diffing
          const meecapsDir = path.join(process.cwd(), "data", "meecaps");
          if (!fs.existsSync(meecapsDir)) {
            fs.mkdirSync(meecapsDir, { recursive: true });
          }
          const meecapFilename = `${session.session_id}__${now}.json`;
          const meecapPath = path.join(meecapsDir, meecapFilename);
          fs.writeFileSync(meecapPath, JSON.stringify(meecapResult.meecap, null, 2));

          // Also write latest.json for quick diffing
          const latestPath = path.join(meecapsDir, "latest.json");
          fs.writeFileSync(latestPath, JSON.stringify(meecapResult.meecap, null, 2));

          // Export meecap JSON as attachment
          const jsonBuffer = Buffer.from(JSON.stringify(meecapResult.meecap, null, 2), 'utf-8');
          const attachment = new AttachmentBuilder(jsonBuffer, {
            name: `meecap_${meecapResult.meecap.session_id}_${Date.now()}.json`,
          });

          await interaction.editReply({
            content: meecapResult.text,
            files: [attachment],
          });
        }
      } catch (err: any) {
        console.error("Meecap generation error:", err);
        await interaction.editReply({
          content: "Failed to generate meecap. Error: " + (err.message ?? "Unknown"),
        });
      }
      return;
    }
  },
};
