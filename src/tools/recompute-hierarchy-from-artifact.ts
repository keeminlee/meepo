import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { annealLinks } from "../causal/annealLinks.js";
import { linkLinksKernel } from "../causal/linkLinksKernel.js";
import { propagateInternalStrength } from "../causal/propagateInternalStrength.js";
import { withInferredNodeKind } from "../causal/nodeKind.js";
import { writeHierarchyArtifacts } from "../causal/writeHierarchyArtifacts.js";

import type { CausalLink } from "../causal/types.js";
import type { RoundMetrics, RoundPhaseState } from "../causal/hierarchyTypes.js";
import type { HierarchyParams } from "../causal/runHierarchyRounds.js";
import type { TranscriptEntry } from "../ledger/transcripts.js";

type CliArgs = {
  artifactDir: string;
  outDir?: string;
  sessionLabel?: string;
  runId?: string;
  outlineTopK: number;
};

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const args: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }

  const artifactDir = (args.artifactDir as string) || (args.artifact as string);
  if (!artifactDir) {
    throw new Error(
      "Missing required --artifactDir. Example: --artifactDir runs/causal/C2E20/1771632698240_2906dbd39cc0",
    );
  }

  return {
    artifactDir,
    outDir: args.outDir as string | undefined,
    sessionLabel: args.sessionLabel as string | undefined,
    runId: args.runId as string | undefined,
    outlineTopK: args.outlineTopK ? Number(args.outlineTopK) : 50,
  };
}

function readJsonFile<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required artifact file: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

function stats(values: number[]): { min: number; p50: number; p90: number; max: number } {
  if (values.length === 0) return { min: 0, p50: 0, p90: 0, max: 0 };
  return {
    min: Math.min(...values),
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    max: Math.max(...values),
  };
}

function getStrengthBridge(link: CausalLink): number {
  if (typeof link.strength_bridge === "number") return link.strength_bridge;
  if (typeof link.strength_ce === "number") return link.strength_ce;
  if (typeof link.score === "number") return link.score;
  return 0;
}

function getStrengthInternal(link: CausalLink): number {
  if (typeof link.strength_internal === "number") return link.strength_internal;
  return getStrengthBridge(link);
}

function getMass(link: CausalLink): number {
  return link.mass ?? link.link_mass ?? link.mass_base ?? link.cause_mass ?? 0;
}

