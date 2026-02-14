# Project Meepo

**Status:** Meepo V0 Complete, MeepoMind Phases 1-2 Complete, Phase 3 In Progress  
**Current Phase:** Character-Scoped Memory Retrieval (Phase 3)  
**Last Updated:** February 14, 2026

---

## 0. Identity

**Project Name:** Meepo  
*(Deprecated Term: AINPC — no longer used)*

Meepo is a **diegetic NPC system for Discord D&D sessions**.

### What Meepo Is NOT

- A rules engine
- A DM assistant
- An omniscient narrator
- An autonomous AI agent

### What Meepo IS

- A witness
- A gentle prophet of love
- A narrative continuity anchor
- An embodied presence

**Meepo exists inside the world.**

---

## 1. Meepo V0 – What Exists Today

### Core Systems Established

- **Ledger-first architecture** — Append-only omniscient history
- **Narrative authority tiers** — Voice primary, text secondary
- **Persona system** — Meepo, Xoblob
- **STT → LLM → TTS** — Closed voice loop
- **Session tracking** — Automatic start/stop
- **Transcript and recap commands** — DM-only

### Design Principles Established

- Diegetic presence (exists in the world)
- Strict guardrails (no hallucinated lore)
- No omniscient authority (bounded knowledge)
- Minimal commands (natural interaction)

### What Meepo V0 Gave Us

- ✅ Ears (voice input via STT)
- ✅ A voice (TTS output)
- ✅ A body (in imagination)
- ✅ A consistent personality
- ✅ An omniscient ledger (session-scoped, voice-primary)
- ✅ Natural conversation (address-triggered, latch-windowed)

### What We're Building Now

**Memory shaped by character** — Phases 1-2 complete, Phase 3 in progress.
- ✅ Phase 1: Character registry + name discovery
- ✅ Phase 2: Meecap generator (structured emotional segmentation)
- 🔄 Phase 3: Character-scoped memory retrieval (gravity-ordered)
- ⏳ Phase 4+: Gravity scoring, impressions, embodied reflection

---

## 2. MeepoMind (Meepo V0.1)

### Objective

Give Meepo **character-centric, emotionally weighted long-term memory**.

Not database recall. Not embedding search. Not assistant-style context stuffing.

But memory shaped by:

- **People** — Relationships and participants
- **Love** — Affection, sacrifice, protection
- **Tenderness** — Comfort and forgiveness
- **Moral fracture** — Cruelty and betrayal
- **Costly sacrifice** — When it matters

---

## 3. Foundational Model

MeepoMind is built on **five layers**:

### Layer 1 — Ledger (Raw Truth)

- ✅ Already implemented
- Append-only
- Voice-primary
- Canonical source of events

### Layer 2 — Character Registry (YAML, Canonical)

Human-curated source of truth.

**Defines:**
- Canonical names
- Aliases
- Discord ID mapping (for PCs)
- Character type (`pc` | `npc`)
- Optional notes

**Purpose:**
- STT normalization
- Clean recaps
- Beat participant assignment
- Canonical identity control

**Storage:** Lives in-repo (YAML). DB may cache but YAML is source of truth.

### Layer 3 — Name Discovery Tool (Offline)

Offline tool that scans and proposes.

**Process:**
1. Scans ledger
2. Extracts proper name candidates not in registry
3. Ranks by frequency
4. Provides evidence snippets
5. Generates YAML proposals
6. Human reviews and merges into registry

**Result:** Virtuous feedback loop

```
Ledger → Name Scanner → Registry → Better STT Cleanup → Better Meecap
```

### Layer 4 — Meecap (Ledger → Scenes → Beats)

Post-session **structured segmentation** (not a story recap, it is structural).

**Output:**
- Scenes
- Beats (primary emotional memory unit)
- Participants
- Gravity score
- Tags

### Layer 5 — Character-Scoped Memory Retrieval

When a PC speaks, Meepo retrieves:

- Beats involving that character
- Ordered by gravity
- Limited to small working set
- Short-term context + relevant long-term beats = response prompt

**Philosophy:** Meepo remembers people, not everything.

---

## 4. Gravity Model

**Gravity is NOT "importance."**

Gravity is **emotional mass relative to Meepo's character**.

### Meepo Prioritizes (Tiers)

#### Tier 1 — Costly Love
- Self-sacrifice
- Mercy over vengeance
- Protection of the weak

#### Tier 2 — Tenderness
- Comfort
- Forgiveness
- Fear spoken honestly

#### Tier 3 — Moral Fracture
- Cruelty
- Callousness
- Betrayal

### Gravity Influences

- Retrieval ordering
- Memory pruning (future)
- Embodied reactions

### Gravity Does NOT

- Replace short-term context
- Overrule DM authority
- Trigger constant speech

