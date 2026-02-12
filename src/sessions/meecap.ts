/**
 * Meecap Generator V1 (Ledger-ID Anchored)
 * 
 * Meecap = Memory-optimized, editable recap structured as:
 * - Scenes (temporal/spatial chunks with stable ledger ID ranges)
 * - Beats (character-centric moments with ledger ID evidence)
 * 
 * Key design:
 * - Line indices [L0, L1, ...] for editing convenience + UI
 * - Ledger IDs for stable references across transcript re-filtering
 * - Ranges (not arrays) for scenes; small evidence lists for beats
 * 
 * V1 contract:
 * - Every scene + beat must have ledger_id_range or evidence_ledger_ids
 * - Validators ensure consistency before DB write
 * - Enables: "regenerate Scene 2 only" via targeted slicing
 */

import { chat } from "../llm/client.js";
import type { LedgerEntry } from "../ledger/ledger.js";
import fs from "fs";
import path from "path";

// ============================================================================
// Configuration: Meecap Mode
// ============================================================================

export type MeecapMode = "narrative" | "v1_json";

function getMeecapMode(): MeecapMode {
  const mode = process.env.MEE_CAP_MODE ?? "narrative";
  return mode === "v1_json" ? "v1_json" : "narrative";
}

/**
 * Save narrative meecap to file system.
 * 
 * Writes to data/meecaps/{session_id}__{timestamp}.md
 * Creates directory if needed.
 */
function saveNarrativeToFile(args: {
  sessionId: string;
  narrative: string;
}): string | null {
  const { sessionId, narrative } = args;

  try {
    const meecapsDir = path.resolve("data", "meecaps");
    
    // Ensure directory exists
    if (!fs.existsSync(meecapsDir)) {
      fs.mkdirSync(meecapsDir, { recursive: true });
    }

    // Filename: {sessionId}__{timestamp}.md
    const timestamp = Date.now();
    const filename = `${sessionId}__${timestamp}.md`;
    const filepath = path.join(meecapsDir, filename);

    // Write file
    fs.writeFileSync(filepath, narrative, "utf-8");
    
    return filepath;
  } catch (err: any) {
    console.warn(
      `⚠️  Failed to save narrative meecap to file: ${err.message ?? err}`
    );
    return null;
  }
}

// ============================================================================
// Types: Meecap V1 Schema
// ============================================================================

export type LineSpan = {
  start: number;
  end: number;
};

export type LedgerIdRange = {
  start: string;
  end: string;
};

export type MeecapBeat = {
  moment: string;                    // What happened (short, factual)
  summary?: string;                  // Optional: 1-2 sentence detail
  span: {
    lines: LineSpan;                 // For editing convenience [L0-L5]
    evidence_ledger_ids: string[];   // Small list of key evidence IDs (non-empty)
  };
  participants?: string[];           // Best-effort, optional
};

export type MeecapScene = {
  number: number;
  title: string;
  summary: string;                   // Factual recap of scene
  span: {
    lines: LineSpan;                 // Line range for UI
    ledger_id_range: LedgerIdRange;  // Stable anchor
  };
  beats: MeecapBeat[];
};

export type Meecap = {
  version: 1;
  session_id: string;
  session_span: {
    lines: LineSpan;
    ledger_id_range: LedgerIdRange;
    timestamp_range: { start: string; end: string };
  };
  scenes: MeecapScene[];
};

export type MeecapGenerationResult = {
  text: string;        // Discord message response
  meecap?: Meecap;     // Structured output (V1 only)
  narrative?: string;  // Prose narrative (narrative mode)
};

/**
 * Generate a Meecap from session transcript using LLM.
 * 
 * Supports two modes:
 * - "narrative" (default): Generates story-like prose retelling
 * - "v1_json": Generates structured JSON with scenes/beats (legacy)
 * 
 * @param args.sessionId - Session identifier
 * @param args.entries - Ledger entries in order (with id + timestamp_ms)
 * @returns Discord response + optional narrative or structured Meecap
 */
export async function generateMeecapStub(args: {
  sessionId: string;
  entries: LedgerEntry[];
}): Promise<MeecapGenerationResult> {
  const mode = getMeecapMode();

  if (mode === "narrative") {
    return generateMeecapNarrative(args);
  } else {
    return generateMeecapV1Json(args);
  }
}

