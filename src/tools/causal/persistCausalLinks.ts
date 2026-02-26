import { getDb } from "../../db.js";
import { CAUSAL_KERNEL_VERSION } from "../../causal/extractCausalLinksKernel.js";
import type { CausalLink } from "../../causal/types.js";

export interface PersistCausalLinksOptions {
  kernelVersion?: string;
  kernelParams?: unknown;
  extractedAtMs?: number;
}

export interface ReadCausalLinksOptions {
  sessionId: string;
  includeUnclaimed?: boolean;
}

export type CausalLinksRunMeta = {
  session_id: string;
  kernel_version: string | null;
  kernel_params_json: string | null;
  extracted_at_ms: number | null;
  row_count: number;
};

type DbRow = {
  id: string;
  session_id: string;
  actor: string;
  cause_text: string | null;
  cause_type: string | null;
  cause_mass: number | null;
  cause_anchor_index: number | null;
  effect_text: string | null;
  effect_type: string | null;
  effect_mass: number | null;
  effect_anchor_index: number | null;
  mass_base: number | null;
  mass: number | null;
  link_mass: number | null;
  center_index: number | null;
  mass_boost: number | null;
  strength_ce: number | null;
  strength: number | null;
  intent_text: string;
  intent_type: string;
  intent_strength: "strong" | "weak";
  intent_anchor_index: number;
  consequence_text: string | null;
  consequence_type: string;
  consequence_anchor_index: number | null;
  distance: number | null;
  score: number | null;
  claimed: number;
  created_at_ms: number;
};

function mapRowToCausalLink(row: DbRow): CausalLink {
  return {
    id: row.id,
    session_id: row.session_id,
    actor: row.actor,
    cause_text: row.cause_text ?? row.intent_text,
    cause_type: (row.cause_type ?? row.intent_type) as CausalLink["cause_type"],
    cause_mass: row.cause_mass ?? undefined,
    cause_anchor_index: row.cause_anchor_index ?? row.intent_anchor_index,
    effect_text: row.effect_text ?? row.consequence_text,
    effect_type: (row.effect_type ?? row.consequence_type) as CausalLink["effect_type"],
    effect_mass: row.effect_mass ?? undefined,
    effect_anchor_index: row.effect_anchor_index,
    strength_ce: row.strength_ce,
    strength: row.strength,
    mass: row.mass ?? undefined,
    link_mass: row.link_mass ?? undefined,
    center_index: row.center_index ?? undefined,
    mass_boost: row.mass_boost ?? undefined,
    intent_text: row.intent_text,
    intent_type: row.intent_type as CausalLink["intent_type"],
    intent_strength: row.intent_strength,
    intent_anchor_index: row.intent_anchor_index,
    consequence_text: row.consequence_text,
    consequence_type: row.consequence_type as CausalLink["consequence_type"],
    consequence_anchor_index: row.consequence_anchor_index,
    distance: row.distance,
    score: row.score,
    claimed: row.claimed === 1,
    created_at_ms: row.created_at_ms,
  };
}

