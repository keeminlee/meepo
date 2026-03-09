# Docs Index

Primary documentation entrypoints for active architecture lanes.

- [README.md](README.md) — top-level docs navigation
- [START_HERE.md](START_HERE.md) — first-time DM onboarding path
- [ops/CLOSED_ALPHA_PHASE0_RELEASE_CONTROL.md](ops/CLOSED_ALPHA_PHASE0_RELEASE_CONTROL.md) — integration branch + scope freeze contract
- [ops/CLOSED_ALPHA_PHASE5_DEPLOY_RUNTIME_VERSIONING.md](ops/CLOSED_ALPHA_PHASE5_DEPLOY_RUNTIME_VERSIONING.md) — deploy hook + systemd unit versioning contract
- [OPS_TRIAGE.md](OPS_TRIAGE.md) — closed alpha incident triage checklist
- [MAP.md](MAP.md) — runtime and subsystem map
- [CURRENT_STATE.md](CURRENT_STATE.md) — current implementation status
- [../apps/web/README.md](../apps/web/README.md) — web archive runtime routes and scope/edit doctrine
- [ops/ENV.md](ops/ENV.md) — runtime and deploy environment contract
- [awakening/ARCHITECTURE.md](awakening/ARCHITECTURE.md) — Awakening Runtime guarantees and invariants
- [awakening/SCRIPTS.md](awakening/SCRIPTS.md) — script authoring/runtime contract
- [MEGAMEECAP_WORKER.md](MEGAMEECAP_WORKER.md) — action contract + receipts + artifact triage

Lane-specific references:

- Silver-Seq lane: deterministic segmentation (`src/silver/seq/*`)
- Online Events lane: live event compilation (`src/tools/events/compile-and-export-events-live.ts`)
- Shared compile core: event labeling primitives (`src/events/compileEvents/*`)

Artifacts:

- Silver-Seq artifacts: `data/artifacts/silver_seq/<session>/<run_id>/`
- Campaign-scoped live events export: `data/campaigns/g_<guild>__c_<campaign>/exports/events/`