import { SlashCommandBuilder, AttachmentBuilder } from "discord.js";
import { getActiveSession, getLatestIngestedSession, getLatestSessionForLabel } from "../sessions/sessions.js";
import { getLedgerInRange, getLedgerForSession } from "../ledger/ledger.js";
import type { LedgerEntry } from "../ledger/ledger.js";
import { chat } from "../llm/client.js";
import { buildBeatsJsonFromNarrative, generateMeecapStub, validateMeecapV1 } from "../sessions/meecap.js";
import { getDb } from "../db.js";
import { loadRegistry } from "../registry/loadRegistry.js";
import path from "path";
import fs from "fs";

/**
 * Get formatted list of PC names from registry for prompt context
 */
function getPCNamesForPrompt(): string {
  try {
    const registry = loadRegistry();
    const pcNames = registry.characters
      .filter(c => c.type === "pc")
      .map(c => c.canonical_name)
      .sort();
    return pcNames.join(", ");
  } catch (err) {
    console.warn("Failed to load PC names from registry:", err);
    return "(registry unavailable)";
  }
}

/**
 * Word wrap text at approximately maxWidth characters, breaking at word boundaries
 */
function wordWrap(text: string, maxWidth: number = 100): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    
    if (testLine.length <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  }
  
  if (currentLine) {
    lines.push(currentLine);
  }
  
  return lines.join('\n');
}

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
            .setName("label")
            .setDescription("Episode label (e.g., C2E6). If provided, shows that session's transcript.")
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName("range")
            .setDescription("Time range for transcript (default: since_start)")
            .setRequired(false)
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
            .setName("label")
            .setDescription("Episode label (e.g., C2E6). If provided, recaps that session.")
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
        .addBooleanOption((opt) =>
          opt
            .setName("all")
            .setDescription("Generate missing meecaps for all labeled sessions (skips labels with test/chat)")
            .setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt
            .setName("no_json")
            .setDescription("Do not derive beats JSON from narrative meecap")
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
            .setDescription("Episode label filter (e.g., C2E6). Optional; uses latest ingested if omitted.")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("label")
        .setDescription("Set the label for a session.")
        .addStringOption((opt) =>
          opt
            .setName("label")
            .setDescription("Session label to set (e.g., C2E6).")
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("session_id")
            .setDescription("Session ID to label (optional).")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("view")
        .setDescription("View session metadata.")
        .addStringOption((opt) =>
          opt
            .setName("scope")
            .setDescription("Which sessions to list.")
            .setRequired(true)
            .addChoices(
              { name: "All", value: "all" },
              { name: "Unlabeled", value: "unlabeled" }
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
      const label = interaction.options.getString("label") ?? null;
      const range = interaction.options.getString("range") ?? (label ? "recording" : "since_start");
      const primaryOnly = interaction.options.getBoolean("primary") ?? false;
      
      const result = getLedgerSlice({ guildId, range, primaryOnly, sessionLabel: label });

      if ("error" in result) {
        await interaction.reply({ content: result.error, ephemeral: true });
        return;
      }

      // Format in human-readable format (no timestamps/metadata, word-wrapped)
      let transcript = result
        .map((e) => {
          const line = `${e.author_name}: ${e.content}`;
          return wordWrap(line, 100);
        })
        .join("\n\n");

      const mode = primaryOnly ? "primary" : "full";
      const sessionInfo = label ? `${label}, ${mode}` : `${range}, ${mode}`;
      const header = `**Session transcript (${sessionInfo}):**\n`;

      // Discord has a 2000 character limit per message
      // If transcript is too long, send as file attachment instead
      const maxMessageLength = 1900;

      if (transcript.length > maxMessageLength) {
        // Send as file attachment
        const buffer = Buffer.from(transcript, 'utf-8');
        const filename = label 
          ? `transcript-${label}-${Date.now()}.txt`
          : `transcript-${range}-${Date.now()}.txt`;
        const attachment = new AttachmentBuilder(buffer, { name: filename });
        
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
      const label = interaction.options.getString("label") ?? null;
      const source = interaction.options.getString("source") ?? "primary";
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

      // Check if meecap exists for this session
      const db = getDb();
      const meecapRow = db
        .prepare("SELECT meecap_narrative FROM meecaps WHERE session_id = ?")
        .get(session.session_id) as { meecap_narrative?: string } | undefined;
      
      if (!meecapRow || !meecapRow.meecap_narrative) {
        await interaction.reply({
          content: `❯ No meecap found for this session. Run \`/session meecap\` first to generate one.`,
          ephemeral: true,
        });
        return;
      }

      // Defer reply since we're loading from database
      await interaction.deferReply({ ephemeral: true });

      try {
        // In narrative mode, use stored narrative and summarize with DM prompt
        if (!meecapRow.meecap_narrative) {
          await interaction.editReply({
            content: "Narrative meecap not found for this session. Regenerate with `/session meecap --force`.",
          });
          return;
        }

        // Summarize the meecap narrative using DM recap structure
        const pcNames = getPCNamesForPrompt();
        const systemPrompt = `You are MeepoRecap, a D&D session recap generator.

INPUT
You will be given a Meecap document that contains:
- A narrative reconstruction of the session
- Line-numbered citations in the form (Lx) or (Lx–Ly)
- The literal transcript appended below

GOAL
Produce the most helpful recap for BOTH:
- The DM (prep, continuity, hooks, consequences)
- The party (what happened, what matters next)
This recap is for human eyes only and may vary in structure from session to session.

ABSOLUTE GROUNDING RULES (DO NOT VIOLATE)
- Use ONLY information explicitly present in the provided Meecap (narrative + appended transcript).
- Do NOT use any outside/world knowledge or prior session knowledge not present in the Meecap.
- Do NOT invent names, places, motivations, outcomes, items, or implications.
- If something is unclear, contradictory, or implied but not confirmed, label it as "Unclear:" or "Not confirmed:" rather than guessing.

CITATION RULES (CRITICAL)
- Every bullet or factual claim MUST end with a contiguous citation range in the format (Lx–Ly) or (Lx).
- Citations must be contiguous: do NOT use comma-separated citations or multiple separate ranges.
- Citations should ANCHOR the claim, not replace it:
  - Write in broad strokes (synthesis), then cite the span that supports it.
  - Do NOT merely paraphrase a couple lines and call it done.
- If you cannot support a claim with a contiguous citation range, OMIT it.
- Prefer fewer, stronger, well-cited bullets over many weak ones.

WHAT TO EMPHASIZE (PRIORITY ORDER)
1) World-state changes (new obligations, alliances, threats, promises, injuries, deaths, rule changes)
2) Player decisions and their immediate consequences
3) Revealed information / discoveries / lore drops (only what is explicitly stated)
4) Conflicts and outcomes (combat, trials, negotiations, chases) — focus on outcomes and notable costs
5) Unresolved threads / timers / hooks likely to matter next session
6) Notable character moments ONLY if they change relationships, plans, or future behavior

WHAT TO DE-EMPHASIZE
- Turn-by-turn mechanics, repetitive actions, or low-impact micro-events
- Small tactical details unless they materially affect the outcome or create a new thread

STRUCTURE (INTENTIONALLY FLEXIBLE)
- You may choose the most helpful organization for this specific session.
- You MAY include short markdown headings if it improves skimmability.
- You MAY choose chronological, thematic, or mixed organization depending on session content.
- Do NOT force a fixed template if it makes the recap worse.

HARD OUTPUT CONSTRAINTS
- Output markdown only.
- Prefer bullets; avoid long paragraphs.
- Target: ~10–25 total bullets across the entire recap (fewer is fine if the session is short).
- Keep it skimmable: no wall-of-text sections longer than ~6 lines.
- Do NOT include the full transcript.
- Do NOT include meta commentary about the prompt, your confidence, or what you are doing.

QUALITY BAR
This recap should feel like:
- A high-quality session memory for players
- A usable prep aid for the DM
- Faithful enough that any bullet can be audited quickly via its (Lx–Ly) citation
`;
        const summary = await chat({
          systemPrompt,
          userMessage: meecapRow.meecap_narrative,
          maxTokens: 3000,
        });

        const maxMessageLength = 1950;
        if (summary.length > maxMessageLength) {
          const buffer = Buffer.from(summary, 'utf-8');
          const recapLabel = session.label ?? session.session_id;
          const attachment = new AttachmentBuilder(buffer, {
            name: `recap_${recapLabel}.md`,
          });
          await interaction.editReply({
            content: `**Session recap:**\n(Too long for Discord, attached as file)`,
            files: [attachment],
          });
        } else {
          await interaction.editReply({
            content: `**Session recap:**\n${summary}`,
          });
        }
      } catch (err: any) {
        console.error("Failed to generate recap:", err);
        await interaction.editReply({
          content: "Failed to generate recap. " + (err.message ?? "Unknown error"),
        });
      }
      return;
    }

    if (sub === "meecap") {
      const force = interaction.options.getBoolean("force") ?? false;
      const all = interaction.options.getBoolean("all") ?? false;
      const noJson = interaction.options.getBoolean("no_json") ?? false;
      const source = interaction.options.getString("source") ?? "primary";
      const label = interaction.options.getString("label") ?? null;
      const primaryOnly = source === "primary";

      const db = getDb();
      const meecapMode = process.env.MEECAP_MODE ?? "narrative";
      const columns = db.pragma("table_info(meecaps)") as any[];
      const hasNarrativeCol = columns.some((col: any) => col.name === "meecap_narrative");

      const deriveBeatsJson = async (session: any, narrative: string) => {
        const entries = getLedgerForSession({ sessionId: session.session_id, primaryOnly });
        if (!entries || entries.length === 0) {
          return { ok: false, message: `No ledger entries found for session ${session.session_id}` };
        }

        const beatsResult = buildBeatsJsonFromNarrative({
          sessionId: session.session_id,
          lineCount: entries.length,
          narrative,
          entries,
          insertToDB: true,
        });

        if (!beatsResult.ok) {
          return { ok: false, message: beatsResult.error };
        }

        return { ok: true, message: "Derived beats JSON from existing narrative meecap." };
      };

      const generateAndPersist = async (session: any, entries: LedgerEntry[], emitAttachments: boolean) => {
        console.info("Meecap start", {
          sessionId: session.session_id,
          label: session.label ?? null,
          mode: meecapMode,
        });
        const meecapResult = await generateMeecapStub({
          sessionId: session.session_id,
          sessionLabel: session.label,
          entries,
          buildBeatsJson: !noJson,
        });

        if (meecapMode === "narrative") {
          if (!meecapResult.narrative) {
            console.info("Meecap end", {
              sessionId: session.session_id,
              label: session.label ?? null,
              mode: meecapMode,
              ok: false,
            });
            return { ok: false, message: "Failed to generate narrative: " + meecapResult.text };
          }

          if (!hasNarrativeCol) {
            console.info("Meecap end", {
              sessionId: session.session_id,
              label: session.label ?? null,
              mode: meecapMode,
              ok: false,
            });
            return { ok: false, message: "Database schema outdated. Please restart the bot to apply migrations." };
          }

          const now = Date.now();
          db.prepare(`
            INSERT INTO meecaps (session_id, meecap_narrative, model, created_at_ms, updated_at_ms)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
              meecap_narrative = excluded.meecap_narrative,
              model = excluded.model,
              updated_at_ms = excluded.updated_at_ms
          `).run(
            session.session_id,
            meecapResult.narrative,
            "claude-opus",
            now,
            now
          );

          // Generate and persist beats if enabled
          if (!noJson && meecapResult.narrative) {
            const entries = getLedgerForSession({ sessionId: session.session_id, primaryOnly });
            if (entries && entries.length > 0) {
              buildBeatsJsonFromNarrative({
                sessionId: session.session_id,
                lineCount: entries.length,
                narrative: meecapResult.narrative,
                entries,
                insertToDB: true,
              });
            }
          }

          if (emitAttachments) {
            const mdBuffer = Buffer.from(meecapResult.narrative, "utf-8");
            const attachment = new AttachmentBuilder(mdBuffer, {
              name: `meecap-narrative-${Date.now()}.md`,
            });
            await interaction.editReply({
              content: meecapResult.text,
              files: [attachment],
            });
          }

          console.info("Meecap end", {
            sessionId: session.session_id,
            label: session.label ?? null,
            mode: meecapMode,
            ok: true,
          });
          return { ok: true, message: meecapResult.text };
        }

        if (!meecapResult.meecap) {
          console.info("Meecap end", {
            sessionId: session.session_id,
            label: session.label ?? null,
            mode: meecapMode,
            ok: false,
          });
          return { ok: false, message: "Failed to generate meecap: " + meecapResult.text };
        }

        const validationErrors = validateMeecapV1(meecapResult.meecap, entries);
        if (validationErrors.length > 0) {
          const errorSummary = validationErrors.map((e) => `- ${e.field}: ${e.message}`).join("\n");
          console.error("Meecap validation failed:", errorSummary);
          console.info("Meecap end", {
            sessionId: session.session_id,
            label: session.label ?? null,
            mode: meecapMode,
            ok: false,
          });
          return { ok: false, message: `Meecap validation failed:\n${errorSummary}` };
        }

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
          "claude-opus",
          now,
          now
        );

        const meecapsDir = path.join(process.cwd(), "data", "meecaps");
        if (!fs.existsSync(meecapsDir)) {
          fs.mkdirSync(meecapsDir, { recursive: true });
        }
        const meecapFilename = `${session.session_id}__${now}.json`;
        const meecapPath = path.join(meecapsDir, meecapFilename);
        fs.writeFileSync(meecapPath, JSON.stringify(meecapResult.meecap, null, 2));

        const latestPath = path.join(meecapsDir, "latest.json");
        fs.writeFileSync(latestPath, JSON.stringify(meecapResult.meecap, null, 2));

        if (emitAttachments) {
          const jsonBuffer = Buffer.from(JSON.stringify(meecapResult.meecap, null, 2), "utf-8");
          const attachment = new AttachmentBuilder(jsonBuffer, {
            name: `meecap_${meecapResult.meecap.session_id}_${Date.now()}.json`,
          });
          await interaction.editReply({
            content: meecapResult.text,
            files: [attachment],
          });
        }

        console.info("Meecap end", {
          sessionId: session.session_id,
          label: session.label ?? null,
          mode: meecapMode,
          ok: true,
        });
        return { ok: true, message: meecapResult.text };
      };

      if (all) {
        await interaction.deferReply({ ephemeral: true });

        const sessions = db
          .prepare(`
            SELECT s.session_id, s.label, s.created_at_ms, m.meecap_narrative
            FROM sessions s
            LEFT JOIN meecaps m ON m.session_id = s.session_id
            LEFT JOIN meecap_beats b ON b.session_id = s.session_id
            WHERE s.label IS NOT NULL
              AND trim(s.label) <> ''
              AND lower(s.label) NOT LIKE '%test%'
              AND lower(s.label) NOT LIKE '%chat%'
              AND (m.session_id IS NULL OR m.meecap_narrative IS NULL OR b.session_id IS NULL)
            ORDER BY s.created_at_ms DESC
          `)
          .all() as Array<{
            session_id: string;
            label: string | null;
            created_at_ms: number;
            meecap_narrative: string | null;
          }>;

        if (sessions.length === 0) {
          await interaction.editReply({
            content: "No eligible labeled sessions without meecaps found.",
          });
          return;
        }

        let created = 0;
        let skipped = 0;
        let failed = 0;
        const errors: string[] = [];

        for (const s of sessions) {
          // Check if beats already exist for this session
          const existingBeats = db
            .prepare("SELECT id FROM meecap_beats WHERE session_id = ? LIMIT 1")
            .get(s.session_id);
          
          if (existingBeats) {
            skipped++;
            continue;
          }

          if (s.meecap_narrative) {
            if (noJson) {
              skipped++;
              continue;
            }

            const result = await deriveBeatsJson(s, s.meecap_narrative);
            if (result.ok) {
              created++;
            } else {
              failed++;
              errors.push(`${s.label ?? s.session_id}: ${result.message}`);
            }
            continue;
          }

          const entries = getLedgerForSession({ sessionId: s.session_id, primaryOnly });
          if (!entries || entries.length === 0) {
            skipped++;
            continue;
          }

          try {
            const result = await generateAndPersist(s, entries, false);
            if (result.ok) {
              created++;
            } else {
              failed++;
              errors.push(`${s.label ?? s.session_id}: ${result.message}`);
            }
          } catch (err: any) {
            failed++;
            errors.push(`${s.label ?? s.session_id}: ${err.message ?? "Unknown error"}`);
          }
        }

        const errorSummary = errors.length > 0
          ? `\nErrors (first 5):\n- ${errors.slice(0, 5).join("\n- ")}`
          : "";

        await interaction.editReply({
          content: `Meecap batch complete. Created: ${created}, skipped: ${skipped}, failed: ${failed}.${errorSummary}`,
        });
        return;
      }

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
        const existing = db
          .prepare("SELECT meecap_narrative FROM meecaps WHERE session_id = ?")
          .get(session.session_id) as { meecap_narrative?: string | null } | undefined;

        if (existing?.meecap_narrative) {
          // Check if beats already exist
          const beatsExist = db
            .prepare("SELECT id FROM meecap_beats WHERE session_id = ? LIMIT 1")
            .get(session.session_id);
          
          if (beatsExist && !force) {
            await interaction.reply({
              content: `✅ Meecap already exists for this session. Use \`--force\` to regenerate.`,
              ephemeral: true,
            });
            return;
          }

          if (noJson) {
            await interaction.reply({
              content: "✅ Meecap narrative exists. JSON derivation skipped by flag.",
              ephemeral: true,
            });
            return;
          }

          await interaction.deferReply({ ephemeral: true });
          const result = await deriveBeatsJson(session, existing.meecap_narrative);
          if (result.ok) {
            await interaction.editReply({ content: result.message });
          } else {
            await interaction.editReply({ content: `Failed to derive beats JSON: ${result.message}` });
          }
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
        const result = await generateAndPersist(session, entries, true);
        if (!result.ok) {
          await interaction.editReply({
            content: result.message ?? "Failed to generate meecap.",
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

    if (sub === "view") {
      const scope = interaction.options.getString("scope", true);
      const db = getDb();

      const whereClause = scope === "unlabeled"
        ? "WHERE label IS NULL OR label = ''"
        : "";

      const sessions = db
        .prepare(
          `SELECT session_id, guild_id, label, created_at_ms, started_at_ms, ended_at_ms, started_by_id, started_by_name, source
           FROM sessions
           ${whereClause}
           ORDER BY created_at_ms DESC
           LIMIT 50`
        )
        .all() as Array<{
          session_id: string;
          guild_id: string;
          label: string | null;
          created_at_ms: number;
          started_at_ms: number;
          ended_at_ms: number | null;
          started_by_id: string | null;
          started_by_name: string | null;
          source: string;
        }>;

      if (sessions.length === 0) {
        await interaction.reply({
          content: scope === "unlabeled" ? "No unlabeled sessions found." : "No sessions found.",
          ephemeral: true,
        });
        return;
      }

      const lines = sessions.map((s) => {
        const created = new Date(s.created_at_ms).toLocaleString();
        const started = new Date(s.started_at_ms).toLocaleString();
        const ended = s.ended_at_ms ? new Date(s.ended_at_ms).toLocaleString() : "(active)";
        const label = s.label && s.label.trim() ? s.label : "(unlabeled)";
        const startedBy = s.started_by_name ?? s.started_by_id ?? "(unknown)";
        return [
          `- ${label} | ${s.session_id}`,
          `  source=${s.source} guild=${s.guild_id}`,
          `  created=${created} started=${started} ended=${ended} started_by=${startedBy}`,
        ].join("\n");
      });

      const header = scope === "unlabeled"
        ? "Unlabeled sessions (most recent first):"
        : "All sessions (most recent first):";

      const body = `${header}\n${lines.join("\n")}`;

      if (body.length > 1900) {
        const buffer = Buffer.from(body, "utf-8");
        const attachment = new AttachmentBuilder(buffer, { name: `sessions_${scope}.txt` });
        await interaction.reply({
          content: "Session list attached (too long for Discord message).",
          files: [attachment],
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: `${body}`,
          ephemeral: true,
        });
      }
      return;
    }

    if (sub === "label") {
      const label = interaction.options.getString("label", true);
      const sessionId = interaction.options.getString("session_id");
      const db = getDb();

      if (sessionId) {
        const existing = db
          .prepare("SELECT session_id FROM sessions WHERE session_id = ?")
          .get(sessionId) as { session_id: string } | undefined;

        if (!existing) {
          await interaction.reply({
            content: `No session found for session_id: ${sessionId}`,
            ephemeral: true,
          });
          return;
        }

        db.prepare("UPDATE sessions SET label = ? WHERE session_id = ?")
          .run(label, sessionId);

        await interaction.reply({
          content: `Session labeled: ${label} (${sessionId})`,
          ephemeral: true,
        });
        return;
      }

      const activeSession = getActiveSession(guildId);
      if (activeSession) {
        db.prepare("UPDATE sessions SET label = ? WHERE session_id = ?")
          .run(label, activeSession.session_id);

        await interaction.reply({
          content: `Session labeled: ${label} (${activeSession.session_id})`,
          ephemeral: true,
        });
        return;
      }

      const unlabeledSessions = db
        .prepare(
          `SELECT session_id, created_at_ms, started_at_ms, source
           FROM sessions
           WHERE label IS NULL OR label = ''
           ORDER BY created_at_ms DESC
           LIMIT 10`
        )
        .all() as Array<{
          session_id: string;
          created_at_ms: number;
          started_at_ms: number;
          source: string;
        }>;

      const unlabeledList = unlabeledSessions.length
        ? "Unlabeled sessions (most recent first):\n" +
          unlabeledSessions
            .map((s) => `- ${s.session_id} (${s.source}, created ${new Date(s.created_at_ms).toLocaleString()})`)
            .join("\n")
        : "Unlabeled sessions: (none found)";

      await interaction.reply({
        content:
          "No active session found.\n" +
          unlabeledList +
          "\n\nTip: copy a session_id from the list and use /session label session_id:<id> to label it.",
        ephemeral: true,
      });
      return;
    }
  },
};