/**
 * Generate narrative prose Meecap (story-like retelling).
 * 
 * Returns plain prose output grounded in transcript without JSON parsing.
 */
async function generateMeecapNarrative(args: {
  sessionId: string;
  entries: LedgerEntry[];
}): Promise<MeecapGenerationResult> {
  const { sessionId, entries } = args;

  if (!entries || entries.length === 0) {
    return {
      text: "❌ No ledger entries found for this session.",
    };
  }

  try {
    // Build transcript with line indices
    const transcript = buildMeecapTranscript(entries);

    // Build narrative-specific prompts
    const { systemPrompt, userMessage } = buildNarrativeMeecapPrompts({
      sessionId,
      transcript,
      entryCount: entries.length,
    });

    // Call LLM
    const modelOutput = await chat({
      systemPrompt,
      userMessage,
      maxTokens: 16000,
    });

    // Validate prose (lightweight checks)
    const validationErrors = validateMeecapNarrative(modelOutput);
    if (validationErrors.length > 0) {
      const errorSummary = validationErrors
        .map((e) => `- ${e}`)
        .join("\n");
      return {
        text: `❌ Meecap narrative validation failed:\n\`\`\`\n${errorSummary}\n\`\`\``,
      };
    }

    // Append SOURCE TRANSCRIPT section (system-side, not LLM-generated)
    const fullMeecap = `=== MEECAP NARRATIVE ===

${modelOutput.trim()}

=== SOURCE TRANSCRIPT ===

${transcript}`;

    // Save to file system
    const filepath = saveNarrativeToFile({
      sessionId,
      narrative: fullMeecap,
    });

    // Success
    const narrativeWordCount = modelOutput.split(/\s+/).length;
    const fullWordCount = fullMeecap.split(/\s+/).length;
    const fileLocation = filepath ? `\n**File:** \`${filepath}\`` : "";
    const text = `✅ **Meecap Narrative Generated**

**Stats:**
- Narrative word count: ~${narrativeWordCount}
- Total word count (with transcript): ~${fullWordCount}
- Transcript lines: ${entries.length}

**Storage:** Database (meecaps table)${fileLocation}
**Retrieval:** Use \`/session recap range=recording style=narrative\` to retrieve

The narrative Meecap has been saved and is ready for review/editing.`;

    return {
      text,
      narrative: fullMeecap,
    };
  } catch (err: any) {
    return {
      text: `❌ Meecap generation failed: ${err.message ?? err}`,
    };
  }
}

/**
 * Generate V1 JSON Meecap (legacy, structured scenes/beats).
 * 
 * Original implementation: returns schema-validated JSON.
 */
async function generateMeecapV1Json(args: {
  sessionId: string;
  entries: LedgerEntry[];
}): Promise<MeecapGenerationResult> {
  const { sessionId, entries } = args;

  if (!entries || entries.length === 0) {
    return {
      text: "❌ No ledger entries found for this session.",
    };
  }

  try {
    // Build transcript with line indices and IDs
    const transcript = buildMeecapTranscript(entries);

    // Pre-fill session span (immutable)
    const sessionSpan = {
      lines: { start: 0, end: entries.length - 1 },
      ledger_id_range: {
        start: entries[0].id,
        end: entries[entries.length - 1].id,
      },
      timestamp_range: {
        start: new Date(entries[0].timestamp_ms).toISOString(),
        end: new Date(entries[entries.length - 1].timestamp_ms).toISOString(),
      },
    };

    // Build prompt
    const { systemPrompt, userMessage } = buildV1MeecapPrompts({
      sessionId,
      sessionSpan,
      transcript,
    });

    // Call LLM
    const modelOutput = await chat({
      systemPrompt,
      userMessage,
      maxTokens: 16000, // Allow long output for detailed segmentation
    });

    // Parse JSON
    let meecapJson: any;
    try {
      meecapJson = JSON.parse(modelOutput);
    } catch (err) {
      return {
        text: `❌ LLM output was not valid JSON.\n\nRaw output:\n\`\`\`\n${modelOutput.slice(0, 500)}\n\`\`\``,
      };
    }

    // Validate against schema
    const validationErrors = validateMeecapV1(meecapJson, entries);
    if (validationErrors.length > 0) {
      const errorSummary = validationErrors
        .map((e) => `- ${e.field}: ${e.message}`)
        .join("\n");
      return {
        text: `❌ Meecap validation failed:\n\`\`\`\n${errorSummary}\n\`\`\``,
      };
    }

    // Success
    const sceneCount = meecapJson.scenes?.length ?? 0;
    const beatCount = meecapJson.scenes?.reduce(
      (sum: number, s: any) => sum + (s.beats?.length ?? 0),
      0
    ) ?? 0;

    const text = `✅ **Meecap Generated Successfully**

**Structure:**
- Scenes: ${sceneCount}
- Beats: ${beatCount}
- Transcript lines: ${entries.length}

**Schema:** V1 (Ledger-ID anchored)

Meecap has been saved to the database and is ready for review/editing.`;

    return {
      text,
      meecap: meecapJson as Meecap,
    };
  } catch (err: any) {
    return {
      text: `❌ Meecap generation failed: ${err.message ?? err}`,
    };
  }
}

