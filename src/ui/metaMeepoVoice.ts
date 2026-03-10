// App-facing string boundary for /meepo command UX.
// No side effects, no async, deterministic output, and no imports from command handlers.

export type RecapStyle = "detailed" | "balanced" | "concise";
export type CanonPersonaMode = "diegetic" | "meta";
export const META_VOICE_VERSION = 1;

export type DoctorCheck = {
  icon: "✅" | "⚠️" | "❌";
  label: string;
  action: string;
};

type WakeReplyInput = {
  startedSessionLabel: string | null;
  activeSessionLabel: string | null;
  endedPrevious: boolean;
  effectiveMode: string;
  personaDisplayName: string;
  personaId: string;
  homeText: string;
  homeVoice: string;
  joinedVoice: string | null;
  stayPutNotice: string | null;
  notInVoiceNotice: string | null;
  setupSummaryLines: string[];
};

type StatusSnapshotInput = {
  lifecycleState: "Dormant" | "Ready" | "Showtime Active";
  voiceState: "Connected" | "Not connected";
  session: string;
  campaign: string;
  campaignDmLines?: string[];
  nextStep: string;
  isDevUser: boolean;
  devDiagnosticsLines?: string[];
  legacyLabNotes?: string[];
};

type SessionViewLinesInput = {
  sessionId: string;
  label: string;
  startedIso: string;
  endedIso: string;
  kind: string;
  baseExists: boolean;
  baseHash: string;
  baseVersion: string;
  recapExists: boolean;
  finalStyle: string;
  finalCreatedAt: string;
  finalHash: string;
  finalVersion: string;
  linkedBaseVersion: string;
  transcriptStatus: string;
  dbRowMissingFileNotice: boolean;
  hasUnindexedFilesNotice: boolean;
  nextActionLine: string | null;
  transcriptMissingNotice: boolean;
};

