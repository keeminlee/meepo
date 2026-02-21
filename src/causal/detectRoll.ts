import type { RollType } from "./types.js";

const SKILL_ROLLS: Array<{ type: RollType; patterns: RegExp[] }> = [
  { type: "Acrobatics", patterns: [/\bacrobatics\b/i] },
  { type: "AnimalHandling", patterns: [/\banimal handling\b/i] },
  { type: "Arcana", patterns: [/\barcana\b/i] },
  { type: "Athletics", patterns: [/\bathletics\b/i] },
  { type: "Deception", patterns: [/\bdeception\b/i] },
  { type: "History", patterns: [/\bhistory\b/i] },
  { type: "Insight", patterns: [/\binsight\b/i] },
  { type: "Intimidation", patterns: [/\bintimidation\b/i] },
  { type: "Investigation", patterns: [/\binvestigation\b/i] },
  { type: "Medicine", patterns: [/\bmedicine\b/i] },
  { type: "Nature", patterns: [/\bnature\b/i] },
  { type: "Perception", patterns: [/\bperception\b/i] },
  { type: "Performance", patterns: [/\bperformance\b/i] },
  { type: "Persuasion", patterns: [/\bpersuasion\b/i] },
  { type: "Religion", patterns: [/\breligion\b/i] },
  { type: "SleightOfHand", patterns: [/\bsleight of hand\b/i] },
  { type: "Stealth", patterns: [/\bstealth\b/i] },
  { type: "Survival", patterns: [/\bsurvival\b/i] },
];

export function detectRollType(text: string): {
  roll_type: RollType;
  roll_subtype?: string | null;
} {
  const lower = text.toLowerCase();

  if (/\broll(ing)?\s+for\s+initiative\b/i.test(text) || /\binitiative\b/i.test(text)) {
    return { roll_type: "Initiative", roll_subtype: null };
  }

  if (/\battack roll\b/i.test(text) || /\bto hit\b/i.test(text)) {
    return { roll_type: "AttackRoll", roll_subtype: null };
  }

  if (/\broll\b.*\bdamage\b/i.test(text) || /\bdamage roll\b/i.test(text)) {
    return { roll_type: "DamageRoll", roll_subtype: null };
  }

  const saveMatch = /(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+saving throw/i.exec(
    lower
  );
  if (saveMatch) {
    const ability = saveMatch[1];
    const label = ability.charAt(0).toUpperCase() + ability.slice(1);
    return { roll_type: "SavingThrow", roll_subtype: label };
  }

  for (const skill of SKILL_ROLLS) {
    if (skill.patterns.some((pattern) => pattern.test(text))) {
      return { roll_type: skill.type, roll_subtype: null };
    }
  }

  // Removed generic 'roll' catch-all to prevent false positives
  // Only explicit roll requests (skill checks, saves, attacks) count as consequences

  return { roll_type: null, roll_subtype: null };
}
