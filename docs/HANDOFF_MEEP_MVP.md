# Meepo Bot - Meep MVP Sprint
**Date:** February 12, 2026  
**Status:** Planning → Implementation  
**Focus:** Bronze → Silver → Gold compilation pipeline + Meep memory integration

---

## 🎯 Sprint Objective

Deliver a usable MVP that enables:

- ✅ **Deterministic event compilation** (Bronze → Silver)
- ✅ **PC + NPC knowledge queries** (`/npc knowledge`)
- ✅ **Automatic Meep detection** (Silver annotation)
- ✅ **Meep → MeepoMind (Gold) beats** (emotional memory extraction)
- ✅ **Meepo recalling last Meep usage in chat** (diegetic integration)

**Out of Scope for MVP:**
- ❌ Pronoun resolution
- ❌ Gravity system
- ❌ Topic packs
- ❌ Wanderer routing

---

## 🏛 Architecture Invariants

Surface separation must remain **strict**:

### 1️⃣ Chat (Diegetic Surface)
- **Consumes:** Gold (MeepoMind) only
- **No compilation**
- **No omniscient DB queries**
- **Philosophy:** Meepo only knows what he perceives + emotional memory

### 2️⃣ Slash Commands (DM Console)
- **Query:** Silver + Gold
- **Deterministic output**
- **Show provenance**
- **Philosophy:** DM tools operate on compiled knowledge

### 3️⃣ Tools/CLI (Build Surface)
- **Perform:** Bronze → Silver → Gold compilation
- **Regenerable**
- **Idempotent**
- **Philosophy:** Build artifacts from immutable ledger

---

## 📊 Data Layer Overview

### Bronze (Immutable Source)
```
ledger (existing)
├── ledger_id (PK)
├── session_id
├── content_text (normalized)
└── speaker → registry PC/NPC
```

### Silver (Compiled Events + Exposure Index)
```
events
├── event_id (PK, UUID)
├── session_id
├── ledger_id_start
├── ledger_id_end
├── title
├── has_meep (0|1)
├── created_at_ms
└── updated_at_ms

character_event_index
├── event_id (PK)
├── character_id (PK)
└── exposure_type (direct|witnessed|heard|mentioned)

meep_usages
├── ledger_id (PK)
├── session_id
├── event_id
├── pc_id
└── created_at_ms
```

### Gold (MeepoMind Emotional Memory)
```
meepomind_beats
├── beat_id (PK, UUID)
├── source_ledger_id (UNIQUE)
├── session_id
├── pc_id
├── beat_json (summary|stakes|outcome|evidence)
└── created_at_ms
```

---

## 🟢 Phase 1 — Data Layer Foundations

### Task 1: Add Schema Migrations

**File:** `src/db/schema.sql`

**Tables to Add:**

```sql
-- Silver: Event Segmentation
CREATE TABLE IF NOT EXISTS events (
    event_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    ledger_id_start TEXT NOT NULL,
    ledger_id_end TEXT NOT NULL,
    title TEXT NOT NULL,
    has_meep INTEGER DEFAULT 0,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

-- Silver: Character Exposure Index
CREATE TABLE IF NOT EXISTS character_event_index (
    event_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    exposure_type TEXT NOT NULL CHECK(exposure_type IN ('direct', 'witnessed', 'heard', 'mentioned')),
    PRIMARY KEY(event_id, character_id),
    FOREIGN KEY (event_id) REFERENCES events(event_id)
);

-- Silver: Meep Usage Tracking
CREATE TABLE IF NOT EXISTS meep_usages (
    ledger_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    event_id TEXT,
    pc_id TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    FOREIGN KEY (ledger_id) REFERENCES ledger(ledger_id),
    FOREIGN KEY (event_id) REFERENCES events(event_id)
);

-- Gold: MeepoMind Emotional Beats
CREATE TABLE IF NOT EXISTS meepomind_beats (
    beat_id TEXT PRIMARY KEY,
    source_ledger_id TEXT UNIQUE NOT NULL,
    session_id TEXT NOT NULL,
    pc_id TEXT NOT NULL,
    beat_json TEXT NOT NULL, -- {summary, stakes, outcome, evidence_ledger_ids}
    created_at_ms INTEGER NOT NULL,
    FOREIGN KEY (source_ledger_id) REFERENCES meep_usages(ledger_id)
);
```

**Acceptance Criteria:**
- [ ] Migration runs clean
- [ ] Tables visible via `sqlite3`
- [ ] Foreign key constraints validated

