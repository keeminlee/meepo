export function prettifyCampaignSlug(campaignSlug: string): string {
  return campaignSlug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatSessionDisplayTitle(args: {
  label: string | null | undefined;
  sessionId: string;
}): string {
  const label = args.label?.trim();
  if (label) return label;
  return `Session ${args.sessionId.slice(0, 8)}`;
}
