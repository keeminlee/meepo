import "dotenv/config";
import { getDb } from "../src/db.js";
import { buildTranscript } from "../src/ledger/transcripts.js";
import { generateRegimeMasks } from "../src/causal/pruneRegimes.js";
import { buildEligibilityMask } from "../src/causal/eligibilityMask.js";
import { extractCausalLinksKernel } from "../src/causal/extractCausalLinksKernel.js";
import { buildDmNameSet, detectDmSpeaker } from "../src/ledger/scaffoldSpeaker.js";
import { loadRegistry } from "../src/registry/loadRegistry.js";
import type { RegimeChunk } from "../src/causal/pruneRegimes.js";

const db = getDb();
const session = db.prepare("SELECT session_id FROM sessions WHERE label = ? LIMIT 1").get("C2E20") as { session_id: string };
const sessionId = session.session_id;
const transcript = buildTranscript(sessionId, true);

const t295 = transcript[295];
console.log("transcript[295]:", JSON.stringify({ line_index: t295.line_index, author: t295.author_name, content: t295.content.slice(0, 80) }));

const sc = db.prepare("SELECT event_id, start_index, end_index FROM event_scaffold WHERE session_id = ? ORDER BY start_index").all(sessionId) as Array<{ event_id: string; start_index: number; end_index: number }>;
const ev = db.prepare("SELECT start_index, end_index, is_ooc FROM events WHERE session_id = ?").all(sessionId) as Array<{ start_index: number; end_index: number; is_ooc: number }>;
const oocMap = new Map(ev.map(e => [`${e.start_index}:${e.end_index}`, e.is_ooc === 1]));
const chunks: RegimeChunk[] = sc.map((r, i) => ({ chunk_id: r.event_id, chunk_index: i, start_index: r.start_index, end_index: r.end_index, is_ooc: oocMap.get(`${r.start_index}:${r.end_index}`) }));
const masks = generateRegimeMasks(chunks, transcript, {});
const mask = buildEligibilityMask(transcript, masks, sessionId);

const reg = loadRegistry();
const actors = reg.characters.filter(c => c.type === "pc").map(pc => ({ id: pc.id, canonical_name: pc.canonical_name, aliases: pc.aliases ?? [] }));
const dm = buildDmNameSet(detectDmSpeaker(Array.from(new Set(transcript.map(l => l.author_name)))));

const { links } = extractCausalLinksKernel({ sessionId, transcript, eligibilityMask: mask, actors, dmSpeaker: dm, kLocal: 8, strongMinScore: 0.35, weakMinScore: 0.1 }, false);

// All links where intent OR consequence is within 3 lines of 295
const near = links.filter(l =>
  Math.abs(l.intent_anchor_index - 295) <= 3 ||
  (l.consequence_anchor_index !== null && Math.abs(l.consequence_anchor_index - 295) <= 3)
);

console.log(`\nLinks near L295 (${near.length}):`);
for (const l of near) {
  console.log(JSON.stringify({ intent_anchor: l.intent_anchor_index, cons_anchor: l.consequence_anchor_index, actor: l.actor, score: l.score, claimed: l.claimed, type: l.consequence_type, strength: l.intent_strength }));
}

// Check linkByIntentAnchor and linkByConsequenceAnchor as would be built by renderer
const linkByIntentAnchor = new Map<number, typeof links[0]>();
for (const link of links) linkByIntentAnchor.set(link.intent_anchor_index, link);

const linkByConsequenceAnchor = new Map<number, typeof links[0]>();
for (const link of links) {
  if (link.claimed && link.consequence_anchor_index !== null) {
    linkByConsequenceAnchor.set(link.consequence_anchor_index, link);
  }
}

console.log("\nAt L295:");
const il = linkByIntentAnchor.get(295);
const cl = linkByConsequenceAnchor.get(295);
console.log("  intentLink:", il ? JSON.stringify({ intent_anchor: il.intent_anchor_index, score: il.score, claimed: il.claimed }) : "undefined");
console.log("  consequenceLink:", cl ? JSON.stringify({ cons_anchor: cl.consequence_anchor_index, intent_anchor: cl.intent_anchor_index, score: cl.score }) : "undefined");
console.log("  hasAnnotation:", il !== undefined || cl !== undefined);
if (il) {
  console.log("  minScore check (0.1):", !il.claimed, "||", (il.score ?? 0), ">=", 0.1, "=", !il.claimed || (il.score ?? 0) >= 0.1);
}