---

## 🟡 Phase 2 — Bronze → Silver Compile

### Task 2: Build `compile-session.ts`

**File:** `src/tools/compile-session.ts`

**CLI Signature:**
```bash
npx tsx src/tools/compile-session.ts --session <SESSION_ID>
```

**Step A: Event Segmentation**

1. Load normalized transcript for session (from `ledger`)
2. Call LLM with prompt:
   ```
   Segment this session transcript into narrative events.
   Return JSON array:
   [
     {
       "start_index": 0,
       "end_index": 45,
       "title": "Brief descriptive title"
     }
   ]
   ```
3. Validate spans (no gaps/overlaps)
4. UPSERT into `events`:
   - `event_id` = UUID
   - `ledger_id_start` / `ledger_id_end` from transcript indices
   - `title` from LLM output
   - `created_at_ms` = now
   - `updated_at_ms` = now

**Step B: PC Exposure Mapping**

For each event:
1. Extract speakers in span → `exposure_type = "direct"`
2. Query active party (from registry or session metadata)
3. Other PCs in party → `exposure_type = "witnessed"`
4. INSERT into `character_event_index` (idempotent via PRIMARY KEY)

**Acceptance Criteria:**
- [ ] Events generated correctly (no overlaps)
- [ ] PC exposures populated for all events
- [ ] Re-running compile does not duplicate rows (UPSERT behavior)
- [ ] Output shows: `✓ Generated 12 events, 47 character exposures`

**Key Files:**
- `src/tools/compile-session.ts` (new)
- `src/ledger/ledger.ts` (query by session)
- `src/llm/client.ts` (LLM call)
- `src/registry/loadRegistry.ts` (PC list)

---

## 🟡 Phase 3 — NPC Exposure CLI

### Task 3: Build `review-npc-exposure.ts`

**File:** `src/tools/review-npc-exposure.ts`

**CLI Signature:**
```bash
npx tsx src/tools/review-npc-exposure.ts --session <SESSION_ID>
```

**Flow:**

For each event in session:
1. Display:
   ```
   Event 3/12: "Confrontation at the Yawning Portal"
   Ledger: #0045 - #0089 (44 lines)
   
   [Excerpt of first 5 + last 5 lines]
   
   Detected NPCs: Durnan, Yagra Stonefist
   ```

2. Prompt user for each NPC:
   ```
   Durnan:
     [d] direct (spoke/acted in event)
     [w] witnessed (present but passive)
     [h] heard (mentioned, not present)
     [m] mentioned only (skip indexing)
     [s] skip this NPC
     [q] quit
   
   Choice:
   ```

3. Insert into `character_event_index` based on choice:
   - `d` → `exposure_type = "direct"`
   - `w` → `exposure_type = "witnessed"`
   - `h` → `exposure_type = "heard"`
   - `m`, `s` → skip
   - `q` → save progress and exit

**Acceptance Criteria:**
- [ ] Can classify all NPC exposures for a session
- [ ] `/npc knowledge <NPC>` returns correct events (tested manually)
- [ ] Re-running tool shows already-classified NPCs (skip or override prompt)

**Key Files:**
- `src/tools/review-npc-exposure.ts` (new)
- `src/registry/loadRegistry.ts` (NPC detection)
- `src/registry/normalizeText.ts` (name matching)

---

## 🟡 Phase 4 — Meep Detection (Silver Annotation)

### Task 4: Integrate Meep Detection into Compile

**File:** `src/tools/compile-session.ts` (extend)

**Add Step C: Meep Detection**

For each event span (after event creation):

1. Scan ledger entries in span for pattern:
   ```typescript
   const hasMeep = /\bmeep\b/i.test(content_text) &&
                   /(use|spend|reroll|redo|meep!)/i.test(content_text);
   ```

2. If match:
   - Set `events.has_meep = 1` (UPDATE)
   - Extract PC speaker from ledger entry
   - Map speaker → `pc_id` via registry
   - INSERT into `meep_usages`:
     ```typescript
     {
       ledger_id: entry.ledger_id,  // PRIMARY KEY
       session_id: session_id,
       event_id: event.event_id,
       pc_id: resolved_pc_id,
       created_at_ms: Date.now()
     }
     ```

