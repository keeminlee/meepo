export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";
export type LogFormat = "pretty" | "json";

export type SttProvider = "openai" | "noop" | "debug";
export type TtsProvider = "openai" | "noop";

export type MeepoMode = "canon" | "ambient" | "lab" | "dormant";

export interface Config {
  mode: MeepoMode;

  discord: {
    token: string;
    dmRoleId?: string;
    clientId?: string;
    guildId?: string;
    botPrefix: string;
  };

  openai: {
    apiKey: string;
  };

  db: {
    path: string;
    filename: string;
  };

  data: {
    root: string;
    campaignsDir: string;
  };

  session: {
    autoSleepMs: number; // 0 disables
    announcementChannelId?: string;
    meecapMode: string;
  };

  llm: {
    enabled: boolean;
    model: string;
    temperature: number;
    maxTokens: number;
    voiceContextMs: number;
  };

  overlay: {
    port: number;
    voiceChannelId?: string;
    homeVoiceChannelId?: string;
  };

  voice: {
    chunkSizeMs: number;
    silenceThresholdDb: number;
    endSilenceMs: number;
    replyCooldownMs: number;
    debug: boolean;
  };

  stt: {
    provider: SttProvider;
    saveAudio: boolean;
    model: string;
    language: string;
    prompt?: string;
  };

  tts: {
    provider: TtsProvider;
    enabled: boolean;
    chunkSizeChars: number;
    model: string;
    voice: string;
  };

  audioFx: {
    enabled: boolean;
    pitch: number;
    reverb: {
      enabled: boolean;
      wet: number;
      roomMs: number;
      damping: number;
      delayMs: number;
      decay: number;
    };
    ffmpegPath?: string;
  };

  features: {
    memoryEnabled: boolean;
    goldMemoryEnabled: boolean;
  };

  logging: {
    level: LogLevel;
    scopes?: string[]; // empty/undefined => all
    format: LogFormat;
    debugLatch: boolean;
  };
}
