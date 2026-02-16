# Meepo Mission Economy V0

## Overview

V0 introduces a **mission-based meep minting system** that integrates with the existing `/meeps` command infrastructure. Missions are deterministic, auditable requests to reward players with meeps for engagement activities.

**Key Design**: Missions use the same centralized meep engine as `/meeps reward`, ensuring a single source of truth for balance and cap enforcement.

---

## Architecture

### Core Components

#### 1. **Meep Engine** (`src/meeps/engine.ts`)
Shared transaction executor replacing direct SQL calls in command handlers:
- `getBalance(guildId, targetDiscordId)` — Query current balance
- `spendMeep(opts)` — Deduct 1 meep (player action)
- `creditMeep(opts)` — Attempt to mint 1 meep with detailed source tracking

**creditMeep() Return Values:**
```typescript
// Success
{ success: true, balance: 3, txId: "uuid" }

// Capped
{ success: false, reason: "capped", balance: 3 }

// Error
{ success: false, reason: "error" }
```

#### 2. **Enhanced Meep Transactions** (`src/meeps/meeps.ts`)
Schema enriched with source metadata:
```sql
source_type:        'dm' | 'mission' | 'meepo' | 'system' | 'player_spend'
source_ref:         'mission_claim:123', 'dm:user_id', etc.
session_id:         Session this meep was earned in
anchor_session_id:  For narrative alignment (future)
anchor_line_index:  Ledger line reference (future)
```

#### 3. **Mission Claims** (`guild_runtime_state` + `mission_claims` tables)
**Mission Claims Table**: Append-only ledger of mission completions
```sql
CREATE TABLE mission_claims (
  id INTEGER PRIMARY KEY,
  guild_id, session_id, mission_id,
  claimant_discord_id,      -- Who recorded it (DM)
  beneficiary_discord_id,   -- Who earned meeps
  created_at_ms,
  status:  'claimed' | 'minted' | 'blocked_cap' | 'rejected',
  note,                     -- Optional DM reason
  meta_json                 -- {tx_id, reason, ...}
);

-- Enforce: max 1 per mission per player per session
UNIQUE INDEX (guild_id, session_id, mission_id, beneficiary_discord_id)
```

**Guild Runtime State**: Minimal session management
```sql
CREATE TABLE guild_runtime_state (
  guild_id TEXT PRIMARY KEY,
  active_session_id TEXT,   -- NULL if no session active
  updated_at_ms
);
```

#### 4. **Mission Definitions** (`economy/missions.yml`)
YAML config file defining available missions:
```yaml
missions:
  - id: session_summary
    name: "Submit a session summary"
    kind: permanent          # Available every session
    max_per_player_per_session: 1
    reward:
      meeps: 1
    description: "..."
  
  - id: pc_significant_convo
    name: "Character-significant conversation with another PC"
    kind: temporary          # One-time per session, resets next session
    max_per_player_per_session: 1
    reward:
      meeps: 1
    applies_to: both_participants
```

Mission loader validates schema and caches missions (`src/missions/loadMissions.ts`).

#### 5. **Session Runtime** (`src/sessions/sessionRuntime.ts`)
Simple API for managing active session:
```typescript
getActiveSessionId(guildId)        // -> string | null
setActiveSessionId(guildId, sessionId)
clearActiveSessionId(guildId)
```

Replaces manual session management; enables `/missions claim` to default to active session.

---

## Commands

### `/meeps` (No Changes in V0, But Now Uses Engine)
- `spend`: Uses `spendMeep()` from engine
- `reward`: Uses `creditMeep()` from engine (source_type='dm')
- `balance` / `history`: Unchanged query functions
- **Effect**: DM rewards and mission mints are now indistinguishable in balance calc; only source_type differs in audit trail

### `/missions` (New)

#### `claim` (DM-only)
Record a mission completion and auto-mint meeps.
```bash
/missions claim mission:session_summary target:@PlayerName [note:optional reason]
```

