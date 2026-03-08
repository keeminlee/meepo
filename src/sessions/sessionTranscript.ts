import { getDbForCampaign } from "../db.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { buildTranscript, type TranscriptEntry, type TranscriptView } from "../ledger/transcripts.js";
import { getSessionById } from "./sessions.js";

export type SessionTranscriptLine = {
  lineIndex: number;
  speaker: string;
  text: string;
  timestampMs: number;
};

export type SessionTranscript = {
  guildId: string;
  campaignSlug: string;
  sessionId: string;
  lineCount: number;
  lines: SessionTranscriptLine[];
};

export type GetSessionTranscriptArgs = {
  guildId: string;
  sessionId: string;
  view?: TranscriptView;
  primaryOnly?: boolean;
};

function toSessionTranscriptLine(entry: TranscriptEntry): SessionTranscriptLine {
  return {
    lineIndex: entry.line_index,
    speaker: entry.author_name,
    text: entry.content,
    timestampMs: entry.timestamp_ms,
  };
}

export function getSessionTranscript(args: GetSessionTranscriptArgs): SessionTranscript {
  const campaignSlug = resolveCampaignSlug({ guildId: args.guildId });
  const db = getDbForCampaign(campaignSlug);
  const session = getSessionById(args.guildId, args.sessionId);

  if (!session) {
    throw new Error(`Session not found: ${args.sessionId}`);
  }

  const transcript = buildTranscript(
    args.sessionId,
    {
      view: args.view ?? "auto",
      primaryOnly: args.primaryOnly ?? true,
    },
    db
  );

  return {
    guildId: args.guildId,
    campaignSlug,
    sessionId: args.sessionId,
    lineCount: transcript.length,
    lines: transcript.map(toSessionTranscriptLine),
  };
}
