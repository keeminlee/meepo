"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { StatusChip } from "@/components/shared/status-chip";
import type { TranscriptEntry } from "@/lib/types";

type TranscriptViewerProps = {
  entries: TranscriptEntry[];
  sessionId: string;
  sessionTitle: string;
  campaignSlug: string;
  status?: "available" | "missing" | "unavailable";
  warnings?: string[];
};

const CHUNK_SIZE = 300;

function triggerDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function toTranscriptTxt(args: {
  entries: TranscriptEntry[];
  sessionId: string;
  sessionTitle: string;
  campaignSlug: string;
}): string {
  const title = args.sessionTitle.trim().length > 0 ? args.sessionTitle : "Untitled Session";
  const header = [
    `Session: ${title}`,
    `Session ID: ${args.sessionId}`,
    `Campaign: ${args.campaignSlug}`,
    "",
  ];

  const lines = args.entries.map((entry) => `[${entry.timestamp}] ${entry.speaker}: ${entry.text}`);
  return [...header, ...lines].join("\n");
}

export function TranscriptViewer({
  entries,
  sessionId,
  sessionTitle,
  campaignSlug,
  status = "available",
  warnings = [],
}: TranscriptViewerProps) {
  const [visibleCount, setVisibleCount] = useState(CHUNK_SIZE);
  const visibleEntries = useMemo(() => entries.slice(0, visibleCount), [entries, visibleCount]);
  const hasMore = visibleCount < entries.length;
  const transcriptBaseName = `${campaignSlug}-${sessionId}-transcript`;

  return (
    <div className="rounded-2xl card-glass">
      <div className="space-y-2 border-b border-border px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-serif text-lg">Transcript</h3>
          <div className="flex items-center gap-2">
            <StatusChip label={`${entries.length} lines`} tone="info" />
            <button
              type="button"
              onClick={() =>
                triggerDownload(
                  `${transcriptBaseName}.txt`,
                  toTranscriptTxt({ entries, sessionId, sessionTitle, campaignSlug }),
                  "text/plain;charset=utf-8"
                )
              }
              disabled={entries.length === 0}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </button>
          </div>
        </div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          {status === "available" ? "Transcript ready" : `Transcript ${status}`}
        </p>
        {warnings.length > 0 ? <p className="text-xs text-amber-200/90">Warnings: {warnings[0]}</p> : null}
      </div>
      <div className="custom-scrollbar max-h-[70vh] space-y-5 overflow-y-auto p-6">
        {visibleEntries.map((entry) => (
          <article key={entry.id} className="group space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">{entry.speaker}</span>
              <span className="text-[10px] text-muted-foreground/50">{entry.timestamp}</span>
            </div>
            <p className="border-l border-border/60 pl-4 text-sm leading-relaxed break-words text-foreground/85">
              {entry.text}
            </p>
          </article>
        ))}
        {hasMore ? (
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setVisibleCount((current) => Math.min(current + CHUNK_SIZE, entries.length))}
              className="w-full rounded-full border border-border bg-background/35 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              Load {Math.min(CHUNK_SIZE, entries.length - visibleCount)} more lines
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
