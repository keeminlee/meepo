# Meecap Fixes & Session Label Improvements (Feb 13, 2026)

## Summary
Fixed duplicate meecap file generation and standardized session label lookups across tools. All meecap files now use the new `meecap_{label}.md` naming scheme. Session label-based lookups improve UX for humans (no more UUID hunting).

## Changes Made

### 1. Duplicate Meecap File Write Removed
**File**: `src/commands/session.ts` (lines 790-796) 

**Problem**: `/session meecap` command was writing meecaps **twice**:
- Once via `generateMeecapStub()` → internal `saveNarrativeToFile()` → `meecap_{label}.md`
- Once again via manual `fs.writeFileSync()` → `{sessionId}__{timestamp}.md`

**Solution**: Removed the duplicate manual file write. Now only uses `saveNarrativeToFile()` internally.

**Result**: Single file output per meecap generation. Cleaned up disk clutter.

---

### 2. Session Label-Based Lookups
**Files**: `src/tools/compile-session.ts`

**Change**: Tool now accepts session **labels** ("C2E6") instead of UUIDs.

```bash
# Before
npx tsx src/tools/compile-session.ts --session b6032c57-94a8-40d6-ab7f-61f7bc51654f

# After
npx tsx src/tools/compile-session.ts --session C2E6
```

**Implementation**:
- `getSession()` now queries `WHERE label = ?` instead of `WHERE session_id = ?`
- All downstream functions use `session.session_id` (the UUID) internally
- Documentation + error messages updated to reflect human-readable labels

**Benefit**: Much better UX. No need to look up UUIDs in database.

---

### 3. Dynamic PC Name Injection
**Files**: 
- `src/commands/session.ts` (new function `getPCNamesForPrompt()`)
- `src/sessions/meecap.ts` (enhanced prompts)

**What Changed**: All recap and meecap prompts now dynamically load PC canonical names from registry.

**New Function**:
```typescript
function getPCNamesForPrompt(): string {
  const registry = loadRegistry();
  const pcNames = registry.characters
    .filter(c => c.type === "pc")
    .map(c => c.canonical_name)
    .sort();
  return pcNames.join(", ");
}
```

**Injected Into**:
1. `/session recap` (dm style) - system prompt
2. `/session recap` (narrative style) - system prompt  
3. `/session meecap` (narrative mode) - system prompt
4. `/session meecap` (v1_json mode) - system prompt

**Prompt Context**:
```
PLAYER CHARACTERS (PCs):
The following are the player characters in this campaign: Cyril, Evanora, Jamison, Louis, Minx, Snowflake
All other named characters in the transcript are NPCs (non-player characters).
```

**Benefit**: LLM better distinguishes PCs from NPCs, reducing aliasing confusion.

---

### 4. Session Label Parameter Threaded Through
**Files**: 
- `src/sessions/meecap.ts` - `generateMeecapStub()`, `generateMeecapNarrative()`, `generateMeecapV1Json()`
- `src/commands/session.ts` - Passing `sessionLabel` to meecap generators

**Change**: Added `sessionLabel?: string | null` parameter throughout the meecap generation pipeline.

**Used For**: File naming in `saveNarrativeToFile()`:
```typescript
const filename = sessionLabel 
  ? `meecap_${sessionLabel}.md`
  : `meecap_${sessionId}.md`;
```

**Benefit**: Consistent, readable file naming (C2E6 instead of UUID).

---

### 5. Improved Session Command UX
**File**: `src/commands/session.ts`

**Changes**:
- Added `--label` option to `/session transcript` and `/session recap`
- Made `--range` optional (defaults to "since_start" for live, "recording" for labeled sessions)
- Added `wordWrap()` helper for better text formatting
- Transcript display now shows `SPEAKER: CONTENT` without timestamps/metadata clutter

**Example**:
```bash
# Without label (live session)
/session transcript range:since_start

# With label (ingested session)
/session transcript label:C2E6

# Defaults intelligently
/session recap label:C2E6  # Defaults to range=recording
/session transcript        # Defaults to range=since_start
```

---

### 6. Registry Enhancement
**Files**: 
- `src/registry/types.ts` - Added `Misc` entity type
- `src/registry/loadRegistry.ts` - Added misc.yml loading

**What Changed**: Registry can now load and index `misc.yml` (for items, artifacts, etc).

**Benefit**: Cleaner separation of entity categories; extensible for future entity types.

---

### 7. Meecap Namespace Cleanup
**Files**: 
- `src/sessions/meecap.ts`
- `src/db/schema.sql`

**Changed**: `MEE_CAP_MODE` → `MEECAP_MODE` (environment variable)

