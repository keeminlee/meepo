# Closed Alpha Phase 0 Release Control

Date: 2026-03-08

This document is the operational contract for Phase 0 of the Closed Alpha launch roadmap.

## Integration Branch

- Closed Alpha finish-line integration branch: `v1.5_finish_line_to_v2`
- Goal: all launch-critical work lands here before merge/release promotion.

## Merge Freeze

During Closed Alpha finish-line work:

- Do not merge unrelated feature work into the integration branch.
- Prioritize only these lanes:
  - web archive unblock
  - showtime session lifecycle hardening
  - closed-alpha observability completion
  - deploy/runtime asset versioning

## Closed Alpha Scope Gate

Success loop only:

`/meepo showtime start -> voice capture -> transcript -> /meepo showtime end -> recap -> web session visibility`

Any change that does not support this loop is out-of-scope for v1.5 Closed Alpha.

## Explicitly Deferred Lanes

Deferred until post-Closed-Alpha (v2+):

- advanced recap variants beyond core stable path
- memory graph systems
- entity registry intelligence expansion
- mythology/constellation/starstory runtime layer
- causal deep session analysis
- deep campaign analytics and ranking/discovery

## Branch Alignment Procedure

If branch switch is blocked by local changes:

1. Commit or stash current changes on the current branch.
2. Checkout `v1.5_finish_line_to_v2`.
3. Cherry-pick or merge only launch-critical commits.
4. Re-run `npm run ci:verify` before any promotion.

## Exit Criteria for Phase 0

- Integration branch is established and used for launch work.
- Scope freeze is documented and acknowledged.
- Checklist and roadmap docs reference this release-control contract.