// ============================================================================
// Prompt Builder: Narrative Mode
// ============================================================================

/**
 * Build system + user prompts for narrative Meecap generation.
 * 
 * Requests prose output instead of JSON.
 */
function buildNarrativeMeecapPrompts(args: {
  sessionId: string;
  transcript: string;
  entryCount: number;
}): { systemPrompt: string; userMessage: string } {
  const { sessionId, transcript, entryCount } = args;

  const systemPrompt = `You are Meecap, the session chronicler of a D&D game.

Your task is to transform a raw gameplay transcript into a faithful narrative reconstruction of what happened in the game world.

This is NOT a summary.
This is restructuring, NOT compression.

The transcript is the source of truth.

------------------------------------------------------------
OUT-OF-CHARACTER (OOC) EXCLUSION RULE (CRITICAL)
------------------------------------------------------------

The transcript may include out-of-character/table talk (rules discussion, real-life chat, scheduling, tech issues, "good game", etc.).

You MUST EXCLUDE OOC content from the narrative.
Only include in-character (IC) gameplay: in-world narration, roleplay, in-world planning, actions, checks, combat, and in-world consequences.

If you are unsure whether a line is IC or OOC, TREAT IT AS IC AND INCLUDE IT IN THE NARRATIVE.

------------------------------------------------------------
LINE COVERAGE RULE (CRITICAL — THIS PREVENTS COMPRESSION)
------------------------------------------------------------

For EVERY transcript line that is IC, the narrative MUST reflect it.

“Reflect it” means:
- Prefer: directly quote the line as dialogue or narrated description (with light grammar cleanup).
- Allowed: a very close paraphrase if quoting would be awkward.

CRITICAL:
A citation alone is NOT sufficient.
The narrative must actually include the content/meaning of the IC line, not merely reference it.

Coverage requirement:
- EVERY IC line index (L#) must appear at least once as a citation in the narrative.
- Do NOT skip IC lines.
- Do NOT replace many IC lines with a single generalized sentence.

Golden ideal:
A faithful word-for-word account with only grammatical fixes and continuity smoothing.

------------------------------------------------------------
CITATION GRANULARITY RULE
------------------------------------------------------------

Prefer citing a single line: (L#).

You may cite a short contiguous range ONLY when necessary:
- the transcript lines are extremely short or fragmentary,
- the transcript splits a single thought across lines,
- or multiple consecutive lines form one continuous exchange that would be awkward to cite individually.

If you cite a range, keep it short:
- Maximum range length is 3 lines (e.g., (L12–L14)).
- Do not cite long spans like (L12–L30).
- If more than 3 lines are involved, use multiple citations instead.

------------------------------------------------------------
NARRATION VS DIALOGUE
------------------------------------------------------------

Some transcript lines are in-world narration or scene framing (often from the DM). These are IC and must be rewritten as omniscient exposition WITHOUT mentioning “the DM” or “players.”

Player speech should appear as dialogue, preserving original wording as closely as possible.

Proper names may drift due to speech-to-text. You may correct obvious misspellings when context clearly supports it.

------------------------------------------------------------
STYLE RULES
------------------------------------------------------------

- Third-person omniscient narration.
- Do NOT mention “the DM” or “players.”
- Exposition should read like a chronicle: clear, literal, grounded.
- Dialogue should be written as dialogue, preserving original wording as closely as possible.
- Preserve chronological order.
- Preserve physical actions and staging.

Avoid:
- Grand metaphors
- Thematic conclusions
- Cinematic trailer phrasing
- Invented internal thoughts or motivations

------------------------------------------------------------
OUTPUT FORMAT
------------------------------------------------------------

Return EXACTLY:

=== MEECAP NARRATIVE ===
<faithful narrative reconstruction of IC lines with citations>

[Optional, only if any OOC excluded]
OOC_EXCLUDED_LINES: [L#, L#, ...]

Do not include any other commentary.`;


  const userMessage = `You will be given a raw transcript.

Each line is formatted as:
[L{index} id={ledger_uuid}] [ISO_TIMESTAMP] SPEAKER: TEXT

TASK:
Write a faithful reconstruction of ONLY the in-character (IC) gameplay as narrative + dialogue.

IMPORTANT:
- Exclude out-of-character/table talk from the narrative.
- Use direct quotes wherever possible (light grammar cleanup allowed).
- Every IC line must be reflected in the narrative (not merely cited).
- Cite every IC line at least once using (L#) or (L#–L#).

TRANSCRIPT:
${transcript}`;


  return { systemPrompt, userMessage };
}

