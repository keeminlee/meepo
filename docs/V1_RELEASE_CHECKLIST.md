# V1 Release Checklist

This checklist is the source of truth for shipping `v1.0.0`.

## 1) Automated Ship Gate

- Run `npm run ci:verify`
- Gate must pass all of the following in order:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test:smoke`
  - `npm run test`
  - `npm run stopline:no-getdb-runtime`
  - `npm run stopline:no-raw-env`
  - `npm run stopline:repo-hygiene`

## 2) Deterministic Smoke Tests

- `src/tests/smoke/test-megameecap-fixture.ts`
  - Uses fixture transcript only
  - No network / no LLM API calls
  - Verifies output shape and file writes
- `src/tests/smoke/test-silver-seq-fixture.ts`
  - Uses fixture transcript only
  - No network calls
  - Verifies deterministic segmentation + artifact set
- `src/tests/voice/test-voice-interrupt.ts`
  - Verifies playback interrupt on user speech start

Fixture root:

- `data/fixtures/sessions/fixture_v1/`

## 3) Manual Checks (Required)

- Voice interrupt sanity:
  - Active playback is interrupted by live user speech in immediate mode
  - Speaking state clears after interrupt
- Silver-Seq artifact sanity:
  - `params.json`, `transcript_hash.json`, `eligible_mask.json`, `segments.json`, `metrics.json` are present
- MegaMeecap artifact sanity:
  - Baseline markdown + meta JSON always written
  - Final output written when final pass is enabled

## 4) Release Metadata

- `CHANGELOG.md` contains V1 scope and known gaps
- Version in `package.json` is `1.0.0`
- Tag readiness: `v1.0.0`

## 5) Go / No-Go

- Go only if:
  - CI gate passes end-to-end
  - Manual checks pass
  - Known gaps are explicitly documented