function truthyLines(lines: Array<string | null | undefined | false>): string[] {
  return lines.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function header(title: string): string {
  return `**${title}**`;
}

function indent(line: string, spaces = 2): string {
  const pad = " ".repeat(spaces);
  return line
    .split("\n")
    .map((l) => (l.trim().length === 0 ? l : `${pad}${l}`))
    .join("\n");
}

function bullets(lines: string[], bullet = "•"): string {
  return lines.map((l) => `${bullet} ${l}`).join("\n");
}

function formatMode(mode: string): string {
  if (!mode) return "unknown";
  const m = mode.toLowerCase();
  if (m === "canon") return "Canon";
  if (m === "ambient") return "Ambient";
  if (m === "dormant") return "Dormant";
  if (m === "lab") return "Lab";
  return mode;
}

function shortHash(hash: string, keep = 8): string {
  if (!hash) return "(unknown)";
  const h = hash.trim();
  if (h.length <= keep) return h;
  return `${h.slice(0, keep)}…`;
}

function sassyNudge(lines: string[], enabled = true): string[] {
  if (!enabled) return lines;
  // A light, consistent micro-sass, not clown energy.
  return lines.map((l) =>
    l.replace(/Fix hints: none/i, "Fix hints: none. I’m almost suspicious.")
  );
}

export const metaMeepoVoice = {
  wake: {
    blockedDueToSetup(setupSummaryLines: string[]): string {
      const lines = truthyLines([
        header("I can’t wake up *yet*"),
        "Something in setup is blocking me, meep. Fix these and try `/meepo awaken` again:",
        setupSummaryLines.length ? indent(bullets(setupSummaryLines, "•")) : indent("• (no details provided)"),
        "",
        "Quick command reference: `/meepo help`.",
        "",
        "If you want a full checklist, run `/meepo doctor`.",
      ]);
      return lines.join("\n");
    },

    setupSummaryLines(applied: string[], warnings: string[], errors: string[]): string[] {
      const lines: string[] = [];

      if (applied.length > 0) {
        lines.push(`✅ I adjusted a few things: ${applied.join("; ")}`);
      }
      if (warnings.length > 0) {
        lines.push(`⚠️ Heads up: ${warnings.join("; ")}`);
      }
      if (errors.length > 0) {
        lines.push(`❌ I’m blocked on: ${errors.join("; ")}`);
      }

      return lines;
    },

    voiceConnectSkipped(): string {
      return "🎧 I’m staying out of voice for now, meep... I don’t have Connect/Speak permission in the home voice channel. Fix that, then run `/meepo awaken` again. Quick reference: `/meepo help`.";
    },

    stayPutNotice(channelRef: string): string {
      return `I am already in ${channelRef} and will stay put, meep. Change home voice via /meepo settings set.`;
    },

    notInVoiceNotice(): string {
      return "Join a voice channel and run /meepo awaken again if you want me to connect, meep. Need the full command map? Run /meepo help.";
    },

    pausedContinuePrompt(): string {
      return "Awakening paused: run /meepo awaken and press Continue to proceed.";
    },

    talkTip(): string {
      return "💬 Tip: after awakening, run /meepo talk if you want voice replies, meep.";
    },

    replyLines(input: WakeReplyInput): string[] {
      const lines: string[] = [];

      // Opening line
      if (input.startedSessionLabel) {
        if (input.endedPrevious) lines.push("🧾 Closed the previous session, meep.");
        lines.push(`🎬 Started a session: **"${input.startedSessionLabel}"**`);
      } else if (input.activeSessionLabel) {
        lines.push("🧠 I’m awake.");
        lines.push(`🎬 You already have an active canon session: **"${input.activeSessionLabel}"**`);
      } else {
        lines.push("🧠 I’m awake.");
        if (input.endedPrevious) lines.push("🧾 Closed the previous session.");
      }

      // Mode + persona
      const modeLabel = formatMode(input.effectiveMode);
      const personaLine =
        input.personaDisplayName && input.personaId
          ? `🎭 I’m speaking as **${input.personaDisplayName}** (${input.personaId}).`
          : "🎭 Persona: (unknown)";

      lines.push(`🧭 Mode: **${modeLabel}**.`);
      lines.push(personaLine);

      // Homes
      lines.push(`🏠 Home text: ${input.homeText}`);
      lines.push(`🏠 Home voice: ${input.homeVoice}`);

      // Voice state
      if (input.joinedVoice) {
        lines.push(`🎧 Joined voice: ${input.joinedVoice}`);
      }

      // Notices
      if (input.stayPutNotice) lines.push(`🪨 ${input.stayPutNotice}`);
      if (input.notInVoiceNotice) lines.push(`👀 ${input.notInVoiceNotice}`);

      // Setup summary (if any)
      if (input.setupSummaryLines.length > 0) {
        lines.push("");
        lines.push(...input.setupSummaryLines);
        lines.push(metaMeepoVoice.wake.talkTip());
      }

      // Gentle nudge (only if there were setup issues)
      if (input.setupSummaryLines.some((l) => l.startsWith("⚠️") || l.startsWith("❌"))) {
        lines.push("If you want me to spell it out, `/meepo doctor` can help, meep!");
      }

      return lines;
    },
  },

  status: {
    hintJoinVoice(): string {
      return "Join voice and run /meepo awaken to connect voice.";
    },

    hintEnableTts(): string {
      return "Configure TTS_ENABLED=1 and a non-noop TTS_PROVIDER for /meepo talk.";
    },

    hintSetHomeText(): string {
      return "Set home text by running /meepo awaken in your preferred text channel.";
    },

    snapshot(input: StatusSnapshotInput): string {
      const publicLines = [
        header("Main Status"),
        `State: ${input.lifecycleState}`,
        `Voice: ${input.voiceState}`,
        `Session: ${input.session}`,
        `Campaign: ${input.campaign}`,
        ...(input.campaignDmLines && input.campaignDmLines.length > 0
          ? ["", header("Campaign DMs"), ...input.campaignDmLines]
          : []),
        "",
        "Next step:",
        input.nextStep,
      ];

      if (!input.isDevUser) {
        return publicLines.join("\n");
      }

      const devLines =
        input.devDiagnosticsLines && input.devDiagnosticsLines.length > 0
          ? ["", header("Dev Diagnostics"), ...input.devDiagnosticsLines]
          : [];

      const legacyNotes =
        input.legacyLabNotes && input.legacyLabNotes.length > 0
          ? ["", header("Legacy / Lab Notes"), ...input.legacyLabNotes]
          : [];

      return [...publicLines, ...devLines, ...legacyNotes].join("\n");
    },
  },

  doctor: {
    report(checks: DoctorCheck[]): string {
      const intro = [
        header("Meepo Doctor"),
        "I ran a quick checkup, meep. Here’s what I found:",
        "",
      ];

      const lines = checks.map((item) => {
        const action = item.action?.trim() ? ` — ${item.action.trim()}` : "";
        return `${item.icon} ${item.label}${action}`;
      });

      // A tiny footer nudge, only if there's something to fix.
      const hasFail = checks.some((c) => c.icon === "❌");
      const hasWarn = checks.some((c) => c.icon === "⚠️");

      const footer = truthyLines([
        "",
        hasFail
          ? "Fix the ❌ items and I’ll stop complaining, meep."
          : hasWarn
            ? "You’re fine. I’m just picky."
            : "Clean bill of health, meep. I'M UNSTOPPABLE MEEEP!",
      ]);

      return [...intro, ...lines, ...footer].join("\n");
    },
  },

  sessions: {
    listEmpty(): string {
      return "No sessions found.";
    },

    listLines(
      rows: Array<{ index: number; date: string; label: string; kindTag: string; recapStatus: string }>
    ): string[] {
      return rows.map(
        (row) => `#${row.index + 1} ${row.date} "${row.label}" [${row.kindTag}] recap: ${row.recapStatus}`
      );
    },

    sessionNotFound(): string {
      return "Session not found.";
    },

    unknownAction(): string {
      return "Unknown sessions action.";
    },

    recapMissingCanon(): string {
      return "I only generate recaps for **canon** sessions (and not in lab), meep. If you meant a real session, pick a canon session ID from `/meepo sessions list`.";
    },

    nextActionGenerateBase(sessionId: string, strategy: RecapStyle): string {
      return `Next: Generate recap (builds base) via /meepo sessions recap session:${sessionId} style:${strategy}`;
    },

    nextActionGenerateFinal(sessionId: string, strategy: RecapStyle): string {
      return `Next: Generate final recap (cheap) via /meepo sessions recap session:${sessionId} style:${strategy}`;
    },

    nextActionRegenerate(sessionId: string, strategy: RecapStyle): string {
      return `Next: Regenerate via /meepo sessions recap session:${sessionId} style:${strategy} force:true`;
    },

    recapResult(input: {
      cacheHit: boolean;
      sessionLabel: string;
      strategy: RecapStyle;
      finalVersion: string;
      baseVersion: string;
      sourceHashShort: string;
      previewText: string;
    }): string {
      const top = [
        `${input.cacheHit ? "📦 I already had this one, meep." : "📜 Freshly written, meep."}`,
        `Recap for **"${input.sessionLabel}"**`,
        `Style: **${input.strategy}** (final v${input.finalVersion})`,
        `Base: v${input.baseVersion}`,
        `Source: ${input.sourceHashShort}…`,
      ];

      const preview = input.previewText?.trim()
        ? ["" , header("Preview"), input.previewText.trim()]
        : ["", header("Preview"), "(no preview available)"];

      return [...top, ...preview].join("\n");
    },

    viewLines(input: SessionViewLinesInput): string[] {
      const lines: string[] = [
        header("Session"),
        `ID: ${input.sessionId}`,
        `Label: ${input.label}`,
        `Kind: ${input.kind}`,
        `Started: ${input.startedIso}`,
        `Ended: ${input.endedIso}`,
        "",
        header("Recap memory"),
        `Base: ${input.baseExists ? "✅ cached" : "❌ missing"} (v${input.baseVersion || "?"}, ${shortHash(input.baseHash)})`,
        `Final: ${input.recapExists ? "✅ present" : "❌ missing"} (${input.finalStyle || "—"}, ${input.finalCreatedAt || "—"})`,
        `Final hash: ${shortHash(input.finalHash)}`,
        `Final v${input.finalVersion || "?"} (linked base v${input.linkedBaseVersion || "?"})`,
        "",
        header("Transcript"),
        `Export: ${input.transcriptStatus}`,
      ];

      if (input.dbRowMissingFileNotice) {
        lines.push(
          "",
          "⚠️ I have a DB record for the final recap, but the file is missing. That’s… not good meep.",
          "Run `/meepo sessions recap` to regenerate and repair it."
        );
      }

      if (input.hasUnindexedFilesNotice) {
        lines.push(
          "",
          "⚠️ I found recap file(s) on disk, but they’re not indexed as the canonical final, meep.",
          "If you want them to count, regenerate once to index cleanly."
        );
      }

      if (input.transcriptMissingNotice) {
        lines.push(
          "",
          "⚠️ Transcript export isn’t cached yet, meep. I can still operate, but recaps will be limited.",
        );
      }

      if (input.nextActionLine) {
        lines.push("", `➡️ ${input.nextActionLine}`);
      }

      return lines;
    },
  },

  settings: {
    viewSummary(input: {
      setupVersion: number;
      campaignSlug: string;
      homeTextChannel: string;
      homeVoiceChannel: string;
      dmRole: string;
      dmDisplayName: string;
      defaultTalkMode: string;
      dmUser: string;
      sttPromptCurrent: string;
      awakened: boolean;
      awakenKeys: string;
    }): string {
      const lines = [
        header("Settings"),
        `setup_version: ${input.setupVersion}`,
        `campaign_slug: ${input.campaignSlug}`,
        `home_text_channel: ${input.homeTextChannel}`,
        `home_voice_channel: ${input.homeVoiceChannel}`,
        `dm_role_id: ${input.dmRole}`,
        `dm_display_name (memory): ${input.dmDisplayName}`,
        `default_talk_mode: ${input.defaultTalkMode}`,
        `dm_user_id (read-only): ${input.dmUser}`,
        `stt_prompt_current (read-only): ${input.sttPromptCurrent}`,
        `awakened (read-only): ${input.awakened ? "true" : "false"}`,
        `awaken_keys: ${input.awakenKeys}`,
      ];
      return lines.join("\n");
    },

    setExactlyOneOptionError(): string {
      return "Pick **exactly one** thing to change per call (key+channel, canon_mode, canon_persona, recap_style, home_voice, or dm_user). I’m good, but I’m not telepathic, meep!";
    },

    keyAndChannelMustBePaired(): string {
      return "When using `key`, you must also provide `channel` (and vice versa).";
    },

    unknownPersona(personaId: string): string {
      return `I don’t recognize that persona id: **${personaId}**. (Double-check spelling or run your persona list command.)`;
    },

    updatedCanonMode(mode: CanonPersonaMode): string {
      return mode === "diegetic"
        ? "Canon sessions will use an **in-character** persona. Choose one with `/meepo settings set canon_persona:<id>`."
        : "Canon sessions will use **Meta Meepo**. No diegetic mask required. 😌";
    },

    updatedCanonPersona(personaId: string): string {
      return `Got it meep. Canon persona set to **${personaId}**. I’ll wear it responsibly hehe.`;
    },

    updatedRecapStyle(style: RecapStyle): string {
      return `Default recap style set to **${style}**. (I’m judging you a little. In a professional way... meep.)`;
    },

    updatedHomeVoice(channelRef: string): string {
      return `Home voice set to ${channelRef}. I’ll meet you there when you wake me, meep!`;
    },

    updatedHomeText(channelRef: string): string {
      return `Home text set to ${channelRef}. I’ll report there when you wake me, meep!`;
    },

    selectTextChannel(): string {
      return "Select a text channel.";
    },

    selectVoiceChannel(): string {
      return "Select a voice channel.";
    },

    updatedDmRole(roleId: string): string {
      return `Dungeon Master role set to <@&${roleId}>.`;
    },

    invalidTalkMode(): string {
      return "Talk mode must be hush or talk.";
    },

    updatedTalkMode(mode: "hush" | "talk"): string {
      return `Default talk mode set to **${mode}**.`;
    },

    emptyDmName(): string {
      return "DM name cannot be empty.";
    },

    updatedDmName(): string {
      return "Dungeon Master display name updated.";
    },

    clearedHomeText(): string {
      return "Cleared home text channel.";
    },

    clearedHomeVoice(): string {
      return "Cleared home voice channel.";
    },

    updatedDmUser(dmUserRef: string): string {
      return `Canonical DM identity set to ${dmUserRef}.`;
    },

    clearedDmUser(): string {
      return "Cleared canonical DM identity (dm_user_id).";
    },

    invalidChannelSettingKey(key: string): string {
      return `Unknown settings key: **${key}**. Use "home_text_channel" or "home_voice_channel".`;
    },

    unknownAction(): string {
      return "Unknown settings action.";
    },
  },

  help: {
    summary(): string {
      const lines = [
        header("/meepo Command Help"),
        "",
        "Start a session:",
        "`/meepo showtime start`",
        "",
        "View your sessions:",
        "`https://meepo.online/dashboard`",
        "",
        "`/meepo awaken` — Awaken Meepo and run setup checks.",
        "`/meepo sleep` — Put Meepo to sleep and end the active session.",
        "`/meepo talk` — Enable voice replies (requires awake + connected voice + TTS).",
        "`/meepo hush` — Disable voice replies (listen-only mode).",
        "`/meepo status` — Show state snapshot (mode, persona, voice, recap, hints).",
        "`/meepo doctor` — Run deterministic diagnostics and suggested fixes.",
        "`/meepo sessions list [limit]` — List recent sessions.",
        "`/meepo sessions view <session>` — View session details and cached artifacts.",
        "`/meepo sessions recap <session> [style] [force]` — Generate/regenerate a canon recap.",
        "`/meepo settings show` — Show awakening settings.",
        "`/meepo settings home_text_channel channel:<channel>` — Set home text channel.",
        "`/meepo settings home_voice_channel channel:<channel>` — Set home voice channel.",
        "`/meepo settings dm_role role:<role>` — Set Dungeon Master role.",
        "`/meepo settings talk_mode mode:<hush|talk>` — Set default awaken talk mode.",
        "`/meepo settings dm_name name:<text>` — Set Dungeon Master display name memory.",
      ];
      return lines.join("\n");
    },
  },

  sleep: {
    alreadyAsleep(): string {
      return "Meepo is already asleep.";
    },

    sessionEnded(label: string): string {
      return `🧾 Session ended: "${label}"\nTranscript saved.`;
    },

    asleep(): string {
      return "😴 Meepo is asleep.";
    },
  },

  talk: {
    requiresWake(): string {
      return "Meepo is asleep. Use /meepo awaken first.";
    },

    requiresVoiceConnection(): string {
      return "Meepo is not connected to voice. Use /meepo awaken while you are in voice.";
    },

    ttsUnavailable(providerName: string): string {
      return (
        "TTS is unavailable, staying in hush mode. " +
        `Current provider: ${providerName}. Configure TTS_ENABLED=1 and a non-noop TTS_PROVIDER.`
      );
    },

    enabled(): string {
      return "Talk mode enabled. Meepo can now reply in voice.";
    },
  },

  hush: {
    requiresWake(): string {
      return "Meepo is asleep. Use /meepo awaken first.";
    },

    enabled(): string {
      return "Hush mode enabled. Meepo will stay listen-only.";
    },
  },

  errors: {
    notInGuild(): string {
      return "Meepo only works in a server (not DMs).";
    },

    notAuthorized(): string {
      return "Not authorized.";
    },

    unknownSubcommand(): string {
      return "Unknown subcommand.";
    },

    genericCommandFailure(): string {
      return "Something went wrong.";
    },
  },
};