**Acceptance Criteria:**
- [ ] Meep usages auto-populate during compile
- [ ] Recompile is idempotent (no duplicate `meep_usages`)
- [ ] `SELECT * FROM events WHERE has_meep=1` returns correct events
- [ ] `SELECT COUNT(*) FROM meep_usages WHERE session_id=<ID>` matches manual count

**Example Output:**
```
✓ Generated 12 events
✓ Mapped 47 character exposures
✓ Detected 3 Meep usages:
  - Event "Saving Durnan" → Thokk (ledger #0067)
  - Event "Regroup at Camp" → Elara (ledger #0234)
  - Event "Final Stand" → Thokk (ledger #0401)
```

---

## 🟡 Phase 5 — Meep → Gold (MeepoMind)

### Task 5: Add Gold Beat Extraction

**File:** `src/tools/compile-session.ts` (extend)

**Add Step D: Generate MeepoMind Beats**

For each row in `meep_usages` (after detection):

1. **Gather context:**
   - Event title (from `events`)
   - Meep line (from `ledger` via `source_ledger_id`)
   - ±5 lines context (surrounding ledger entries)

2. **Call LLM:**
   ```typescript
   const prompt = `
   Extract an emotional beat from this Meep usage.
   
   Event: "${event.title}"
   Context:
   ${contextLines.join('\n')}
   
   >>> MEEP LINE: "${meepLine}" <<<
   
   Return JSON:
   {
     "summary": "2-sentence emotional core",
     "stakes": "What mattered to the PC",
     "outcome": "Result (if visible)", // or null
     "evidence_ledger_ids": ["id1", "id2"]
   }
   `;
   ```

3. **UPSERT into `meepomind_beats`:**
   ```typescript
   {
     beat_id: uuid(),
     source_ledger_id: meepUsage.ledger_id,  // UNIQUE constraint
     session_id: session_id,
     pc_id: meepUsage.pc_id,
     beat_json: JSON.stringify(llmOutput),
     created_at_ms: Date.now()
   }
   ```

**Acceptance Criteria:**
- [ ] Each Meep produces exactly one beat
- [ ] Recompile does not duplicate beats (UPSERT via `source_ledger_id`)
- [ ] Beat JSON stored cleanly (valid JSON)
- [ ] Query: `SELECT beat_json FROM meepomind_beats WHERE pc_id='thokk'` returns structured memory

**Example Output:**
```json
{
  "summary": "Thokk invoked a Meep to reroll a failed save, protecting Durnan from a collapsing beam. His desperation reflected his growing loyalty to the innkeeper.",
  "stakes": "Durnan's safety and Thokk's sense of duty",
  "outcome": "Success - beam diverted, Durnan unharmed",
  "evidence_ledger_ids": ["ledger_0065", "ledger_0067", "ledger_0069"]
}
```

---

## 🔵 Phase 6 — DM Commands

### Task 6: `/npc knowledge <name>`

**File:** `src/commands/npc.ts` (new) or extend `src/commands/meepo.ts`

**Command:**
```typescript
.addStringOption(option =>
  option.setName('name')
    .setDescription('NPC name')
    .setRequired(true)
)
```

**Logic:**

1. Resolve NPC name → `character_id` via registry
2. Query:
   ```sql
   SELECT 
     e.title,
     cei.exposure_type,
     e.session_id,
     s.label AS session_label
   FROM character_event_index cei
   JOIN events e ON cei.event_id = e.event_id
   JOIN sessions s ON e.session_id = s.session_id
   WHERE cei.character_id = ?
   ORDER BY e.created_at_ms DESC;
   ```

3. Format output:
   ```
   📚 Knowledge Index: Durnan
   
   🎬 Direct Participation (spoke/acted):
   • "Confrontation at the Yawning Portal" (Session: Into the Undermountain, Feb 10)
   • "Rescue at the Bar" (Session: Into the Undermountain, Feb 10)
   
   👁️ Witnessed (present):
   • "Party Introduction" (Session: Into the Undermountain, Feb 10)
   
   👂 Heard About (mentioned):
   • "Planning the Descent" (Session: Into the Undermountain, Feb 10)
   ```

**Acceptance Criteria:**
- [ ] Returns all indexed events for NPC
- [ ] Grouped by exposure type
- [ ] Shows session context
- [ ] Handles NPC not found gracefully

---

### Task 7: `/meeps session`

**File:** `src/commands/session.ts` (extend subcommands)

**Command:**
```typescript
.addSubcommand(subcommand =>
  subcommand
    .setName('meeps')
    .setDescription('Show Meep usages and emotional beats for this session')
)
```