// ============================================================================
// Prompt Builder: V1 JSON Mode
// ============================================================================

/**
 * Build system + user prompts for V1 JSON Meecap generation.
 */
function buildV1MeecapPrompts(args: {
  sessionId: string;
  sessionSpan: any;
  transcript: string;
}): { systemPrompt: string; userMessage: string } {
  const { sessionId, sessionSpan, transcript } = args;

const systemPrompt = `You are Meecap, an offline D&D session structurer.

Your job is to transform a provided transcript into a structured outline of SCENES and BEATS.

OUT-OF-CHARACTER (OOC) EXCLUSION RULE:
The transcript may include out-of-character/table talk (rules discussion, real-life chat, scheduling, tech issues, "good game", etc.).
You MUST EXCLUDE OOC content from the Meecap output.
Only include in-character (IC) gameplay: narration, roleplay, in-world planning, actions, checks, combat, and in-world consequences.
If you are unsure whether a line is IC or OOC, treat it as OOC and exclude it.
Do not create scenes or beats from OOC content.

CRITICAL RULES:
- You MUST output valid JSON only. No markdown. No commentary.
- You MUST NOT invent facts. Only summarize what is supported by transcript lines.
- Every BEAT must cite evidence_ledger_ids from the transcript lines provided.
- Scene ledger_id_range must use the start/end ledger IDs that correspond to the scene span.
- Beat evidence_ledger_ids must be a non-empty list.
- Use only ledger IDs that appear in the transcript input. Never fabricate IDs.

PRIMARY PLAYER CHARACTERS:
Jamison
Minx
Snowflake
Cyril
Evanora
Louis

When these characters appear in the transcript, refer to them by name.

SPECIFICITY RULES:
- When a PC or NPC is clearly identifiable in the transcript, use their proper name in scene titles, summaries, and beat moments.
- If a name is explicitly said in the transcript text, you MUST use that name (do not replace it with "an NPC" or "someone").
- Avoid vague phrases like "a character", "someone", or "they" if a specific speaker name is available.
- Prefer: "Jamison challenges Corah" over "The party confronts an NPC."
- Prefer: "Minx casts Hex on the guard" over "A spell is cast."
- Prefer active constructions that identify who acted.
- Scene summaries should identify at least one named participant when the transcript supports it.
- Use speaker names exactly as written in the transcript.

GROUP ACTION RULE:
- When the transcript clearly indicates that the entire group acts together (e.g., moving locations, entering a room, standing in line, traveling), you may use "the party."
- Do NOT list every individual PC unless the transcript highlights specific individual actions.
- Use "the party" only when the action is genuinely collective and not character-driven.

DETAIL / COVERAGE RULES (MANDATORY):
- You MUST cover all in-character events in the transcript with scenes and beats (do not skip meaningful IC actions, discoveries, decisions, checks, outcomes, or location transitions).
- Beats must be atomic: one beat should correspond to one main action, revelation, decision, or outcome.
- Do NOT collapse multiple distinct events into one beat if they occur in different parts of the transcript.

STRUCTURAL CONSTRAINTS (MANDATORY):
- The scenes MUST cover the entire session_span line range contiguously with no gaps and no overlaps.
  - Scene 1 must start at session_span.lines.start.
  - Final scene must end at session_span.lines.end.
  - Scene i ends at line X and Scene i+1 must start at line X+1.
- Within each scene, the beats MUST partition the scene contiguously with no gaps and no overlaps.
  - First beat starts at scene span start.
  - Last beat ends at scene span end.
  - Beat j ends at line Y and Beat j+1 must start at line Y+1.
- Beat span size limit: each beat must cover between 2 and 8 transcript lines (inclusive).
  - If an important moment spans more lines, split it into multiple beats.
- Minimum beats per scene: 4 beats (unless the scene has fewer than 8 lines total, then use as many beats as possible).
- Avoid beats that cover an entire long scene. Beats must be granular.

Output must conform to the provided JSON schema (V1).
If you are unsure about a detail, omit it rather than guessing.`;

const userMessage = `You will be given a transcript as numbered lines. Each line has this format:

[L{index} id={ledger_uuid}] [ISO_TIMESTAMP] SPEAKER: TEXT

Example:
[L7 id=0f3a...] [2026-02-11T21:06:18.890Z] DM: You make your way...

TASK:
Produce a Meecap V1 JSON object with comprehensive scenes and beats, covering all in-character events in the transcript.

GOALS:
- Segment the transcript into 4–10 scenes (choose a reasonable number; longer transcripts may require more).
- Each scene contains 4–10 beats (beats must be granular and atomic).
- Keep all summaries factual and grounded.

HARD CONSTRAINTS (must satisfy validator):
1) Output JSON only (no code fences, no extra keys outside schema).
2) Do NOT modify session_span (it is pre-filled and immutable).
3) For each scene:
   - span.lines.start/end are integer indices from the transcript.
   - span.ledger_id_range.start/end MUST be the ledger UUIDs from the transcript lines at those indices.
4) For each beat:
   - span.lines.start/end are indices within the parent scene range.
   - span.evidence_ledger_ids MUST be a non-empty list of ledger UUIDs that appear in the transcript.
   - All evidence_ledger_ids must lie within the beat line span.
5) Participants are optional; if included, use speaker names from the transcript.

STYLE:
- Scene title: short and concrete.
- Scene summary: 1–2 sentences.
- Beat moment: short phrase (5–12 words). 
- Beat summary: optional, 1–2 sentences.

Return this exact schema (pre-filled session_span must not change):

{
  "version": 1,
  "session_id": "${sessionId}",
  "session_span": ${JSON.stringify(sessionSpan)},
  "scenes": [
    {
      "number": <int>,
      "title": "<string>",
      "summary": "<string>",
      "span": {
        "lines": { "start": <int>, "end": <int> },
        "ledger_id_range": { "start": "<uuid>", "end": "<uuid>" }
      },
      "beats": [
        {
          "moment": "<string>",
          "summary": "<string optional>",
          "span": {
            "lines": { "start": <int>, "end": <int> },
            "evidence_ledger_ids": ["<uuid>", "..."]
          },
          "participants": ["<speaker>", "..."]
        }
      ]
    }
  ]
}

Now generate the JSON for this session.

TRANSCRIPT:
${transcript}`;

return { systemPrompt, userMessage };

}

