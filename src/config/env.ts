import "dotenv/config";
import path from "node:path";
import type { BargeInMode, Config, LogFormat, LogLevel, MeepoMode, SttProvider, TtsProvider } from "./types.js";
import { redactConfigSnapshot } from "./redact.js";

function req(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function optAny(names: string[]): string | undefined {
  for (const name of names) {
    const v = opt(name);
    if (v) return v;
  }
  return undefined;
}

function optInt(name: string, def: number): number {
  const v = opt(name);
  if (!v) return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${name}: ${v}`);
  return n;
}

function optFloat(name: string, def: number): number {
  const v = opt(name);
  if (!v) return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${name}: ${v}`);
  return n;
}

function optBool(name: string, def: boolean): boolean {
  const v = opt(name);
  if (!v) return def;
  if (["1", "true", "yes", "on"].includes(v.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(v.toLowerCase())) return false;
  throw new Error(`Invalid boolean for ${name}: ${v}`);
}

function enumOf<T extends string>(name: string, allowed: readonly T[], def: T): T {
  const v = opt(name);
  if (!v) return def;
  if ((allowed as readonly string[]).includes(v)) return v as T;
  throw new Error(`Invalid value for ${name}: ${v}. Allowed: ${allowed.join(", ")}`);
}

// Deprecated keys: keep list, warn once if present
const DEPRECATED: Record<string, string> = {
  DEBUG_VOICE: "Use LOG_LEVEL=debug with LOG_SCOPES filters instead.",
  DEBUG_LATCH: "Use LOG_LEVEL=debug with LOG_SCOPES=latch instead.",
  DB_PATH: "Use DATA_DB_PATH.",
  TTS_MAX_CHARS_PER_CHUNK: "Use TTS_CHUNK_SIZE_CHARS.",
  FFMPEG_BIN: "Use FFMPEG_PATH.",
};

let deprecatedEnvWarned = false;

function warnDeprecatedEnv(): void {
  if (deprecatedEnvWarned) return;
  deprecatedEnvWarned = true;
  for (const [key, msg] of Object.entries(DEPRECATED)) {
    if (process.env[key] != null) {
      console.warn(`[config] DEPRECATED env var detected: ${key}. ${msg}`);
    }
  }
}

export function loadConfig(): Config {
  warnDeprecatedEnv();

  const loggingLevel = enumOf<LogLevel>("LOG_LEVEL", ["error", "warn", "info", "debug", "trace"] as const, "info");
  const voiceDebug = optBool("DEBUG_VOICE", false) || loggingLevel === "debug" || loggingLevel === "trace";

  const dataRoot = opt("DATA_ROOT") ?? "./data";
  const campaignsDir = opt("DATA_CAMPAIGNS_DIR") ?? "campaigns";
  const dbFilename = opt("DATA_DB_FILENAME") ?? "db.sqlite";
  const explicitDbPath = opt("DATA_DB_PATH");

  if (explicitDbPath) {
    const normalized = path.normalize(explicitDbPath).toLowerCase();
    if (!normalized.includes(`${path.sep}campaigns${path.sep}`)) {
      console.warn(
        `[config] DATA_DB_PATH is set to '${explicitDbPath}', bypassing campaign data topology.`
      );
    }
  }

  const cfg: Config = {
    mode: enumOf<MeepoMode>("MEEPO_MODE", ["canon", "ambient", "lab", "dormant"] as const, "ambient"),

    discord: {
      token: req("DISCORD_TOKEN"),
      dmRoleId: opt("DM_ROLE_ID"),
      clientId: opt("DISCORD_CLIENT_ID"),
      guildId: opt("GUILD_ID"),
      botPrefix: opt("BOT_PREFIX") ?? "meepo:",
    },

    openai: {
      apiKey: req("OPENAI_API_KEY"),
    },

    db: {
      path: optAny(["DATA_DB_PATH", "DB_PATH"]) ?? "./data/bot.sqlite",
      filename: dbFilename,
    },

    data: {
      root: dataRoot,
      campaignsDir,
    },

    session: {
      autoSleepMs: optInt("MEEPO_AUTO_SLEEP_MS", 600000),
      announcementChannelId: opt("ANNOUNCEMENT_CHANNEL_ID"),
      meecapMode: opt("MEECAP_MODE") ?? "narrative",
    },

    llm: {
      enabled: optBool("LLM_ENABLED", true),
      model: opt("LLM_MODEL") ?? "gpt-4o-mini",
      temperature: optFloat("LLM_TEMPERATURE", 0.3),
      maxTokens: optInt("LLM_MAX_TOKENS", 200),
      voiceContextMs: optInt("LLM_VOICE_CONTEXT_MS", 120000),
    },

    overlay: {
      port: optInt("OVERLAY_PORT", 7777),
      voiceChannelId: opt("OVERLAY_VOICE_CHANNEL_ID"),
      homeVoiceChannelId: opt("MEEPO_HOME_VOICE_CHANNEL_ID"),
    },

    voice: {
      chunkSizeMs: optInt("VOICE_CHUNK_SIZE_MS", 60000),
      silenceThresholdDb: optInt("VOICE_SILENCE_THRESHOLD_DB", -40),
      endSilenceMs: optInt("VOICE_END_SILENCE_MS", 700),
      replyCooldownMs: optInt("VOICE_REPLY_COOLDOWN_MS", 5000),
      bargeInMode: enumOf<BargeInMode>("BARGE_IN_MODE", ["immediate", "micro_confirm"] as const, "immediate"),
      microConfirmMs: optInt("MICRO_CONFIRM_MS", 60),
      microConfirmFrames: optInt("MICRO_CONFIRM_FRAMES", 2),
      debug: voiceDebug,
    },

    stt: {
      provider: enumOf<SttProvider>("STT_PROVIDER", ["openai", "noop", "debug"] as const, "openai"),
      saveAudio: optBool("STT_SAVE_AUDIO", false),
      model: opt("STT_OPENAI_MODEL") ?? "gpt-4o-mini-transcribe",
      language: opt("STT_LANGUAGE") ?? "en",
      prompt: opt("STT_PROMPT"),
      minAudioMs: optInt("STT_MIN_AUDIO_MS", 300),
      minActiveRatio: optFloat("STT_MIN_ACTIVE_RATIO", 0.35),
      noSpeechProbMax: optFloat("STT_NO_SPEECH_PROB_MAX", 0.6),
    },

    tts: {
      provider: enumOf<TtsProvider>("TTS_PROVIDER", ["openai", "noop"] as const, "noop"),
      enabled: optBool("TTS_ENABLED", true),
      chunkSizeChars: optInt("TTS_CHUNK_SIZE_CHARS", optInt("TTS_MAX_CHARS_PER_CHUNK", 350)),
      model: opt("TTS_OPENAI_MODEL") ?? "gpt-4o-mini-tts",
      voice: opt("TTS_VOICE") ?? "alloy",
    },

    audioFx: {
      enabled: optBool("AUDIO_FX_ENABLED", false),
      pitch: optFloat("AUDIO_FX_PITCH", 1.0),
      reverb: {
        enabled: optBool("AUDIO_FX_REVERB", false),
        wet: optFloat("AUDIO_FX_REVERB_WET", 0.3),
        roomMs: optInt("AUDIO_FX_REVERB_ROOM_MS", 100),
        damping: optFloat("AUDIO_FX_REVERB_DAMPING", 0.7),
        delayMs: optInt("AUDIO_FX_REVERB_DELAY_MS", 20),
        decay: optFloat("AUDIO_FX_REVERB_DECAY", 0.4),
      },
      ffmpegPath: optAny(["FFMPEG_PATH", "FFMPEG_BIN"]),
    },

    features: {
      memoryEnabled: optBool("MEEPO_MEMORY_ENABLED", true),
      goldMemoryEnabled: optBool("GOLD_MEMORY_ENABLED", false),
    },

    logging: {
      level: loggingLevel,
      scopes: opt("LOG_SCOPES")?.split(",").map((s) => s.trim()).filter(Boolean),
      format: enumOf<LogFormat>("LOG_FORMAT", ["pretty", "json"] as const, "pretty"),
      debugLatch: optBool("DEBUG_LATCH", false),
    },
  };

  return cfg;
}

export function printConfigSnapshot(cfg: Config): void {
  const snap = redactConfigSnapshot({
    MEEPO_MODE: cfg.mode,
    DISCORD_TOKEN: "<redacted>",
    DM_ROLE_ID: cfg.discord.dmRoleId,
    DISCORD_CLIENT_ID: cfg.discord.clientId,
    GUILD_ID: cfg.discord.guildId,
    BOT_PREFIX: cfg.discord.botPrefix,
    OPENAI_API_KEY: "<redacted>",
    DATA_DB_PATH: cfg.db.path,
    DATA_DB_FILENAME: cfg.db.filename,
    DATA_ROOT: cfg.data.root,
    DATA_CAMPAIGNS_DIR: cfg.data.campaignsDir,
    MEEPO_AUTO_SLEEP_MS: cfg.session.autoSleepMs,
    ANNOUNCEMENT_CHANNEL_ID: cfg.session.announcementChannelId,
    MEECAP_MODE: cfg.session.meecapMode,
    LLM_ENABLED: cfg.llm.enabled,
    LLM_MODEL: cfg.llm.model,
    LLM_TEMPERATURE: cfg.llm.temperature,
    LLM_MAX_TOKENS: cfg.llm.maxTokens,
    LLM_VOICE_CONTEXT_MS: cfg.llm.voiceContextMs,
    OVERLAY_PORT: cfg.overlay.port,
    OVERLAY_VOICE_CHANNEL_ID: cfg.overlay.voiceChannelId,
    MEEPO_HOME_VOICE_CHANNEL_ID: cfg.overlay.homeVoiceChannelId,
    VOICE_CHUNK_SIZE_MS: cfg.voice.chunkSizeMs,
    VOICE_SILENCE_THRESHOLD_DB: cfg.voice.silenceThresholdDb,
    VOICE_END_SILENCE_MS: cfg.voice.endSilenceMs,
    VOICE_REPLY_COOLDOWN_MS: cfg.voice.replyCooldownMs,
    BARGE_IN_MODE: cfg.voice.bargeInMode,
    MICRO_CONFIRM_MS: cfg.voice.microConfirmMs,
    MICRO_CONFIRM_FRAMES: cfg.voice.microConfirmFrames,
    DEBUG_VOICE: cfg.voice.debug,
    STT_PROVIDER: cfg.stt.provider,
    STT_SAVE_AUDIO: cfg.stt.saveAudio,
    STT_OPENAI_MODEL: cfg.stt.model,
    STT_LANGUAGE: cfg.stt.language,
    STT_PROMPT: cfg.stt.prompt,
    STT_MIN_AUDIO_MS: cfg.stt.minAudioMs,
    STT_MIN_ACTIVE_RATIO: cfg.stt.minActiveRatio,
    STT_NO_SPEECH_PROB_MAX: cfg.stt.noSpeechProbMax,
    TTS_PROVIDER: cfg.tts.provider,
    TTS_ENABLED: cfg.tts.enabled,
    TTS_CHUNK_SIZE_CHARS: cfg.tts.chunkSizeChars,
    TTS_OPENAI_MODEL: cfg.tts.model,
    TTS_VOICE: cfg.tts.voice,
    AUDIO_FX_ENABLED: cfg.audioFx.enabled,
    AUDIO_FX_PITCH: cfg.audioFx.pitch,
    AUDIO_FX_REVERB: cfg.audioFx.reverb.enabled,
    AUDIO_FX_REVERB_WET: cfg.audioFx.reverb.wet,
    AUDIO_FX_REVERB_ROOM_MS: cfg.audioFx.reverb.roomMs,
    AUDIO_FX_REVERB_DAMPING: cfg.audioFx.reverb.damping,
    AUDIO_FX_REVERB_DELAY_MS: cfg.audioFx.reverb.delayMs,
    AUDIO_FX_REVERB_DECAY: cfg.audioFx.reverb.decay,
    FFMPEG_PATH: cfg.audioFx.ffmpegPath,
    MEEPO_MEMORY_ENABLED: cfg.features.memoryEnabled,
    GOLD_MEMORY_ENABLED: cfg.features.goldMemoryEnabled,
    LOG_LEVEL: cfg.logging.level,
    LOG_SCOPES: cfg.logging.scopes?.join(",") ?? "",
    LOG_FORMAT: cfg.logging.format,
  });

  console.log("=== MEEPO CONFIG SNAPSHOT ===");
  console.log(JSON.stringify(snap, null, 2));
  console.log("=============================");
}

export const cfg = loadConfig();
