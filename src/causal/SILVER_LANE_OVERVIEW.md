# Silver Lane: Causal Blob Generation Pipeline — Overview

This document describes the **silver lane**: the full pipeline that turns transcript lines into a hierarchy of **causal blobs** (cause→effect links and composite nodes), with the goal of **convergence** via repeated **link** and **anneal/absorption** phases.

---

## 1. Goal and Convergence

**Eventual goal:** A stable set of causal blobs (per level) where:

- **Mass** (how much “substance” a blob has: base mass + absorbed context) and  
- **Strength** (how strongly cause is tied to effect, or how strongly links are bridged)

have reached a stable equilibrium. Link structure forms in link phases; anneal/absorption phases attach L0 singleton/stray lines into existing L1+ nodes. When neither structure nor absorption changes meaningfully between rounds, the pipeline has **converged**.

**Convergence in practice:** We can keep running **link phase → anneal/absorption phase** rounds until change is minimal (e.g. no new composites and no new absorptions). Today the hierarchy runner supports early stop under that criterion.

---

## 2. Core Concepts

### 2.1 Blobs and links

- **Causal link (L1 blob):** A single cause→effect pair: one PC intent (cause) matched to one consequence (effect), with `strength_ce` (cause–effect strength), `mass_base`, and optional `mass_boost`.
- **Composite blob (L2/L3):** A “link of links”: two blobs (left, right) joined by a **bridge** with `strength_bridge`. Composites have `strength_internal = strength_bridge + left.strength_internal + right.strength_internal` and `mass_base = left_mass + right_mass + strength_internal` (plus optional boost).
- **Mass** is the main “size” of a blob: used for tiering (link / beat / event / scene), for link–link join thresholds, and for anneal contributions.
- **Strength** (cause–effect, bridge, or internal) encodes how tight the causal or structural bond is; it feeds into mass and into whether a link–link pair is accepted.

### 2.2 Phases

- **Link phase:** Build or extend structure.
  - **Kernel (L0→L1):** From transcript, detect causes and effects, score cause–effect pairs (distance + lexical), allocate effects to causes, then optionally boost link masses from neighbors (link–link mass boost).
  - **Link–links (L→L+1):** From current-level blobs, find pairs (left, right) with high `strength_bridge` above a mass-dependent threshold; form composites and leave unpaired nodes as-is.
  - **Absorb (cycles pipeline only):** Attach singleton causes/effects to existing links as context (adds `contextEdges`, `contextByLinkId`); does not change the set of link nodes.
- **Anneal phase:** Redistribute **mass** over the current set of blobs using neighborhood (link–link) influence, without changing the graph structure. Each blob’s new mass = `mass_base + λ * (sum of strength_ll * mass_prev from neighbors within window)`. So: **strength** (and proximity/lexical) determines how much each neighbor **contributes**; **mass** is what gets **updated**. That’s the mass–strength tug-of-war: strength drives the flow of mass; mass then affects future link formation and anneal contributions.

### 2.3 Mass–strength tug-of-war

- **Strength** (cause–effect, bridge, internal) is computed from distance (hill function) and lexical overlap. It is the “pull” or “bond strength.”
- **Mass** is the “substance” that gets pulled: in anneal, each blob’s mass is updated from neighbors’ masses weighted by strength; in link–links, higher mass raises the threshold for joining, so only strong enough bridges create composites.
- Repeating **link → anneal** lets mass settle: after anneal, masses change; if we ran another link phase, join thresholds would differ; after another anneal, masses would shift again. **Convergence** means running until these updates become negligible (minimal change in masses and/or in which links/composites exist).

---

## 3. Pipeline Variants

Two main entrypoints live in this codebase:

### 3.1 Hierarchy pipeline (link–links + anneal, multi-level)

**Entry:** `runHierarchyRounds` (exported as `runRounds` from `runHierarchyRounds.ts`).  
**Tool:** `run-causal-cycles.ts` (calls `runRounds`).

**Flow:**

1. **Round 1 — L0→L1**
   - **Link:** `extractCausalLinksKernel`: from transcript → L1 causal links (cause–effect pairs); optional in-kernel link–link mass boost.
   - **Anneal:** `annealLinks`: one step of mass redistribution over L1 links (optional `ambientMassBoost`).
2. **Round 2 — L1→L2** (if `maxLevel >= 2`)
   - **Link:** `linkLinksKernel`: from L1 nodes, form L2 composites (pairs above threshold) + unpaired L1; then `propagateInternalStrength` so composites get correct `strength_internal`.
   - **Anneal:** `annealLinks` on L2 nodes.
3. **Round 3 — L2→L3** (if `maxLevel >= 3`)
   - Same pattern: `linkLinksKernel` on current nodes → L3 composites + unpaired; `propagateInternalStrength`; then `annealLinks`.