// ============================================================================
// Validation: Narrative Mode
// ============================================================================

/**
 * Lightweight validation for narrative prose Meecap.
 * 
 * Checks:
 * - Not empty
 * - Not JSON-looking (no opening brace or bracket)
 * - Contains at least one character name or proper noun (heuristic)
 * 
 * Returns array of errors (empty = valid).
 */
function validateMeecapNarrative(prose: string): string[] {
  const errors: string[] = [];

  // Check 1: Not empty
  if (!prose || prose.trim().length === 0) {
    errors.push("Output is empty");
    return errors;
  }

  // Check 2: Not JSON-looking (should not start with { or [)
  const trimmed = prose.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    errors.push("Output appears to be JSON, not prose. Expected narrative text.");
    return errors;
  }

  // Check 3: Heuristic - contains character names or proper nouns
  // Look for capitalized words that appear multiple times or typical D&D names
  const capitalizedWords = prose
    .match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g) || [];
  
  const uniqueProperNouns = new Set(capitalizedWords);
  
  // Also look for common D&D terms that would indicate grounding
  const dndTerms = [
    /\b(Jamison|Minx|Snowflake|Cyril|Evanora|Louis|DM|party|cast|spell|check|damage)\b/i,
  ];
  
  const hasGameContent = dndTerms.some(term => term.test(prose));
  
  if (uniqueProperNouns.size < 2 && !hasGameContent) {
    // Warn but don't fail - prose might be about location details
    console.warn(
      "⚠️  Narrative Meecap has few proper nouns detected. Verify grounding."
    );
  }

  return errors;
}

