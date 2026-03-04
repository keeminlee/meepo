import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { resolveCampaignExportSubdir } from "../dataPaths.js";

export type RetrievalMemory = {
  memory_id: string;
  title: string;
  text: string;
  score: number;
  tags: string[];
  source: "meepomind_db";
};

export type MeepoMindRetrievalArtifact = {
  schema_version: 1;
  kind: "meepo_mind_retrieval";
  campaign_slug: string;
  session_id: string;
  anchor_ledger_id: string;
  created_at_ms: number;
  algo_version: string;
  query_hash: string;
  top_k: number;
  always: {
    criteria: {
      gravity: 1.0;
      certainty: 1.0;
      resilience: 1.0;
    };
    memories: RetrievalMemory[];
  };
  ranked: {
    memories: RetrievalMemory[];
  };
  stats: {
    always_count: number;
    ranked_count: number;
    db_ms: number;
  };
};

export function normalizeRetrievalQueryText(queryText?: string): string {
  return (queryText ?? "").trim().toLowerCase();
}

export function computeRetrievalQueryHash(queryText?: string): string {
  const normalized = normalizeRetrievalQueryText(queryText);
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function writeFileAtomic(filePath: string, content: string): void {
  const absPath = path.resolve(filePath);
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.${path.basename(absPath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  );
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, absPath);
}

export function buildRetrievalArtifactPath(args: {
  campaignSlug: string;
  sessionId: string;
  anchorLedgerId: string;
  algoVersion: string;
  topK: number;
  queryHash: string;
}): string {
  const meecapsDir = resolveCampaignExportSubdir(args.campaignSlug, "meecaps", {
    forWrite: true,
    ensureExists: true,
  });
  const retrievalDir = path.join(meecapsDir, "online", args.sessionId, "retrieval");
  fs.mkdirSync(retrievalDir, { recursive: true });
  const shortQueryHash = args.queryHash.slice(0, 8);
  const fileName = `mind_${args.anchorLedgerId}_${args.algoVersion}_${args.topK}_${shortQueryHash}.json`;
  return path.join(retrievalDir, fileName);
}

export function writeRetrievalArtifact(args: {
  artifactPath: string;
  artifact: MeepoMindRetrievalArtifact;
}): void {
  writeFileAtomic(args.artifactPath, JSON.stringify(args.artifact, null, 2));
}

export function loadRetrievalArtifact(args: {
  artifactPath: string;
}): MeepoMindRetrievalArtifact | null {
  if (!fs.existsSync(args.artifactPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(args.artifactPath, "utf8")) as MeepoMindRetrievalArtifact;
    if (parsed?.kind !== "meepo_mind_retrieval") return null;
    return parsed;
  } catch {
    return null;
  }
}