**Logic:**

1. Get active `session_id` from interaction context
2. Query:
   ```sql
   SELECT 
     mb.beat_json,
     e.title AS event_title,
     p.name AS pc_name,
     mu.ledger_id,
     mb.created_at_ms
   FROM meepomind_beats mb
   JOIN meep_usages mu ON mb.source_ledger_id = mu.ledger_id
   JOIN events e ON mu.event_id = e.event_id
   JOIN registry p ON mu.pc_id = p.character_id  -- assumes PCs in registry
   WHERE mb.session_id = ?
   ORDER BY mb.created_at_ms ASC;
   ```

3. Format output:
   ```
   ✨ Meep Emotional Beats — Session: Into the Undermountain
   
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   1. Thokk — "Saving Durnan"
   
   💭 Thokk invoked a Meep to reroll a failed save, protecting 
      Durnan from a collapsing beam. His desperation reflected 
      his growing loyalty to the innkeeper.
   
   Stakes: Durnan's safety and Thokk's sense of duty
   Outcome: Success - beam diverted, Durnan unharmed
   Evidence: ledger #0065, #0067, #0069
   
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   2. Elara — "Regroup at Camp"
   
   💭 Elara spent a Meep to reroll initiative, anxious about 
      protecting the injured party member during a surprise attack.
   
   Stakes: Party survival and Elara's role as protector
   Outcome: Partial success - initiative improved but ambush still costly
   Evidence: ledger #0232, #0234
   
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ```

**Acceptance Criteria:**
- [ ] Shows all Meeps for current session
- [ ] Displays beat summary, stakes, outcome
- [ ] Includes evidence references
- [ ] Handles no-Meeps gracefully: `"No Meeps used this session"`

---

## 🔵 Phase 7 — Chat Integration (Diegetic Magic)

### Task 8: Inject Meep Memory into Meepo Prompt

**File:** `src/personas/meepo.ts` (extend system prompt builder)

**Logic:**

When PC addresses Meepo (detected via `src/meepo/triggers.ts`):

1. **Identify speaker:**
   ```typescript
   const speakerPcId = await resolveSpeakerToPcId(message.author.id);
   if (!speakerPcId) return; // Not a PC, skip memory injection
   ```

2. **Query recent beats:**
   ```sql
   SELECT beat_json
   FROM meepomind_beats
   WHERE pc_id = ?
   ORDER BY created_at_ms DESC
   LIMIT 2;
   ```

3. **Inject into prompt:**
   ```typescript
   const systemPrompt = `
   ${basePersona}
   
   ## Relevant Emotional Memory
   ${beats.length > 0 ? `
   You recall these moments with ${pcName}:
   
   ${beats.map(b => `- ${JSON.parse(b.beat_json).summary}`).join('\n')}
   
   *Reference these memories naturally if relevant to the conversation.*
   ` : ''}
   `;
   ```

**Example Injection:**
```
## Relevant Emotional Memory
You recall these moments with Thokk:

- Thokk invoked a Meep to reroll a failed save, protecting Durnan 
  from a collapsing beam. His desperation reflected his growing 
  loyalty to the innkeeper.

- Thokk spent a Meep during the final stand, rerolling an attack to 
  save the party. The weight of leadership was visible in his eyes.

*Reference these memories naturally if relevant to the conversation.*
```

**Acceptance Criteria:**
- [ ] Meepo references recent Meep usage naturally in responses
- [ ] No large context expansion (≤2 beats, ~100 tokens)
- [ ] Memory only injected for recognized PCs
- [ ] Example prompt test:
  ```
  Player (Thokk): "Meepo, do you remember what happened at the Yawning Portal?"
  
  Meepo: "Oh! Oh yes! *bounces excitedly* You saved Durnan when the 
         ceiling came down! I saw how scared you were... but you 
         didn't hesitate! That's what heroes do!"
  ```

**Key Files:**
- `src/personas/meepo.ts` (prompt builder)
- `src/db.ts` (query meepomind_beats)
- `src/registry/loadRegistry.ts` (PC resolution)

---

## 🛑 MVP STOP CONDITION

**You stop expanding when:**

✅ `compile-session` works reliably (event segmentation + PC/NPC exposure + Meep detection + beat extraction)  
✅ `/npc knowledge` queries are accurate  
✅ Meeps are automatically promoted to Gold (MeepoMind beats)  
✅ Meepo recalls Meeps naturally in chat  
✅ **It feels powerful at the table** (playtest validation)

