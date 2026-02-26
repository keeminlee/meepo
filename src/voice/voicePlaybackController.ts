import { randomUUID } from "node:crypto";
import { cfg } from "../config/env.js";
import { log } from "../utils/logger.js";
import { logSystemEvent } from "../ledger/system.js";

type BargeInMode = "immediate" | "micro_confirm";

type VoicePlaybackState = {
  isSpeaking: boolean;
  currentPlaybackId: string | null;
  abortController: AbortController | null;
  pendingMicroConfirmTimer: NodeJS.Timeout | null;
};

type PlaybackContext = {
  playbackId: string;
  signal: AbortSignal;
  isCurrent: () => boolean;
};

type AbortMeta = {
  channelId?: string;
  authorId?: string;
  authorName?: string;
  phrase?: string;
  source?: "voice" | "text" | "command" | "system";
  logSystemEvent?: boolean;
};

type AbortHandler = (reason: string) => void;

const voiceLog = log.withScope("voice");

class VoicePlaybackController {
  private readonly states = new Map<string, VoicePlaybackState>();
  private readonly abortHandlers = new Map<string, AbortHandler>();

  private getState(guildId: string): VoicePlaybackState {
    const existing = this.states.get(guildId);
    if (existing) return existing;

    const created: VoicePlaybackState = {
      isSpeaking: false,
      currentPlaybackId: null,
      abortController: null,
      pendingMicroConfirmTimer: null,
    };
    this.states.set(guildId, created);
    return created;
  }

  public registerAbortHandler(guildId: string, handler: AbortHandler): void {
    this.abortHandlers.set(guildId, handler);
  }

  public unregisterAbortHandler(guildId: string): void {
    this.abortHandlers.delete(guildId);
  }

  public getIsSpeaking(guildId: string): boolean {
    return this.getState(guildId).isSpeaking;
  }

  public setIsSpeaking(guildId: string, speaking: boolean): void {
    this.getState(guildId).isSpeaking = speaking;
  }

  public isCurrentPlayback(guildId: string, playbackId: string): boolean {
    return this.getState(guildId).currentPlaybackId === playbackId;
  }

  public clearPlayback(guildId: string, playbackId: string): void {
    const state = this.getState(guildId);
    if (state.currentPlaybackId !== playbackId) {
      return;
    }

    state.currentPlaybackId = null;
    state.abortController = null;
    state.isSpeaking = false;
  }

  public async speak(guildId: string, play: (ctx: PlaybackContext) => Promise<void>): Promise<void> {
    const state = this.getState(guildId);
    const playbackId = randomUUID();
    const abortController = new AbortController();

    state.currentPlaybackId = playbackId;
    state.abortController = abortController;

    try {
      await play({
        playbackId,
        signal: abortController.signal,
        isCurrent: () => this.isCurrentPlayback(guildId, playbackId),
      });
    } finally {
      this.clearPlayback(guildId, playbackId);
    }
  }

  public abort(guildId: string, reason: string, meta?: AbortMeta): void {
    const state = this.getState(guildId);

    if (state.pendingMicroConfirmTimer) {
      clearTimeout(state.pendingMicroConfirmTimer);
      state.pendingMicroConfirmTimer = null;
    }

    state.abortController?.abort();
    state.abortController = null;
    state.currentPlaybackId = null;
    state.isSpeaking = false;

    const handler = this.abortHandlers.get(guildId);
    if (handler) {
      try {
        handler(reason);
      } catch (err) {
        voiceLog.error(`Abort handler failed`, { err, guildId, reason });
      }
    }

    if (meta?.logSystemEvent && meta.channelId) {
      logSystemEvent({
        guildId,
        channelId: meta.channelId,
        eventType: "voice_interrupt",
        content: `Voice playback interrupted (${reason})${meta.phrase ? `: ${meta.phrase}` : ""}`,
        authorId: meta.authorId ?? "system",
        authorName: meta.authorName ?? "System",
        narrativeWeight: "secondary",
      });
    }
  }

  public onUserSpeechStart(guildId: string, meta?: AbortMeta): boolean {
    if (!this.getIsSpeaking(guildId)) {
      return false;
    }

    const state = this.getState(guildId);
    const mode: BargeInMode = cfg.voice.bargeInMode;

    if (mode === "micro_confirm") {
      if (state.pendingMicroConfirmTimer) {
        clearTimeout(state.pendingMicroConfirmTimer);
      }

      state.pendingMicroConfirmTimer = setTimeout(() => {
        state.pendingMicroConfirmTimer = null;
        if (this.getIsSpeaking(guildId)) {
          this.abort(guildId, "user_speech_override", meta);
        }
      }, cfg.voice.microConfirmMs);
      return true;
    }

    this.abort(guildId, "user_speech_override", meta);
    return true;
  }

  public resetGuild(guildId: string): void {
    const state = this.states.get(guildId);
    if (!state) return;

    if (state.pendingMicroConfirmTimer) {
      clearTimeout(state.pendingMicroConfirmTimer);
    }

    this.abortHandlers.delete(guildId);
    this.states.delete(guildId);
  }
}

export const voicePlaybackController = new VoicePlaybackController();
