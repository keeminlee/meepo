# Track C Run 5 Closeout

Date: 2026-03-07

## Goal

Finalize Track C as a secure Discord-authenticated archive access layer with explicit local dev bypass fallback only.

## Scope Summary

- Run 1: Auth substrate (Auth.js + Discord provider + session plumbing + UI sign-in/out).
- Transition cleanup: clear unauthorized messaging and graceful dashboard behavior.
- Run 2A: session-snapshot guild authorization path for discovery.
- Run 2B: Discord refresh + TTL + session snapshot fallback.
- Run 3: session object authorization (detail/transcript/recap/regenerate) by ownership against `authorizedGuildIds`.
- Run 4: removed implicit env fallback (`MEEPO_WEB_GUILD_ID`) and narrowed dev bypass.
- Run 5: verification + docs + PR closeout.

## Verification Matrix

### Automated

- PASS: web auth/scope tests
  - `npm run test -- src/tests/test-web-auth-context-guard.ts src/tests/test-web-scope-guards.ts`
- PASS: web cache policy tests
  - `npm run test -- src/tests/test-web-discord-guild-cache-policy.ts`
- PASS: web typecheck
  - `cd apps/web && npm run typecheck`
- PASS: web production build
  - `cd apps/web && npm run build`

### Manual

- TODO: local Discord sign-in flow smoke.
- TODO: authorized dashboard rendering smoke.
- TODO: signed-in no-matching-campaigns empty state smoke.
- TODO: direct unauthorized session URL denial smoke.
- TODO: transcript/recap denial symmetry smoke.
- TODO: regenerate denial occurs before work starts when out of scope.
- TODO: explicit dev-bypass-only-local behavior smoke.
- TODO: authenticated session precedence over bypass override smoke.

## Final Doctrine

- Auth.js + Discord OAuth is the primary auth model.
- Guild authorization derives from Discord membership.
- Refresh uses TTL with session snapshot fallback on failure.
- Authorization primitive is `authorizedGuildIds`; `authorizedGuilds` is convenience metadata.
- Session object authorization is enforced in reader/action layer.
- No implicit env guild fallback exists.
- Dev bypass is explicit local fallback only.
- Campaign identity remains `guild_id + campaign_slug`.

## PR Framing

Suggested title:

- `feat(web): add Discord OAuth and guild-scoped secure archive access`

Suggested summary highlights:

- authenticated Discord users can only access campaigns/sessions for guilds they belong to
- dashboard and session object access use one canonical auth context
- session authorization is enforced in reader/action code
- dev bypass remains explicit local fallback only