**No further scope creep until tested in live session.**

---

## 🧪 Testing Checklist

### Phase 2-5: Compilation Pipeline
```bash
# 1. Run compile on test session
npx tsx src/tools/compile-session.ts --session <UUID>

# 2. Verify events table
sqlite3 data/bot.sqlite "SELECT COUNT(*) FROM events WHERE session_id='<UUID>';"

# 3. Verify PC exposures
sqlite3 data/bot.sqlite "SELECT * FROM character_event_index WHERE event_id IN (SELECT event_id FROM events WHERE session_id='<UUID>');"

# 4. Verify Meep detection
sqlite3 data/bot.sqlite "SELECT * FROM meep_usages WHERE session_id='<UUID>';"

# 5. Verify MeepoMind beats
sqlite3 data/bot.sqlite "SELECT beat_id, pc_id, json_extract(beat_json, '$.summary') FROM meepomind_beats WHERE session_id='<UUID>';"
```

### Phase 3: NPC Review
```bash
# Run NPC exposure review
npx tsx src/tools/review-npc-exposure.ts --session <UUID>

# Verify NPC exposures were added
sqlite3 data/bot.sqlite "SELECT COUNT(*) FROM character_event_index WHERE exposure_type IN ('direct', 'witnessed', 'heard');"
```

### Phase 6: DM Commands
```discord
/npc knowledge Durnan
Expected: List of events with exposure types

/session meeps
Expected: Formatted list of Meep beats for current session
```

### Phase 7: Chat Integration
```discord
# In active session with compiled Meeps
meepo: hey, do you remember when I used my meep?

Expected: Meepo responds with natural reference to the beat memory
```

---

## 📁 File Inventory

### New Files
- [ ] `src/tools/compile-session.ts` - Bronze→Silver→Gold compiler
- [ ] `src/tools/review-npc-exposure.ts` - Interactive NPC exposure classifier
- [ ] `src/commands/npc.ts` - NPC knowledge query command (or extend existing)

### Modified Files
- [ ] `src/db/schema.sql` - Add 4 new tables
- [ ] `src/commands/session.ts` - Add `/session meeps` subcommand
- [ ] `src/personas/meepo.ts` - Inject MeepoMind beats into prompt
- [ ] `src/db.ts` - Add query helpers for new tables

### Dependencies
- Existing: `src/ledger/ledger.ts` (session transcript queries)
- Existing: `src/llm/client.ts` (LLM calls for segmentation + beat extraction)
- Existing: `src/registry/loadRegistry.ts` (PC/NPC resolution)
- Existing: `src/registry/normalizeText.ts` (name matching)

---

## 🔄 Iteration Philosophy

**This is an MVP sprint.** Prioritize:

1. **Working end-to-end** over perfect segmentation
2. **Manual NPC review** over automated NLP (for now)
3. **Simple Meep detection** (regex) over ML classification
4. **2 beat limit** in prompt over sophisticated retrieval

**Ship it, test it at the table, then iterate.**

---

## 📝 Dev Log

### 2026-02-12: Sprint Planning
- Created HANDOFF_MEEP_MVP.md roadmap
- Defined 7-phase implementation plan
- Established strict surface separation architecture
- **Next:** Implement Phase 1 schema migrations

---

## 🚀 Quick Reference

### Compile a Session
```bash
npx tsx src/tools/compile-session.ts --session <SESSION_ID>
```

### Review NPC Exposures
```bash
npx tsx src/tools/review-npc-exposure.ts --session <SESSION_ID>
```

### Query Silver Layer
```sql
-- Get events with Meeps
SELECT title, session_id FROM events WHERE has_meep=1;

-- Get NPC knowledge index
SELECT e.title, cei.exposure_type 
FROM character_event_index cei
JOIN events e ON cei.event_id = e.event_id
WHERE cei.character_id = 'durnan';

-- Get Meep usages
SELECT pc_id, event_id, ledger_id FROM meep_usages;
```

### Query Gold Layer
```sql
-- Get MeepoMind beats for PC
SELECT 
  json_extract(beat_json, '$.summary') AS summary,
  json_extract(beat_json, '$.stakes') AS stakes
FROM meepomind_beats
WHERE pc_id = 'thokk'
ORDER BY created_at_ms DESC;
```

---

**End of Roadmap. Let's build.** 🏗️
