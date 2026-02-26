import type { CompiledEvent, EventSpanValidation } from "./types.js";

export function validateEventSpans(events: CompiledEvent[], totalEntries: number): EventSpanValidation {
  const issues: string[] = [];

  if (events.length === 0) {
    issues.push("No events extracted from transcript");
    return { isValid: false, issues };
  }

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    if (event.start_index < 0 || event.start_index >= totalEntries) {
      issues.push(
        `Event ${i} \"${event.title}\": start_index ${event.start_index} out of bounds [0, ${totalEntries - 1}]`,
      );
    }

    if (event.end_index < 0 || event.end_index >= totalEntries) {
      issues.push(
        `Event ${i} \"${event.title}\": end_index ${event.end_index} out of bounds [0, ${totalEntries - 1}]`,
      );
    }

    if (event.end_index < event.start_index) {
      issues.push(
        `Event ${i} \"${event.title}\": end_index ${event.end_index} is before start_index ${event.start_index}`,
      );
    }
  }

  if (issues.length > 0) {
    return { isValid: false, issues };
  }

  for (let i = 1; i < events.length; i++) {
    if (events[i].start_index <= events[i - 1].start_index) {
      issues.push(
        `Events ${i - 1} and ${i} not in ascending order: event ${i} starts at ${events[i].start_index} after event ${i - 1} starts at ${events[i - 1].start_index}`,
      );
    }
  }

  for (let i = 0; i < events.length - 1; i++) {
    if (events[i].end_index >= events[i + 1].start_index) {
      issues.push(
        `Events ${i} and ${i + 1} overlap: event ${i} (${events[i].start_index}-${events[i].end_index}) overlaps with event ${i + 1} (${events[i + 1].start_index}-${events[i + 1].end_index})`,
      );
    }
  }

  for (let i = 0; i < events.length - 1; i++) {
    const gap = events[i + 1].start_index - events[i].end_index - 1;
    if (gap > 0) {
      issues.push(
        `⚠️  Gap: ${gap} message(s) between event ${i} (ends at ${events[i].end_index}) and event ${i + 1} (starts at ${events[i + 1].start_index})`,
      );
    }
  }

  return {
    isValid: !issues.some((issue) => !issue.startsWith("⚠️")),
    issues,
  };
}