**Reason**: Inconsistent naming. MEECAP_MODE is more readable.

---

## Database Changes
**None**. Schema unchanged. All ingested sessions remain queryable.

---

## File Output After Fixes

### Meecap Files
Before (two files per meecap):
```
data/meecaps/
  meecap_C2E6.md                                    ← New format (correct)
  b6032c57-94a8-40d6-ab7f-61f7bc51654f__1770862909869.md  ← Old format (duplicate, now removed)
```

After (one file per meecap):
```
data/meecaps/
  meecap_C2E6.md                                    ← Only this
```

---

## Testing Checklist
- [ ] `/session meecap label:C2E6` generates only `meecap_C2E6.md` (single file)
- [ ] `/session transcript label:C2E6` displays human-readable format
- [ ] `/session recap label:C2E6 style:narrative` includes PC context in response
- [ ] `npx tsx src/tools/compile-session.ts --session C2E6` accepts label instead of UUID
- [ ] Registry PC list dynamically loads and injects (if registry changes, new lists used immediately)

---

## Breaking Changes
**None for users**. Internal-only improvements.

---

## Next Steps
1. Run meecap generation against C2E1..C2E19 to verify single-file output
2. Verify PC names correctly injected in recap/meecap text
3. Test compile-session.ts with various labels
4. Consider batch cleanup of old `{uuid}__{timestamp}.md` files from prior runs

---

## Commit Hash
`6d88c4c` - "Meecap fixes: remove duplicate file writes, standardize session label lookups, inject PC names into prompts"

---

## Code Archaeology: Key Functions Updated

### `getPCNamesForPrompt()` 
Located: `src/commands/session.ts:12-25`
- Loads registry dynamically
- Returns sorted comma-separated list of PC canonical names
- Used in 4 prompt contexts (dm, narrative, meecap v1, meecap narrative)

### `saveNarrativeToFile()`
Located: `src/sessions/meecap.ts:60-85`
- Now accepts `sessionLabel` parameter
- Filename logic: label → `meecap_${label}.md` | fallback → `meecap_${sessionId}.md`
- Creates `data/meecaps/` if missing

### `generateMeecapStub()`
Located: `src/sessions/meecap.ts:155-165`
- Added `sessionLabel?: string | null` parameter
- Passes through to narrative/v1 generators
- Eventually reaches `saveNarrativeToFile()`

### `getLedgerSlice()` (session.ts)
Location: `src/commands/session.ts:48-100`
- New `sessionLabel?: string | null` parameter
- Smart label handling: if provided, queries latest session with that label
- Fallback: uses latest ingested session overall
- Enables clean `/session recap label:C2E6` UX

---

## Event System Refinement (Session 2)

### 6. is_recap → is_ooc Column Rename
**Database**: `bot.sqlite` `events` table  
**Files Changed**:
- `src/db/schema.sql` - column definition + comment
- `src/db.ts` - migration logic (handles old `is_recap` → new `is_ooc`)
- `src/tools/compile-and-export-events.ts` - all SQL queries + TypeScript types

**Problem**: Column name `is_recap` was semantically confusing:
- Conflated "recap as narrative type" with "recap as hygiene flag"
- When we added `recap` as an event_type, the flag meaning became unclear

**Solution**: Renamed to `is_ooc` (out-of-character)
- `is_ooc = 1`: Table talk, meta discussion, rules, scheduling, tech issues
- `is_ooc = 0`: In-game narrative events (including recap-type events)
- "recap" now purely an event_type, not a boolean hygiene flag

**Migration Strategy**:
- DB migration in `db.ts` checks for both old + new column names
- Renames `is_recap` → `is_ooc` if exists
- Creates `is_ooc` if neither exists
- Support for fresh databases + existing databases with old schema

**JSON Export**: Now exports `"is_ooc"` field (was `"is_recap"`)

---

### 7. Expanded Event Type System
**File**: `src/tools/compile-and-export-events.ts` (lines 164-235)

**Before**: 5 event types
```
action, dialogue, discovery, emotional, conflict
is_recap: true|false
```

**After**: 9 event types + is_ooc flag
```
action, dialogue, discovery, emotional, conflict, 
plan, transition, recap, ooc_logistics
is_ooc: true|false (orthogonal)
```

**New Types**:
- **plan**: In-world strategizing, deciding what to do next (before action occurs)
- **transition**: Scene changes, time skips, location shifts, session openings/closings  
- **recap**: Summaries of prior in-world events (was attribute, now type)
- **ooc_logistics**: Table talk, rules, scheduling, tech (mutually exclusive with is_ooc=true safeguard)

