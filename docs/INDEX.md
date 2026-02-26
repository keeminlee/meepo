# Docs Index

Primary documentation entrypoints for active architecture lanes.

- [README.md](README.md) — top-level docs navigation
- [MAP.md](MAP.md) — runtime and subsystem map
- [CURRENT_STATE.md](CURRENT_STATE.md) — current implementation status

Lane-specific references:

- Silver-Seq lane: deterministic segmentation (`src/silver/seq/*`)
- Online Events lane: live event compilation (`src/tools/events/compile-and-export-events-live.ts`)
- Shared compile core: event labeling primitives (`src/events/compileEvents/*`)

Artifacts:

- Silver-Seq artifacts: `data/artifacts/silver_seq/<session>/<run_id>/`
- Campaign-scoped live events export: `data/campaigns/<campaign>/exports/events/`