function parseTimelineTranscript(timelinePath: string): TranscriptEntry[] {
  if (!fs.existsSync(timelinePath)) {
    return [];
  }

  const raw = fs.readFileSync(timelinePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const byIndex = new Map<number, { author: string; content: string }>();

  const linePattern = /^\s*-\s*L(\d+)\s+\((.*?)\):\s+"(.*)"\s*$/;
  for (const line of lines) {
    const match = line.match(linePattern);
    if (!match) continue;

    const lineIndex = Number(match[1]);
    if (!Number.isFinite(lineIndex)) continue;

    const author = (match[2] ?? "Unknown").trim();
    const content = (match[3] ?? "").trim();
    byIndex.set(lineIndex, { author, content });
  }

  if (byIndex.size === 0) {
    return [];
  }

  const maxLine = Math.max(...byIndex.keys());
  const transcript: TranscriptEntry[] = [];
  for (let i = 0; i <= maxLine; i++) {
    const entry = byIndex.get(i);
    transcript.push({
      line_index: i,
      author_name: entry?.author ?? "Unknown",
      content: entry?.content ?? `[missing L${i}]`,
      timestamp_ms: i * 1000,
    });
  }
  return transcript;
}

function buildFallbackTranscriptFromLinks(links: CausalLink[]): TranscriptEntry[] {
  const byIndex = new Map<number, TranscriptEntry>();

  for (const link of links) {
    const causeIndex = link.cause_anchor_index ?? link.intent_anchor_index;
    if (typeof causeIndex === "number") {
      const content = link.cause_text ?? link.intent_text ?? "";
      byIndex.set(causeIndex, {
        line_index: causeIndex,
        author_name: link.actor || "Unknown",
        content,
        timestamp_ms: causeIndex * 1000,
      });
    }

    const effectIndex = link.effect_anchor_index ?? link.consequence_anchor_index;
    if (typeof effectIndex === "number") {
      const content = link.effect_text ?? link.consequence_text ?? "";
      byIndex.set(effectIndex, {
        line_index: effectIndex,
        author_name: "DM",
        content,
        timestamp_ms: effectIndex * 1000,
      });
    }
  }

  if (byIndex.size === 0) {
    throw new Error("Could not build transcript from links; no anchor lines found.");
  }

  const maxLine = Math.max(...byIndex.keys());
  const transcript: TranscriptEntry[] = [];
  for (let i = 0; i <= maxLine; i++) {
    const entry = byIndex.get(i);
    transcript.push({
      line_index: i,
      author_name: entry?.author_name ?? "Unknown",
      content: entry?.content ?? `[missing L${i}]`,
      timestamp_ms: i * 1000,
    });
  }
  return transcript;
}

function recomputeFromRound1Links(input: {
  linksRound1: CausalLink[];
  params: HierarchyParams;
  round1LinkMetrics?: RoundMetrics;
}): RoundPhaseState[] {
  const allRounds: RoundPhaseState[] = [];

  const round1LinkNodes = input.linksRound1;
  const pairsFormed = round1LinkNodes.filter((l) => l.claimed).length;

  const round1LinkMetrics: RoundMetrics =
    input.round1LinkMetrics ?? {
      round: 1,
      phase: "link",
      label: "link",
      timestamp_ms: Date.now(),
      counts: {
        nodes_total: round1LinkNodes.length,
        pairs_formed: pairsFormed,
      },
      stats: {
        strength_bridge: stats(round1LinkNodes.map(getStrengthBridge)),
        strength_internal: stats(round1LinkNodes.map(getStrengthInternal)),
        mass: stats(round1LinkNodes.map(getMass)),
      },
    };

  allRounds.push({
    round: 1,
    phase: "link",
    nodes: round1LinkNodes,
    neighborEdges: [],
    metrics: round1LinkMetrics,
  });

  const anneal1 = annealLinks({
    links: round1LinkNodes,
    windowLinks: input.params.anneal.windowLinks,
    hillTau: input.params.anneal.hillTau,
    hillSteepness: input.params.anneal.hillSteepness,
    betaLex: input.params.anneal.betaLex,
    lambda: input.params.anneal.lambda,
    topKContrib: input.params.anneal.topKContrib,
  });

  allRounds.push({
    round: 1,
    phase: "anneal",
    nodes: anneal1.links,
    neighborEdges: anneal1.neighborEdges,
    metrics: {
      round: 1,
      phase: "anneal",
      label: "anneal",
      timestamp_ms: Date.now(),
      counts: {
        nodes: anneal1.links.length,
        neighbor_edges: anneal1.neighborEdges.length,
      },
      stats: {
        strength_internal: stats(anneal1.links.map(getStrengthInternal)),
        mass: stats(anneal1.links.map(getMass)),
      },
    },
    massDeltaTsv: anneal1.massDeltaTsv,
  });

  let prevLevelMap = new Map(anneal1.links.map((node) => [node.id, node]));
  let currentRoundNodes = anneal1.links;

  if (input.params.maxLevel >= 2) {
    const linkLink2 = linkLinksKernel({
      sessionId: round1LinkNodes[0]?.session_id ?? "artifact-session",
      nodes: currentRoundNodes,
      params: {
        kLocalLinks: input.params.linkLinks.kLocalLinks,
        hillTau: input.params.linkLinks.hillTau,
        hillSteepness: input.params.linkLinks.hillSteepness,
        betaLex: input.params.linkLinks.betaLex,
        minBridge: input.params.linkLinks.minBridge,
        maxForwardLines: input.params.linkLinks.maxForwardLines,
      },
    });

    const round2LinkNodes = [...linkLink2.composites, ...linkLink2.unpaired];
    allRounds.push({
      round: 2,
      phase: "link",
      nodes: round2LinkNodes,
      neighborEdges: [],
      metrics: {
        round: 2,
        phase: "link",
        label: "link",
        timestamp_ms: Date.now(),
        counts: {
          nodes_total: round2LinkNodes.length,
          pairs_formed: linkLink2.composites.length,
          unpaired_total: linkLink2.unpaired.length,
        },
        stats: {
          strength_bridge: stats(round2LinkNodes.map(getStrengthBridge)),
          strength_internal: stats(round2LinkNodes.map(getStrengthInternal)),
          mass: stats(round2LinkNodes.map(getMass)),
        },
      },
      candidates: linkLink2.candidates,
    });

    const anneal2 = annealLinks({
      links: round2LinkNodes,
      windowLinks: input.params.anneal.windowLinks,
      hillTau: input.params.anneal.hillTau,
      hillSteepness: input.params.anneal.hillSteepness,
      betaLex: input.params.anneal.betaLex,
      lambda: input.params.anneal.lambda,
      topKContrib: input.params.anneal.topKContrib,
    });

    propagateInternalStrength(anneal2.links, prevLevelMap);

    allRounds.push({
      round: 2,
      phase: "anneal",
      nodes: anneal2.links,
      neighborEdges: anneal2.neighborEdges,
      metrics: {
        round: 2,
        phase: "anneal",
        label: "anneal",
        timestamp_ms: Date.now(),
        counts: {
          nodes: anneal2.links.length,
          neighbor_edges: anneal2.neighborEdges.length,
        },
        stats: {
          strength_internal: stats(anneal2.links.map(getStrengthInternal)),
          mass: stats(anneal2.links.map(getMass)),
        },
      },
      massDeltaTsv: anneal2.massDeltaTsv,
    });

    prevLevelMap = new Map(anneal2.links.map((node) => [node.id, node]));
    currentRoundNodes = anneal2.links;
  }

  if (input.params.maxLevel >= 3) {
    const linkLink3 = linkLinksKernel({
      sessionId: round1LinkNodes[0]?.session_id ?? "artifact-session",
      nodes: currentRoundNodes,
      params: {
        kLocalLinks: input.params.linkLinks.kLocalLinks,
        hillTau: input.params.linkLinks.hillTau,
        hillSteepness: input.params.linkLinks.hillSteepness,
        betaLex: input.params.linkLinks.betaLex,
        minBridge: input.params.linkLinks.minBridge,
        maxForwardLines: input.params.linkLinks.maxForwardLines,
      },
    });

    const round3LinkNodes = [...linkLink3.composites, ...linkLink3.unpaired];
    allRounds.push({
      round: 3,
      phase: "link",
      nodes: round3LinkNodes,
      neighborEdges: [],
      metrics: {
        round: 3,
        phase: "link",
        label: "link",
        timestamp_ms: Date.now(),
        counts: {
          nodes_total: round3LinkNodes.length,
          pairs_formed: linkLink3.composites.length,
          unpaired_total: linkLink3.unpaired.length,
        },
        stats: {
          strength_bridge: stats(round3LinkNodes.map(getStrengthBridge)),
          strength_internal: stats(round3LinkNodes.map(getStrengthInternal)),
          mass: stats(round3LinkNodes.map(getMass)),
        },
      },
      candidates: linkLink3.candidates,
    });

    const anneal3 = annealLinks({
      links: round3LinkNodes,
      windowLinks: input.params.anneal.windowLinks,
      hillTau: input.params.anneal.hillTau,
      hillSteepness: input.params.anneal.hillSteepness,
      betaLex: input.params.anneal.betaLex,
      lambda: input.params.anneal.lambda,
      topKContrib: input.params.anneal.topKContrib,
    });

    propagateInternalStrength(anneal3.links, prevLevelMap);

    allRounds.push({
      round: 3,
      phase: "anneal",
      nodes: anneal3.links,
      neighborEdges: anneal3.neighborEdges,
      metrics: {
        round: 3,
        phase: "anneal",
        label: "anneal",
        timestamp_ms: Date.now(),
        counts: {
          nodes: anneal3.links.length,
          neighbor_edges: anneal3.neighborEdges.length,
        },
        stats: {
          strength_internal: stats(anneal3.links.map(getStrengthInternal)),
          mass: stats(anneal3.links.map(getMass)),
        },
      },
      massDeltaTsv: anneal3.massDeltaTsv,
    });
  }

  return allRounds;
}

function main(): void {
  const args = parseArgs();
  const artifactDir = path.resolve(args.artifactDir);

  const paramsPath = path.join(artifactDir, "params.json");
  const summaryPath = path.join(artifactDir, "summary.json");
  const round1LinksPath = path.join(artifactDir, "round1", "link", "links.json");
  const round1MetricsPath = path.join(artifactDir, "round1", "link", "metrics.json");
  const timelinePath = path.join(artifactDir, "output.timeline.md");

  const params = readJsonFile<HierarchyParams>(paramsPath);
  const summary = readJsonFile<{ session_id?: string; provenance?: { kernel_version?: string } }>(summaryPath);
  const round1Links = readJsonFile<CausalLink[]>(round1LinksPath).map(withInferredNodeKind);
  const round1Metrics = fs.existsSync(round1MetricsPath)
    ? readJsonFile<RoundMetrics>(round1MetricsPath)
    : undefined;

  if (round1Links.length === 0) {
    throw new Error(`No L1 links found in ${round1LinksPath}`);
  }

  const parsedTranscript = parseTimelineTranscript(timelinePath);
  const transcript = parsedTranscript.length > 0 ? parsedTranscript : buildFallbackTranscriptFromLinks(round1Links);

  const allRounds = recomputeFromRound1Links({
    linksRound1: round1Links,
    params,
    round1LinkMetrics: round1Metrics,
  });

  const paramsJson = JSON.stringify(params);
  const paramHash = createHash("sha256").update(paramsJson).digest("hex").slice(0, 12);
  const sessionId = summary.session_id ?? round1Links[0].session_id;

  const inferredSessionLabel = path.basename(path.dirname(artifactDir));
  const sessionLabel = args.sessionLabel ?? inferredSessionLabel;
  const outDir = args.outDir ?? path.dirname(path.dirname(artifactDir));

  const runId =
    args.runId ?? `${Date.now()}_${paramHash}_artifact-recompute`;

  const runDir = writeHierarchyArtifacts({
    sessionId,
    sessionLabel,
    transcript,
    allRounds,
    provenance: {
      kernel_version: `${summary.provenance?.kernel_version ?? "ce-mass-v2"}+artifact-recompute`,
      params_json: paramsJson,
      param_hash: paramHash,
    },
    outDir,
    runId,
    outlineTopK: args.outlineTopK,
  });

  console.log(`Recomputed run written to: ${runDir}`);
}

try {
  main();
} catch (err) {
  console.error("ERROR:", err instanceof Error ? err.message : err);
  if (err instanceof Error) {
    console.error(err.stack);
  }
  process.exit(1);
}