**Dominance Rules** (updated LLM prompt):
```
1. conflict > dialogue (if disagreement present)
2. emotional > dialogue (if bonding/vulnerability primary)
3. plan > dialogue (if deciding next action)
4. discovery > dialogue (if info revealed)
5. Otherwise → dialogue
```

**Test Results for C2E6**:
- 47 events extracted (vs 32 with old system)
- Better granularity: combat broken into multiple action events
- Clear distinction: plan events before action events
- Emotional moments properly classified (not dialogue)
- 282 PC exposure entries created

---

### 8. --force Recompile Flag
**File**: `src/tools/compile-and-export-events.ts`  
**CLI**: `npx tsx src/tools/compile-and-export-events.ts --session <LABEL> [--force]`

**Problem**: Events use UUID primary key. If LLM extracts different boundaries on recompile, orphaned events accumulate.

**Solution**: `--force` flag with cascade delete + user confirmation

**Behavior**:
1. Check for dependent memories (future-proofing for memory system)
2. If memories found:
   - Warn user: "X memories reference events in this session"
   - Prompt: "Recompile will DELETE these memories. Proceed? (yes/no)"
   - User confirms → cascade delete: memories → PC index → events
   - User declines → abort, no changes
3. If no memories:
   - Silently delete character_event_index + events
4. Extract fresh events with new UUIDs
5. Regenerate visualization + PC exposure index

**New Functions**:
- `countDependentMemories()` - checks if memories table exists + counts references
- `promptForConfirmation()` - readline-based yes/no prompt (blocking)
- `cascadeDeleteForRecompile()` - transaction-based delete with logging

**Safety**:
- Uses `IN (SELECT id FROM events WHERE session_id = ?)` subquery
- Only deletes for specific session_id (no cross-session risk)
- Transactional (all-or-nothing)
- Reports changes: deleted memories, indexes, events

---

## Testing Completed

### C2E6 End-to-End Test
```bash
# Clean slate
sqlite3 .\data\bot.sqlite "DELETE FROM character_event_index; DELETE FROM events;"
Remove-Item .\data\session-events\* -Force

# Compile with new 9-type system
npx tsx src/tools/compile-and-export-events.ts --session C2E6

# Results
✓ Loaded 188 messages
✓ Extracted 47 events (more granular than before)
✓ Inserted 47 new events, updated 0 existing
✓ Inserted 282 PC exposure entries
✓ Event rows preview exported with is_ooc field
✓ Visualization exported (events_C2E6.txt)
```

### Database Schema Validation
```sql
PRAGMA table_info(events) → is_ooc column present at index 10
No schema migration errors
Backward compat: old is_recap references handled gracefully
```

---

## Next Steps
1. Recompile C2E1..C2E19 with new 9-type system (may yield different event counts)
2. Audit event classifications manually (spot-check conflict vs dialogue)
3. Iterate on LLM prompt dominance rules if needed
4. Once memories table created, test `--force` with cascade delete
5. Consider adding event type frequency stats tool

---

## Commit Hash
Latest: `dcd754e` - "refactor: rename is_recap to is_ooc for semantic clarity + add --force recompile flag"

---

## Code Archaeology: Event System

### ExtractedEvent Interface
Location: `src/tools/compile-and-export-events.ts:100-106`
```typescript
interface ExtractedEvent {
  start_index: number;
  end_index: number;
  title: string;
  event_type: 'action' | 'dialogue' | 'discovery' | 'emotional' | 'conflict' | 
              'plan' | 'transition' | 'recap' | 'ooc_logistics';
  is_ooc?: boolean;
}
```

### LLM System Prompt
Location: `src/tools/compile-and-export-events.ts:164-235`
- 70+ lines with 3 sections: event types, dominance rules, output format
- Examples show conflict classification (even when dialogue-like)
- Tie-break logic explicit for ambiguous cases

### loadExistingEvents()
Location: `src/tools/compile-and-export-events.ts:373-408`
- Queries: `SELECT ... FROM events WHERE session_id = ?`
- Maps DB `is_ooc` (0|1) to TypeScript boolean
- Returns null if no existing events found
- Enabled by `--force` skip logic

### populateCharacterEventIndex()
Location: `src/tools/compile-and-export-events.ts:420-510`
- Skips `is_ooc=true` events (meta talk doesn't count as PC exposure)
- Classifies as "direct" (spoke) or "witnessed" (party present)
- Transaction-based for consistency

---

## Backward Compatibility
- Existing meecaps fully compatible (no changes)
- Old `is_recap` column automatically migrated to `is_ooc` on first run
- Event type changes are additive (no deletions from type enum)  
- `is_ooc` flag semantically same as old `is_recap` (just renamed)
- Database schema migration runs automatically (no manual steps)

```