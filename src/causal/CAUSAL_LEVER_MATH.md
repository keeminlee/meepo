# Causal + Lever Math Reference

This document is a full mathematical/operator reference for the current causal hierarchy pipeline, including the leverized evidence model and the post-refactor absorption semantics.

---

## 1) Pipeline Structure (Current)

Each round has two phases:

1. **Link phase**
   - Round 1: L0 -> L1 (`extractCausalLinksKernel`)
   - Round 2+: L(k) -> L(k+1) (`linkLinksKernel`)
2. **Anneal phase (now absorption)**
   - L0 lines are absorbed into existing L1+ links (`absorbSingletons`)
   - Mass updates from absorption events only (no link-link mass diffusion)

Convergence (if enabled) stops when a round has:
- `pairs_formed = 0` in link phase, and
- `absorptions_this_round = 0` in absorption phase.

---

## 2) Notation

- Transcript lines: `x_t`, line index `t`
- Eligible line set after mask: `E`
- Links/nodes at a phase: `V = {v_i}`
- Node mass: `m_i`
- Node center index: `c_i`
- Distance between two anchors/centers: `d`
- Hill distance evidence:

`D(d; tau, p) = 1 / (1 + (d / tau)^p)`

- Lexical overlap signal: `L in [0,1]`
- Keyword overlap share (lever mode): `K in [0,1]`
- Combined evidence:

`Evi = w_d * D + w_l * L + b`

where current fixed weights are:
- `w_d = 0.7`
- `w_l = 0.3`
- `b` optional boost (e.g., yes/no answer boost in kernel CE scoring)

- Strength map (lever mode):

`S = s * (Evi)^gamma`

where:
- `gamma = coupling`
- `s = strengthScale` (default `2`)

---

## 3) Eligibility and Candidate Universe

Eligibility mask removes lines by reason (`combat`, `ooc_refined`, etc.).

- Eligible set: `E = {t | eligible_mask[t] = true}`
- In absorption, candidate pool is now:

`A0 = E \ C`

where `C` is the set of line indices already used as claimed L1 cause/effect anchors.

So all remaining eligible L0 lines are absorbable candidates.

---

## 4) Round 1 Link Kernel (L0 -> L1)

## 4.1 Cause/effect detection

From eligible lines:
- PC lines -> cause candidates
- DM lines -> effect candidates

Detection uses rule-based intent/effect functions (`detectCause`, `detectEffect`).

## 4.2 Local candidate generation

For each cause line `i`:
- forward candidates: next `kLocal` DM lines

For each DM effect line `j`:
- backward candidates: previous `kLocal` PC lines

Each candidate CE edge computes `S_ce`:

- **Legacy mode**

`S_ce = D * (1 + betaLex * L) + b_answer`

- **Lever mode**

1) lexical augmentation with keyword bonus:

`L' = min(1, L * (1 + keywordLexBonus * K))`

2) evidence:

`Evi = 0.7 * D + 0.3 * L' + b_answer`

3) strength:

`S_ce = strengthScale * (Evi)^coupling`

## 4.3 CE threshold gating (now enforced)

For each cause, define a base threshold:
- strong cause -> `strongMinScore`
- weak cause -> `weakMinScore`

Final threshold:

`T_ce = max(baseThreshold, minPairStrength?)`

Candidate CE edges survive only if:

`S_ce >= T_ce`

Then filter by:

`distance <= maxL1Span`

## 4.4 One-to-one edge allocation

Remaining CE edges are globally sorted by:
1) descending `S_ce`
2) ascending distance
3) stable tie-breakers

Greedy pick with exclusivity:
- each cause claims at most one effect
- each effect claimed by at most one cause

This is why monotonic parameter changes can produce non-monotonic pair counts.

## 4.5 L1 node construction

For claimed pairs:
- node kind `link`
- initial masses currently `1` at creation

For unclaimed causes:
- node kind `singleton` (not retained as node in hierarchy absorb path; represented via L0 absorbable candidates)

---

## 5) Link-Links Phase (Lk -> Lk+1, k>=1)

For each node `i`, consider forward neighbors `j`:
- `center_distance = c_j - c_i > 0`
- within `maxForwardLines`
- keep nearest `kLocalLinks`

Bridge strength:

- **Legacy**

`S_bridge = D * (1 + betaLex * L)`

- **Lever**

`L' = min(1, L * (1 + keywordLexBonus * K))`

`Evi = 0.7 * D + 0.3 * L'`

`S_bridge = strengthScale * (Evi)^coupling`

Merge threshold:

- **Legacy**

`T_link = t0 + k * log(1 + sqrt(m_i * m_j))`

- **Lever**

`T_link = thresholdBase + growthResistance * log(1 + sqrt(m_i * m_j))`

Accept pair if:

`S_bridge >= T_link`

Global greedy pairing with one-use-per-node yields composites.

Composite construction (current):
- `strength_internal = S_bridge + strength_internal(left) + strength_internal(right)`
- `mass_base = m_left + m_right` (strength term not added to mass base)

---

## 6) Anneal/Absorption Phase (Current Meaning of "Anneal")

For each absorbable singleton line `s` and each link/node `i`:

### 6.1 Radius gate

`R_i = radiusBase + radiusPerMass * m_i`

Allow candidate if:

`|anchor_s - center_i| <= R_i`

