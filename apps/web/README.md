# Meepo Web Archive (`apps/web`)

This package is the Track B web archive shell for Meepo.

## Runtime

- Framework: Next.js App Router
- Active routes:
  - `/`
  - `/dashboard`
  - `/campaigns/[campaignSlug]`
  - `/sessions/[sessionId]`
- Route-level shells are implemented with `loading.tsx` and `error.tsx` for main archive routes.

## Local Run

1. Install dependencies:
   - `npm install`
2. Start dev server:
   - `npm run dev`
3. Open:
   - `http://localhost:3000`

## Scripts

- `npm run dev` - start local dev server
- `npm run build` - production build
- `npm run start` - run built app
- `npm run typecheck` - TypeScript check
- `npm run lint` - Next lint

## Track B Notes

- B0 currently uses typed mock readers in `lib/server/readers.ts`.
- B1+ will swap reader internals to canonical backend adapters (`src/sessions/*`, `src/ledger/transcripts.ts`) without changing page contracts.
- Legacy Vite implementation is quarantined under `legacy-vite/` and is not part of the active runtime.