Output: `allRounds` (per-round, per-phase states with `nodes`, `metrics`, `massDeltaTsv`) and `finalNodes` (top-level blobs). No iterative convergence yet—fixed 1–3 rounds.

### 3.2 Cycles pipeline (kernel + absorb + anneal, flat links)

**Entry:** `runCausalCycles` in `runCausalCycles.ts`.

**Flow:**

1. **Cycle 0**
   - **Link:** `extractCausalLinksKernel` → initial links.
   - **Anneal:** `annealLinks`.
   - Extract singletons from kernel output (unclaimed causes/effects).
2. **Cycles 1–2**
   - **Link:** `absorbSingletons`: attach singletons to links as context (context edges + `contextByLinkId`); link set may gain context but no new structural links.
   - **Anneal:** `annealLinks` (optionally with `contextByLinkId` for text used in lexical overlap).

Output: `finalLinks` (flat list), `allPhases` (per cycle/phase). Again, fixed number of cycles; no convergence loop.

---

## 4. Key Modules (by role)

| Role | Module | What it does |
|------|--------|----------------|
| L0→L1 link | `extractCausalLinksKernel.ts` | Detect causes/effects, score pairs (distance + lexical → `strength_ce`), allocate, optional link–link mass boost. |
| Mass redistribution | `annealLinks.ts` | For each link, compute contribution from neighbors in `windowLinks` (distance + lexical → `strength_ll`); `mass = mass_base + λ * totalContrib`; emit `massDeltaTsv`. |
| L→L+1 link | `linkLinksKernel.ts` | Score pairs (forward-only, `kLocalLinks`), `strength_bridge`; threshold `t0 + k*log(1+√(massA*massB))`; form composites; output composites + unpaired. |
| Strength propagation | `propagateInternalStrength.ts` | Set composite `strength_internal = strength_bridge + left.strength_internal + right.strength_internal`. |
| Singleton context | `absorbSingletons.ts` | Attach singleton causes/effects to links within radius (mass-dependent); add context edges and `contextByLinkId`. |
| Distance/lexical | `textFeatures.ts` | `distanceScoreHill(d, tau, p)` = 1/(1+(d/τ)^p); token overlap, stopwords, etc. |
| Types | `types.ts`, `cycleTypes.ts`, `hierarchyTypes.ts` | `CausalLink`, phase/cycle state, metrics, `RoundPhase = "link" \| "anneal"`. |

---

## 5. Parameters that affect convergence

- **Anneal:** `windowLinks`, `hillTau`, `hillSteepness`, `betaLex`, `lambda`, `topKContrib`, `ambientMassBoost`. Larger `lambda` / larger window → bigger mass updates per step; smaller `lambda` → gentler steps, potentially more rounds to converge.
- **Link–links:** `kLocalLinks`, `hillTau`, `hillSteepness`, `betaLex`, `minBridge`, `tLinkBase`, `tLinkK`, `maxForwardLines`. Higher thresholds → fewer composites; mass-dependent threshold ties structure to current masses.
- **Kernel:** `kLocal`, `hillTau`, `hillSteepness`, `betaLex`, link-window and damping for in-kernel mass boost. These fix L1 input to the hierarchy; convergence is then over L1 anneal and L2/L3 link+anneal.

---

## 6. Reaching “minimal change” (convergence)

To run link+anneal until there is minimal change:

1. **Define a round:** one **link** step (kernel for L1, or linkLinks for L≥2) followed by one **anneal** step.
2. **After each anneal**, record either:
   - per-link mass (and optionally tier), or
   - aggregate stats (e.g. sum of mass, or mass delta from previous round).
3. **Stopping condition:** e.g. max rounds reached, or (mean/median/max) mass delta below ε, or link set (and optionally composite set) unchanged.
4. **Loop:** For hierarchy, current code runs rounds 1–3 once; to converge, re-run the **same** link+anneal for the **same** level (e.g. L1 only) repeatedly until the stopping condition, or run multiple full hierarchy passes and stop when top-level masses stabilize.

The existing `massDeltaTsv` (per anneal) and per-phase `metrics.stats.mass` are the right hooks to compare between rounds and implement such a convergence check.

---

## 7. Summary

- **Silver lane** = the causal blob pipeline: transcript → L1 links (kernel) → optional higher-level composites (link–links) and repeated **anneal** steps that redistribute mass.
- **Mass** = blob “size”; **strength** = bond (cause–effect or link–link). Anneal updates mass from strength-weighted neighborhood contributions; link formation uses mass in thresholds. Together they form a **mass–strength tug-of-war**.
- **Convergence** = repeating **link + anneal** until mass (and optionally structure) changes are minimal. The design supports this; current code uses a fixed number of rounds (1–3 for hierarchy, 3 cycles for cycles). Adding a convergence loop means re-running the same phases and comparing `massDeltaTsv` / `metrics` until a chosen stopping condition is satisfied.
