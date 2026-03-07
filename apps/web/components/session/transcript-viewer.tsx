import type { TranscriptEntry } from "@/lib/types";

type TranscriptViewerProps = {
  entries: TranscriptEntry[];
};

export function TranscriptViewer({ entries }: TranscriptViewerProps) {
  return (
    <div className="rounded-2xl card-glass">
      <div className="border-b border-border px-6 py-4">
        <h3 className="font-serif text-lg">Transcript</h3>
        <p className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">Search hook placeholder</p>
      </div>
      <div className="custom-scrollbar max-h-[600px] space-y-5 overflow-y-auto p-6">
        {entries.map((entry) => (
          <article key={entry.id} className="group space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">{entry.speaker}</span>
              <span className="text-[10px] text-muted-foreground/50">{entry.timestamp}</span>
            </div>
            <p className="border-l border-border/60 pl-4 text-sm leading-relaxed text-foreground/85">
              {entry.text}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