export function persistCausalLinks(
  sessionId: string,
  links: CausalLink[],
  options: PersistCausalLinksOptions = {},
): void {
  const db = getDb();
  const kernelVersion = options.kernelVersion ?? CAUSAL_KERNEL_VERSION;
  const kernelParamsJson = JSON.stringify(options.kernelParams ?? {});
  const extractedAtMs = options.extractedAtMs ?? Date.now();

  const del = db.prepare("DELETE FROM causal_links WHERE session_id = ?");
  const ins = db.prepare(
    `INSERT INTO causal_links (
      id, session_id, actor,
      cause_text, cause_type, cause_mass, cause_anchor_index,
      effect_text, effect_type, effect_mass, effect_anchor_index,
      mass_base, mass, link_mass, center_index, mass_boost,
      strength_ce, strength,
      kernel_version, kernel_params_json, extracted_at_ms,
      intent_text, intent_type, intent_strength, intent_anchor_index,
      consequence_text, consequence_type, consequence_anchor_index,
      distance, score, claimed, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  db.transaction(() => {
    del.run(sessionId);

    for (const link of links) {
      const causeText = link.cause_text ?? link.intent_text;
      const causeType = link.cause_type ?? link.intent_type;
      const causeAnchorIndex = link.cause_anchor_index ?? link.intent_anchor_index;
      const effectText = link.effect_text ?? link.consequence_text ?? null;
      const effectType = link.effect_type ?? link.consequence_type;
      const effectAnchorIndex = link.effect_anchor_index ?? link.consequence_anchor_index;
      const strengthCe = link.strength_ce ?? link.strength ?? link.score ?? null;
      const strength = link.strength ?? link.strength_ce ?? link.score ?? null;
      const massBase = (typeof link.cause_mass === "number")
        ? link.cause_mass + (typeof link.effect_mass === "number" ? link.effect_mass : 0)
        : null;
      const linkMass = link.link_mass ?? link.mass ?? massBase;

      ins.run(
        link.id,
        link.session_id,
        link.actor,
        causeText,
        causeType,
        link.cause_mass ?? null,
        causeAnchorIndex,
        effectText,
        effectType,
        link.effect_mass ?? null,
        effectAnchorIndex ?? null,
        massBase,
        link.mass ?? linkMass ?? null,
        linkMass ?? null,
        link.center_index ?? causeAnchorIndex,
        link.mass_boost ?? null,
        strengthCe,
        strength,
        kernelVersion,
        kernelParamsJson,
        extractedAtMs,
        link.intent_text,
        link.intent_type,
        link.intent_strength,
        link.intent_anchor_index,
        link.consequence_text,
        link.consequence_type,
        link.consequence_anchor_index,
        link.distance,
        link.score ?? strength,
        link.claimed ? 1 : 0,
        link.created_at_ms,
      );
    }
  })();
}

export function hasCausalLinksSync(sessionId: string): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT 1 as ok FROM causal_links WHERE session_id = ? LIMIT 1")
    .get(sessionId) as { ok: number } | undefined;
  return Boolean(row?.ok);
}

export async function hasCausalLinks(sessionId: string): Promise<boolean> {
  return hasCausalLinksSync(sessionId);
}

export function readCausalLinksSync(options: ReadCausalLinksOptions): CausalLink[] {
  const db = getDb();
  const includeUnclaimed = options.includeUnclaimed ?? true;
  const rows = db
    .prepare(
      `SELECT *
       FROM causal_links
       WHERE session_id = ? AND (? = 1 OR claimed = 1)
       ORDER BY cause_anchor_index ASC, created_at_ms ASC`
    )
    .all(options.sessionId, includeUnclaimed ? 1 : 0) as DbRow[];

  return rows.map(mapRowToCausalLink);
}

export function readCausalLinksWithMetaSync(
  options: ReadCausalLinksOptions,
): { links: CausalLink[]; meta: CausalLinksRunMeta | null } {
  const db = getDb();
  const includeUnclaimed = options.includeUnclaimed ?? true;
  const links = readCausalLinksSync(options);

  if (links.length === 0) {
    return { links, meta: null };
  }

  const metaRow = db
    .prepare(
      `SELECT
          session_id,
          kernel_version,
          kernel_params_json,
          extracted_at_ms,
          COUNT(*) as row_count
       FROM causal_links
       WHERE session_id = ? AND (? = 1 OR claimed = 1)
       GROUP BY session_id, kernel_version, kernel_params_json, extracted_at_ms
       ORDER BY extracted_at_ms DESC
       LIMIT 1`
    )
    .get(options.sessionId, includeUnclaimed ? 1 : 0) as CausalLinksRunMeta | undefined;

  const meta: CausalLinksRunMeta = {
    session_id: options.sessionId,
    kernel_version: metaRow?.kernel_version ?? null,
    kernel_params_json: metaRow?.kernel_params_json ?? null,
    extracted_at_ms: metaRow?.extracted_at_ms ?? null,
    row_count: links.length,
  };

  return { links, meta };
}

export async function readCausalLinks(options: ReadCausalLinksOptions): Promise<CausalLink[]> {
  return readCausalLinksSync(options);
}

export async function readCausalLinksWithMeta(
  options: ReadCausalLinksOptions,
): Promise<{ links: CausalLink[]; meta: CausalLinksRunMeta | null }> {
  return readCausalLinksWithMetaSync(options);
}