### 6.2 Absorption strength

Let `d = |anchor_s - center_i|`.

Distance evidence:

`D = D(d; tau, p)` with:
- lever mode: `tau = localityToTau(locality)`
- non-lever: `tau = hillTau`

Lexical signal `L` between singleton text and link text.

- **Legacy absorption strength**

`S_ctx = D * (1 + betaLex * L)`

- **Lever absorption strength**

`L' = min(1, L * (1 + keywordLexBonus * K))`

`Evi = 0.7 * D + 0.3 * L'`

`S_ctx = strengthScale * (Evi)^coupling`

### 6.3 Threshold gate

If explicit mass-aware threshold is set:

`T_ctx = ctxThresholdBase + ctxThresholdPerLogMass * log(1 + m_s)`

Else:

`T_ctx = minCtxStrength`

Candidate survives if:

`S_ctx >= T_ctx`

### 6.4 Per-link capacity

`Cap_i = floor(capBase + capPerMass * m_i)`

### 6.5 Greedy assignment

Sort candidates by:
1) descending `S_ctx`
2) descending singleton mass
3) ascending distance
4) stable ids

Assign greedily with constraints:
- singleton attaches to at most one link
- link cannot exceed `Cap_i`

### 6.6 Mass update on attach

For each accepted attachment `(s -> i)`:

`m_i <- m_i + m_s`

and update:
- `context_line_indices` (absorbed anchors)
- `context_count`
- context edge logs

Strength values are not recomputed by absorption itself.

---

## 7) Lever Parameters: What They Control

## 7.1 `locality`

Used in all leverized scoring paths (kernel, link-links, absorption):

`tau = 4 + 4 * (1 - clamp(locality,0,1))`

- `locality=0 -> tau=8` (slower decay, more distance tolerance)
- `locality=1 -> tau=4` (faster decay, more local)

## 7.2 `coupling`

Exponent `gamma` in:

`S = scale * Evi^gamma`

- `<1` boosts mid evidence
- `=1` linear
- `>1` compresses mid evidence, keeps only high evidence strong

## 7.3 `growthResistance`

Only in link-links threshold (lever path):

`T_link = thresholdBase + growthResistance * log(1 + sqrt(m_i * m_j))`

Higher value => mass penalties stronger => fewer high-mass merges.

## 7.4 `keywordLexBonus`

In lever lexical augmentation:

`L' = min(1, L * (1 + keywordLexBonus * K))`

Higher value gives more gain when overlap includes trigger keywords.

---

## 8) Kernel Threshold/Window Parameters (Now Exposed)

- `kernelKLocal`
  - candidate search breadth for CE windows
- `kernelStrongMinScore`
  - CE acceptance threshold for strong causes
- `kernelWeakMinScore`
  - CE acceptance threshold for weak causes
- `kernelMinPairStrength`
  - optional global lower bound on CE acceptance
- `kernelMaxL1Span`
  - hard cap on cause-effect line distance

These are all active in edge gating before one-to-one allocation.

---

## 9) Why Metrics Can Be Non-Monotonic

Even when a parameter "should increase strength":

- one-to-one greedy matching causes competitive displacement
- later rounds depend on changed topology from earlier rounds
- merge thresholds depend on masses, and masses depend on prior absorption

So a knob can raise pairability while still reducing specific per-round counts.

---

## 10) CLI -> Math Mapping (Current)

### Lever flags

- `--locality` -> `tau(locality)`
- `--coupling` -> `gamma`
- `--growthResistance` -> `growthResistance` in `T_link`
- `--keywordLexBonus` -> lexical keyword multiplier

### Kernel flags

- `--kernelKLocal` -> CE local candidate count
- `--kernelStrongMinScore` -> strong CE threshold
- `--kernelWeakMinScore` -> weak CE threshold
- `--kernelMinPairStrength` -> extra CE floor
- `--kernelMaxL1Span` -> CE distance cap

### Link-links flags

- `--llKLocalLinks` -> local bridge neighbor count
- `--llTau`, `--llSteepness`, `--llBetaLex`, `--llMinBridge`, `--llMaxForwardLines`
  - legacy/non-lever bridge behavior or fallback terms

### Absorption defaults (currently fixed in runner)

In `run-causal-cycles.ts`:
- `radiusBase = 6`
- `radiusPerMass = 0.3`
- `capBase = 2`
- `capPerMass = 0.25`
- `minCtxStrength = 0.45`
- `ctxThresholdBase = 0.45`
- `ctxThresholdPerLogMass = 0`
- `hillTau = 8`, `hillSteepness = 2.2`, `betaLex = 0.8`

(Lever mode overrides absorption scoring path but still uses these structural gates.)

---

## 11) Practical Tuning Logic

If you want more merges:
- lower `coupling`
- lower `growthResistance`
- increase locality tolerance (lower `locality`)

If you want more absorption:
- increase `radiusBase/radiusPerMass`
- increase `capBase/capPerMass`
- lower `minCtxStrength` (or `ctxThresholdBase`)
- increase lexical sensitivity (`keywordLexBonus`, lower `coupling`)

If you want stricter L1:
- increase `kernelStrongMinScore` / `kernelWeakMinScore`
- set/increase `kernelMinPairStrength`
- reduce `kernelKLocal` and/or `kernelMaxL1Span`