**Flow:**
1. Validate DM role
2. Check active session (error if none)
3. Validate mission exists
4. Check unique constraint: has this player already claimed this mission this session?
5. Insert mission_claims row with status='claimed'
6. Get current balance
7. If balance >= 3: update status → 'blocked_cap', reply "cap reached"
8. Else: call `creditMeep(source_type='mission', ...)` → update status → 'minted', log to channel

**Example Reply:**
```
Mission claimed! @Player earned 1 meep (0 → 1). Character-significant conversation with another PC
```

**Channel Log:**
```
🎯 DM recorded: **Character-significant conversation with another PC** for @PlayerName
```

---

#### `status` [target:@Player]
Check which missions have been claimed this session.
```bash
/missions status                          # Your claims
/missions status target:@PlayerName       # Other player (DM-only)
```

**Example Reply:**
```
You - This Session:
✅ session_summary (minted)
⏸️  pc_significant_convo (blocked_cap)
```

---

#### `list`
Show all available missions.
```bash
/missions list
```

**Example Reply:**
```
Available Missions
**session_summary**: Submit a session summary — 1 meep ♻️
**pc_significant_convo**: Character-significant conversation with another PC — 1 meep ⏰
**npc_friendship_increase**: Friendship increase with an NPC — 1 meep ⏰
...
Use `/missions claim mission:<id> target:@player` to record a claim.
```

---

## Data Flow: Mission Claim → Meep Mint

```
/missions claim
    ↓
resolveMission + validateSession + checkUniqueConstraint
    ↓
INSERT mission_claims (status='claimed')
    ↓
CHECK balance >= MEEP_MAX_BALANCE?
    ├─→ YES: UPDATE mission_claims status='blocked_cap'
    │        Reply: "Mission recorded (capped)"
    │
    └─→ NO: creditMeep({ sourceType='mission', sourceRef='mission_claim:123' })
             ↓
             INSERT meep_transactions (source_type='mission', source_ref='mission_claim:123', ...)
             ↓
             UPDATE mission_claims status='minted'
             ↓
             Log to Meepo's bound channel
             ↓
             Reply: "Mission claimed! +1 meep"
```

---

## Audit Trail

Every meep transaction now includes:
```sql
-- Direct meep spend (player)
source_type='player_spend', source_ref=null, session_id=NULL

-- DM reward
source_type='dm', source_ref='dm:user_id', session_id=NULL

-- Mission claim
source_type='mission', source_ref='mission_claim:123', session_id='uuid'
  └─> mission_claims[123] = { mission_id, claimant, beneficiary, status, note }

-- Future: Meepo auto-reward
source_type='meepo', source_ref='auto_reward:type', session_id='uuid'
```

This enables queries like:
```sql
-- All meeps earned this session
SELECT * FROM meep_transactions WHERE session_id = 'abc123'

-- All meeps from missions
SELECT * FROM meep_transactions WHERE source_type = 'mission'

-- Why did this player get meeps?
SELECT t.*, c.mission_id FROM meep_transactions t
  LEFT JOIN mission_claims c ON t.source_ref LIKE CONCAT('mission_claim:', c.id)
  WHERE t.target_discord_id = 'user123'
```

---

## Migration Notes

**Database**: New tables are created via `schema.sql` ALTER TABLE statements (backward-compatible).

**Command Registration**: `/missions` added to `src/commands/index.ts`.

**No Breaking Changes**: Existing `/meeps` commands unchanged; they now call engine functions internally. Balance queries still work as before.

---

## V0 Limitations (Future Milestones)

- [ ] **Autocomplete**: Mission ID autocomplete not wired up yet (stub with `.setAutocomplete(true)`)
- [ ] **Session Commands**: No `/session start` / `/session end` yet (use `/missions claim` error to guide DMs)
- [ ] **Exceptional Meeps**: Config supports `exceptional_meeps: 2`, but minting logic is flat (1 = 1 always)
- [ ] **Cross-Participant**: `applies_to: both_participants` parsed but not enforced (V1: auto-claim for second participant)
- [ ] **Meepo Auto-Reward**: Stub exists; not called from anywhere yet (V1: session end, beat discovery, etc.)

