/**
 * Centralized logging system for Meepo.
 *
 * Environment Variables:
 *   LOG_LEVEL=error|warn|info|debug|trace  (default: info)
 *   LOG_SCOPES=voice,stt,tts,ledger,meepo,overlay,meeps,voice-reply,boot,db,session
 *      (optional, default: all scopes allowed)
 *   LOG_FORMAT=pretty|json  (default: pretty)
 *
 * Example Usage:
 *   LOG_LEVEL=debug LOG_SCOPES=voice,voice-reply  node bot.js
 *   LOG_LEVEL=warn  node bot.js  // Only warnings and errors
 *
 * Legacy Compatibility:
 *   DEBUG_VOICE=true  →  Sets LOG_LEVEL=debug and LOG_SCOPES includes 'voice'
 *      (emits one-time deprecation warning)
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";
export type LogScope =
  | "voice"
  | "stt"
  | "tts"
  | "ledger"
  | "llm"
  | "db"
  | "session"
  | "boot"
  | "meepo"
  | "meepo-mind"
  | "overlay"
  | "meeps"
  | "voice-reply"
  | "audio-fx"
  | string;

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  scope?: string;
  message: string;
  data?: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

class Logger {
  private level: number;
  private scopes: Set<string>;
  private format: "pretty" | "json";
  private deprecationWarnings: Set<string> = new Set();

  constructor() {
    // Parse LOG_LEVEL (default: info)
    const logLevelEnv = (process.env.LOG_LEVEL ?? "info").toLowerCase();
    if (logLevelEnv in LOG_LEVELS) {
      this.level = LOG_LEVELS[logLevelEnv as LogLevel];
    } else {
      this.level = LOG_LEVELS.info;
    }

    // Parse LOG_SCOPES (default: all scopes allowed)
    const logScopesEnv = process.env.LOG_SCOPES ?? "";
    this.scopes = new Set(
      logScopesEnv
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s)
    );

    // Parse LOG_FORMAT (default: pretty)
    this.format = (process.env.LOG_FORMAT ?? "pretty") as "pretty" | "json";

    // Legacy compatibility: DEBUG_VOICE → LOG_LEVEL=debug, LOG_SCOPES+=voice
    if (process.env.DEBUG_VOICE === "true") {
      this.emitDeprecationWarning(
        "DEBUG_VOICE",
        'Set LOG_LEVEL=debug and LOG_SCOPES=voice instead'
      );
      this.level = Math.min(this.level, LOG_LEVELS.debug);

      // Add "voice" to scopes if scopes were empty (all allowed)
      if (this.scopes.size === 0) {
        // Empty scopes means all are allowed, so we don't add "voice"
      } else {
        this.scopes.add("voice");
      }
    }
  }

  private emitDeprecationWarning(oldVar: string, replacement: string): void {
    if (this.deprecationWarnings.has(oldVar)) return;
    this.deprecationWarnings.add(oldVar);
    console.warn(
      `[Logger] DEPRECATED: ${oldVar} is deprecated. ${replacement}`
    );
  }

  private shouldLog(level: LogLevel, scope?: string): boolean {
    // Check level
    if (LOG_LEVELS[level] < this.level) return false;

    // Check scope: if scopes are set, only log if scope matches
    if (this.scopes.size > 0 && scope && !this.scopes.has(scope)) {
      return false;
    }

    return true;
  }

  private formatOutput(entry: LogEntry): string {
    if (this.format === "json") {
      return JSON.stringify(entry);
    }

    // Pretty format with better visual hierarchy
    const time = entry.timestamp.split("T")[1].split(".")[0]; // HH:MM:SS
    const levelAbbr = {
      trace: "TRC",
      debug: "DBG",
      info: "INF",
      warn: "WRN",
      error: "ERR",
    }[entry.level];
    const scopeStr = entry.scope ? ` │ ${entry.scope}` : "";
    const dataStr = entry.data ? ` │ ${JSON.stringify(entry.data)}` : "";

    return `${time} [${levelAbbr}]${scopeStr} ${entry.message}${dataStr}`;
  }

  private getTimestamp(): string {
    return new Date().toISOString();
  }

  private emit(entry: LogEntry): void {
    const output = this.formatOutput(entry);

    switch (entry.level) {
      case "error":
        console.error(output);
        break;
      case "warn":
        console.warn(output);
        break;
      case "info":
        console.log(output);
        break;
      case "debug":
        console.log(output);
        break;
      case "trace":
        console.debug(output);
        break;
    }
  }

  trace(message: string, scope?: LogScope, data?: unknown): void {
    if (this.shouldLog("trace", scope)) {
      this.emit({
        timestamp: this.getTimestamp(),
        level: "trace",
        scope,
        message,
        data,
      });
    }
  }

  debug(message: string, scope?: LogScope, data?: unknown): void {
    if (this.shouldLog("debug", scope)) {
      this.emit({
        timestamp: this.getTimestamp(),
        level: "debug",
        scope,
        message,
        data,
      });
    }
  }

  info(message: string, scope?: LogScope, data?: unknown): void {
    if (this.shouldLog("info", scope)) {
      this.emit({
        timestamp: this.getTimestamp(),
        level: "info",
        scope,
        message,
        data,
      });
    }
  }

  warn(message: string, scope?: LogScope, data?: unknown): void {
    if (this.shouldLog("warn", scope)) {
      this.emit({
        timestamp: this.getTimestamp(),
        level: "warn",
        scope,
        message,
        data,
      });
    }
  }

  error(message: string, scope?: LogScope, data?: unknown): void {
    if (this.shouldLog("error", scope)) {
      this.emit({
        timestamp: this.getTimestamp(),
        level: "error",
        scope,
        message,
        data,
      });
    }
  }

  /**
   * Create a scoped logger that automatically includes a scope in all messages.
   * Usage: const voiceLog = log.withScope("voice");
   *        voiceLog.debug("message") -> logs with scope="voice"
   */
  withScope(scope: LogScope): ScopedLogger {
    return new ScopedLogger(this, scope);
  }
}

/**
 * A logger bound to a specific scope.
 * All messages automatically include the scope.
 */
class ScopedLogger {
  constructor(
    private logger: Logger,
    private scope: LogScope
  ) {}

  trace(message: string, data?: unknown): void {
    this.logger.trace(message, this.scope, data);
  }

  debug(message: string, data?: unknown): void {
    this.logger.debug(message, this.scope, data);
  }

  info(message: string, data?: unknown): void {
    this.logger.info(message, this.scope, data);
  }

  warn(message: string, data?: unknown): void {
    this.logger.warn(message, this.scope, data);
  }

  error(message: string, data?: unknown): void {
    this.logger.error(message, this.scope, data);
  }
}

// Export singleton instance
export const log = new Logger();
export default log;