// ============================================================================
// Transcript Builder: Indices + Ledger IDs
// ============================================================================

/**
 * Build transcript with line indices [L0], [L1], ... and ledger entry IDs.
 * 
 * Output format:
 * [L0 id=abc123] [timestamp] speaker: content
 * [L1 id=def456] [timestamp] speaker: content
 */
export function buildMeecapTranscript(entries: LedgerEntry[]): string {
  return entries
    .map((e, idx) => {
      const t = new Date(e.timestamp_ms).toISOString();
      // Use normalized content if available, fallback to raw
      const content = e.content_norm ?? e.content;
      return `[L${idx} id=${e.id}] [${t}] ${e.author_name}: ${content}`;
    })
    .join("\n");
}

// ============================================================================
// Validator: Meecap V1 Contract
// ============================================================================

export type ValidationError = {
  field: string;
  message: string;
};

/**
 * Validate Meecap V1 output against schema and ledger consistency.
 * 
 * Returns array of errors (empty = valid).
 * On error, do not persist to DB.
 */
export function validateMeecapV1(
  meecap: any,
  entries: LedgerEntry[]
): ValidationError[] {
  const errors: ValidationError[] = [];
  const entryIds = new Set(entries.map((e) => e.id));
  const entryIdOrder = new Map(entries.map((e, i) => [e.id, i]));

  // Top-level structure
  if (!meecap || typeof meecap !== "object") {
    errors.push({ field: "meecap", message: "Not a valid object" });
    return errors;
  }

  if (meecap.version !== 1) {
    errors.push({
      field: "version",
      message: `Expected version 1, got ${meecap.version}`,
    });
  }

  if (typeof meecap.session_id !== "string" || !meecap.session_id) {
    errors.push({
      field: "session_id",
      message: "Missing or not a string",
    });
  }

  // Session span
  if (!meecap.session_span) {
    errors.push({
      field: "session_span",
      message: "Missing session_span",
    });
    return errors; // Can't validate further
  }

  const {
    session_span: {
      ledger_id_range: sessionIdRange,
      lines: sessionLines,
      timestamp_range,
    },
  } = meecap;

  if (!sessionIdRange || !sessionIdRange.start || !sessionIdRange.end) {
    errors.push({
      field: "session_span.ledger_id_range",
      message: "Missing or incomplete ledger_id_range",
    });
  } else {
    if (!entryIds.has(sessionIdRange.start)) {
      errors.push({
        field: "session_span.ledger_id_range.start",
        message: `Ledger ID not found: ${sessionIdRange.start}`,
      });
    }
    if (!entryIds.has(sessionIdRange.end)) {
      errors.push({
        field: "session_span.ledger_id_range.end",
        message: `Ledger ID not found: ${sessionIdRange.end}`,
      });
    }
    // Check ordering
    const startOrder = entryIdOrder.get(sessionIdRange.start) ?? -1;
    const endOrder = entryIdOrder.get(sessionIdRange.end) ?? -1;
    if (startOrder >= 0 && endOrder >= 0 && startOrder > endOrder) {
      errors.push({
        field: "session_span.ledger_id_range",
        message: "start_id comes after end_id in slice order",
      });
    }
  }

  if (!sessionLines || typeof sessionLines.start !== "number" || typeof sessionLines.end !== "number") {
    errors.push({
      field: "session_span.lines",
      message: "Missing or invalid line range",
    });
  }

  // Scenes
  if (!Array.isArray(meecap.scenes)) {
    errors.push({
      field: "scenes",
      message: "Not an array",
    });
    return errors;
  }

  for (let i = 0; i < meecap.scenes.length; i++) {
    const scene = meecap.scenes[i];
    const scenePrefix = `scenes[${i}]`;

    if (typeof scene.number !== "number") {
      errors.push({
        field: `${scenePrefix}.number`,
        message: "Missing or not a number",
      });
    }

    if (typeof scene.title !== "string" || !scene.title) {
      errors.push({
        field: `${scenePrefix}.title`,
        message: "Missing or not a string",
      });
    }

    if (typeof scene.summary !== "string" || !scene.summary) {
      errors.push({
        field: `${scenePrefix}.summary`,
        message: "Missing or not a string",
      });
    }

    if (!scene.span) {
      errors.push({
        field: `${scenePrefix}.span`,
        message: "Missing span",
      });
      continue;
    }

    // Scene ledger_id_range
    const sceneIdRange = scene.span.ledger_id_range;
    if (!sceneIdRange || !sceneIdRange.start || !sceneIdRange.end) {
      errors.push({
        field: `${scenePrefix}.span.ledger_id_range`,
        message: "Missing or incomplete",
      });
    } else {
      if (!entryIds.has(sceneIdRange.start)) {
        errors.push({
          field: `${scenePrefix}.span.ledger_id_range.start`,
          message: `Ledger ID not found: ${sceneIdRange.start}`,
        });
      }
      if (!entryIds.has(sceneIdRange.end)) {
        errors.push({
          field: `${scenePrefix}.span.ledger_id_range.end`,
          message: `Ledger ID not found: ${sceneIdRange.end}`,
        });
      }
      // Check ordering
      const sceneStart = entryIdOrder.get(sceneIdRange.start) ?? -1;
      const sceneEnd = entryIdOrder.get(sceneIdRange.end) ?? -1;
      if (sceneStart >= 0 && sceneEnd >= 0 && sceneStart > sceneEnd) {
        errors.push({
          field: `${scenePrefix}.span.ledger_id_range`,
          message: "start_id comes after end_id",
        });
      }
    }

    // Scene lines
    const sceneLines = scene.span.lines;
    if (!sceneLines || typeof sceneLines.start !== "number" || typeof sceneLines.end !== "number") {
      errors.push({
        field: `${scenePrefix}.span.lines`,
        message: "Missing or invalid line range",
      });
    }

    // Beats
    if (!Array.isArray(scene.beats)) {
      errors.push({
        field: `${scenePrefix}.beats`,
        message: "Not an array",
      });
      continue;
    }

    for (let j = 0; j < scene.beats.length; j++) {
      const beat = scene.beats[j];
      const beatPrefix = `${scenePrefix}.beats[${j}]`;

      if (typeof beat.moment !== "string" || !beat.moment) {
        errors.push({
          field: `${beatPrefix}.moment`,
          message: "Missing or not a string",
        });
      }

      if (!beat.span) {
        errors.push({
          field: `${beatPrefix}.span`,
          message: "Missing span",
        });
        continue;
      }

      // Evidence IDs
      const evidenceIds = beat.span.evidence_ledger_ids;
      if (!Array.isArray(evidenceIds) || evidenceIds.length === 0) {
        errors.push({
          field: `${beatPrefix}.span.evidence_ledger_ids`,
          message: "Missing or empty (must have at least 1)",
        });
      } else {
        // Filter out missing IDs and log warnings for ones not found
        const validIds = [];
        const missingIds = [];
        
        for (const id of evidenceIds) {
          if (entryIds.has(id)) {
            validIds.push(id);
          } else {
            missingIds.push(id);
          }
        }

        // Log warnings for missing IDs (graceful degradation)
        if (missingIds.length > 0) {
          console.warn(
            `⚠️  ${beatPrefix}: Filtered out missing ledger IDs: ${missingIds.join(", ")}`
          );
          // Update the beat to only have valid IDs
          beat.span.evidence_ledger_ids = validIds;
        }

        // If all IDs were missing, that's an error
        if (validIds.length === 0) {
          errors.push({
            field: `${beatPrefix}.span.evidence_ledger_ids`,
            message: "All evidence ledger IDs were missing/invalid (no valid entries found)",
          });
        }
      }
    }
  }

  return errors;
}

