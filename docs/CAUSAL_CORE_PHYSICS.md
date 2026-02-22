# Causal Core Physics Engine (Mass vs Strength)

This document describes the current causal core contract for how links are formed, how strength propagates, how mass evolves, and how hierarchy converges.

## Design Goal

Separate two concerns:

- **Strength** = causal evidence in the structure
- **Mass** = salience used for hierarchy shaping and rendering

This keeps merge decisions grounded in causal bridges while still allowing readable, stable outlines.

## Vocabulary

## Leaf

Any single eligible transcript line (PC or DM), represented as an atomic unit.

- `mass_leaf`: small scalar based on speaker + line length
- `strength_internal = 0`

Leaves are not composites.

## Link Node (L1)

Paired cause leaf + effect leaf.

- `strength_bridge = score_ce(cause, effect)`
- `strength_internal = strength_bridge + sum(children.strength_internal)`
- For leaf children, this reduces to `strength_internal = strength_bridge`
- `mass_base` derives from `strength_internal + cause_mass + effect_mass`

## Higher-Level Node (L2/L3)

Composite created from node-to-node linking.

- `strength_bridge = score_ll(A, B)`
- `strength_internal = strength_bridge + strength_internal(A) + strength_internal(B)`
- `mass_base` derives from child masses + `strength_internal`

## Round Structure

Each round has two phases:

1. **LINK**
2. **ANNEAL**

### LINK phase

Build candidate edges in both directions:

- Forward: nearby PC cause -> DM effect
- Backward: DM effect -> prior nearby PC causes (useful for roll/response anchoring)

Score each edge with distance-first local scoring:

`score = hill(distance) * (1 + betaLex * lexical_overlap) + boosts`

Then run global greedy one-to-one assignment:

- sort edges descending by score
- deterministic tie-break
- claim each endpoint at most once

Emit:

- matched pairs -> L1 link nodes
- unmatched leaves -> singleton nodes (`strength_internal = 0`)

### ANNEAL phase

1. Optional context absorption (mass-aware gate)
2. Internal-strength propagation for composites
3. Mass update

Mass update formula:

`mass = mass_base + mass_boost`

where `mass_boost` comes from local link<->link neighborhood contributions when enabled.

## Threshold Policy

## Structural linking

- **L1 pairing:** no min-score gate
- **L2/L3 merges:** mass-aware gate

`accept if score_ll(A, B) >= T_link(mA, mB)`

with

`T_link = T0 + k * log(1 + sqrt(mA * mB))`

Interpretation: large nodes require stronger evidence to merge.

## View filtering

Thresholds used only for readability (render/export), not for deciding whether structure exists.

## Ambient Mass Boost Toggle

Feature flag:

- `--ambientMassBoost` (default `false`)

Behavior:

- When `false`: neighbor edges are still computed and reported, but do not change mass.
- When `true`: neighbor contributions apply to `mass_boost`.

This supports safe A/B comparison without losing diagnostics.

## Diagnostics and Artifacts

Even with ambient boosting disabled, the engine reports:

- neighbor edges (top-K)
- `strength_ll` distribution stats (including p50/p90/max)

This preserves observability and enables reversible tuning.

## Practical Convergence Expectations

- L2 should avoid artificial ballooning when ambient boost is off.
- L3 should become massive primarily when genuinely strong L2 merges occur.
- Merge topology should track bridge evidence more than local density.

## Source Pointers

- L1 extraction and edge assignment: `src/causal/extractCausalLinksKernel.ts`
- L2/L3 merge kernel and `T_link`: `src/causal/linkLinksKernel.ts`
- Anneal and diagnostics: `src/causal/annealLinks.ts`
- Context absorption gate: `src/causal/absorbSingletons.ts`
- Round orchestration: `src/causal/runHierarchyRounds.ts`
- Artifact recompute path: `src/tools/recompute-hierarchy-from-artifact.ts`