---

## Files Modified/Created

**Created:**
- `src/meeps/engine.ts` — Meep transaction engine
- `src/missions/loadMissions.ts` — Mission definition loader
- `src/commands/missions.ts` — /missions command group
- `src/sessions/sessionRuntime.ts` — Session state helpers
- `economy/missions.yml` — Mission definitions

**Modified:**
- `src/meeps/meeps.ts` — Enhanced transaction type + createMeepTx args
- `src/commands/meeps.ts` — Refactored to use `spendMeep()` / `creditMeep()`
- `src/commands/index.ts` — Registered /missions command
- `src/db/schema.sql` — Added mission_claims, guild_runtime_state, enhanced meep_transactions

**No Changes Required:**
- Ledger system (separate from meeps)
- Overlay / voice system
- Meepo state & personas

---

## Testing Checklist

- [ ] `/meeps spend` still works (uses engine)
- [ ] `/meeps reward` still works (uses engine, source_type='dm')
- [ ] `/meeps balance` / `/meeps history` unchanged
- [ ] `/missions list` shows all 6 missions
- [ ] `/missions claim session_summary target:@Player` (DM-only)
  - [ ] Creates mission_claim row
  - [ ] Mints 1 meep if balance < 3
  - [ ] Blocks if balance >= 3
  - [ ] Logs to Meepo's channel
  - [ ] Checks unique constraint (can't claim same mission twice same session)
- [ ] `/missions status` shows this session's claims
- [ ] `/missions status target:@Other` (DM-only) shows other player's claims
- [ ] Database integrity: mission_claims + meep_transactions aligned (each minted claim has corresponding tx)

---

## Next Steps (V1)

1. **Session Management**: `/session start name:"Sesh 21"` command group
   - Stores session in DB, sets active_session_id in guild_runtime_state
   - Returns session_id for DM to reference in lookups

2. **Cross-Participant Missions**: Auto-claim for second participant when mission has `applies_to: both_participants`

3. **Autocomplete**: Wire up mission ID autocomplete in `/missions claim`

4. **Meepo Auto-Reward**: Call engine from session completion, beat discovery, etc.

5. **Exceptional Meeps**: Extend engine to support variable deltas (1 vs 2 meeps based on mission config)

---

## Architecture Decisions

**Why mission_claims is separate**: Preserves audit trail of **what was claimed** independently of **whether it minted**. Enables cap analysis per session.

**Why source_type/source_ref in meep_transactions**: Single query for "why do I have meeps?" without joining multiple tables.

**Why YAML config**: Lightweight, human-readable, versioned with code (no DB migration for content changes).

**Why creditMeep() engine function**: Prevents duplicate balance-checking logic; guarantees /meeps and /missions produce identical behavior.

---

## FAQ

**Q: What if a session is 2 hours long and player earns mission meeping?**  
A: All rewards logged with the same session_id. Queries for "what happened this session" pull all mission_claims and meep_transactions with matching session_id.

**Q: What if I record a mission claim after the player already has 3 meeps?**  
A: Claim is recorded with status='blocked_cap'. The meep_transaction is NOT created. Deterministic: re-running the same claim request produces same state.

**Q: Can a player claim the same mission twice in one session?**  
A: No. UNIQUE constraint on (guild_id, session_id, mission_id, beneficiary_discord_id) will reject. DM is told "already claimed this mission this session, meep!"

**Q: Why is mission_claims.claimant_discord_id separate from meep_transactions.issuer_discord_id?**  
A: claimant = who recorded it (DM). issuer_discord_id is always null for system/mission sources. Separates "who made the decision" from "who the meep came from."

---

Generated: 2026-02-16  
Meepo V0 Missions System