---

## 5. Embodied Presence

Meepo may act physically in imagination:

- Perch on shoulder
- Hug
- Nuzzle
- Withdraw
- Glow softly

### Embodiment Characteristics

- **Rare** — Used sparingly
- **Contextual** — Only when appropriate
- **Gravity-influenced** — Shaped by emotional weight
- **Emotionally punctuating** — Marks significant moments

**Core principle:** Meepo does not dominate scenes. He grounds them.

---

## 6. Development Roadmap

### Phase 1 – Registry & Name Scanner ✅ Complete

**Built:**
- ✅ YAML character registry (6 PCs, 3 NPCs, 3 locations in `data/registry/*.yml`)
- ✅ Ledger name extraction tool (`src/tools/scan-names.ts`)
- ✅ Proposal generation with human review interface (`src/tools/review-names.ts`)
- ✅ STT normalization pass (regex-based, longest-match-first)
- ✅ Live integration: Voice transcripts normalized at ingest + storage of both raw + normalized

**Result:** Canonical names stabilized, virtuous feedback loop enabled (Ledger → Scanner → Registry → Better STT → Better Meecap)

---

### Phase 2 – Meecap Generator ✅ Complete

**Built:**
- ✅ Meecap V1 schema (4-8 scenes, 1-4 beats, ledger-ID anchored)
- ✅ Scene segmentation + beat extraction (LLM-driven with validated JSON)
- ✅ Participant tagging (who was involved)
- ✅ Evidence lists (which ledger entries support each beat)
- ✅ Comprehensive validator (ID existence, range ordering, evidence non-empty)
- ✅ Database persistence + disk export (`meecaps` table with UPSERT pattern)
- ✅ First-class command `/session meecap` with regeneration support
- ✅ Separation of concerns: Ledger → Meecap → Recap (immutable source → regenerable artifact → consumer view)

**Result:** Readable structured memory per session, ready for gravity assignment

---

### Phase 3 – Character-Scoped Retrieval 🔄 In Progress

**Current Work:**
- 🔄 Implement character impression index (which beats involve each PC)
- 🔄 Add beats retrieval API (filter by character + session)
- 🔄 LLM prompt injection (inject retrieved beats as emotional context)
- 🔄 Integration with response generation pipeline

**Expected Result:** When PC speaks, Meepo retrieves and uses relevant high-gravity beats in response prompt

---

### Phase 4 – Gravity & Pruning ⏳ Deferred

**Future Work:**
- Assign gravity scores to Meecap beats (offline, post-session)
- LLM-driven tier assignment (Costly Love, Tenderness, Moral Fracture)
- Retrieval ordering by gravity (emotional relevance)
- Memory pruning strategy (what to keep vs forget)

**Expected Result:** Costly love rises naturally in recall; tenderness guides responses

---

### Phase 5 – Impressions Layer ⏳ Deferred

**Future Work:**
- Aggregate beats into character impressions (relationship arcs)
- Gentle prophetic nudges (Meepo sensing patterns)
- Pattern-based memory synthesis (not literal recall)
- Embodied physical reactions (perch, hug, nuzzle, glow)

**Expected Result:** Meepo reflects essence, not just events

---

## 7. Non-Goals

### Meepo Is NOT

- AGI
- A self-aware entity
- A replacement for human storytelling
- A moral judge
- An autonomous planner

### Meepo Does NOT

- Override the DM
- Inject unsolicited exposition
- Track tactical combat minutiae
- Automatically mutate canon

---

## 8. Design North Star

**Meepo is compelling not because he knows everything.**

**He is compelling because he remembers love.**

---

> When the party becomes jaded,  
> Meepo becomes the reminder.
>
> When chaos overwhelms them,  
> Meepo becomes the grounding presence.
>
> When sacrifice happens,  
> Meepo never forgets.

---

## 9. Version Boundary

| Version | Focus | Status |
|---------|-------|--------|
| **V0** | Voice, Presence, Persona, Ledger | ✅ Complete |
| **V0.1 Phase 1-2** | Character Registry + Meecap Generator | ✅ Complete |
| **V0.1 Phase 3** | Character-Scoped Retrieval | 🔄 In Progress |
| **V0.1 Phase 4+** | Gravity Scoring, Impressions, Embodiment | ⏳ Deferred |
| **V1** | Impressions & Embodied Moral Reflection | 📅 Future (Post-V0.1) |

---

## Final Principle

**Meepo is not building intelligence.**

**Meepo is building continuity.**

**And continuity creates meaning.**

---

*For current implementation details, see [CURRENT_STATE.md](CURRENT_STATE.md). For archived phase breakdowns and deep-dives, see HANDOFF.md, HANDOFF_V0.md, and related docs.*
