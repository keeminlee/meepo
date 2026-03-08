type StatusChipTone = "neutral" | "success" | "warning" | "danger" | "info";

const TONE_STYLES: Record<StatusChipTone, string> = {
  neutral: "border-border/60 bg-background/40 text-muted-foreground",
  success: "border-emerald-400/35 bg-emerald-400/10 text-emerald-300",
  warning: "border-amber-400/35 bg-amber-400/10 text-amber-300",
  danger: "border-rose-400/35 bg-rose-400/10 text-rose-300",
  info: "border-sky-400/35 bg-sky-400/10 text-sky-300",
};

type StatusChipProps = {
  label: string;
  tone?: StatusChipTone;
};

export function StatusChip({ label, tone = "neutral" }: StatusChipProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${TONE_STYLES[tone]}`}
    >
      {label}
    </span>
  );
}