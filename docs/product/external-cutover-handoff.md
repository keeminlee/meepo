# External Cutover Handoff

This note covers out-of-repo follow-up work required to complete the public StarStory cutover. It is intentionally a handoff document only and does not imply any in-repo implementation change.

## Scope

The following work should be handled in infrastructure, hosting, proxy, OAuth provider, or deployment environments outside this repository.

## Canonical Host Decision

- Confirm the long-term canonical public host for the platform.
- Decide whether `starstory.online` becomes the canonical origin or remains a marketing/redirect host.
- Confirm the fallback/legacy handling strategy for `meepo.online`.

## Redirect Direction

- Configure the reverse proxy or edge layer so legacy public traffic redirects in the intended direction.
- Ensure redirects are consistent for root routes, auth routes, and app deep links.
- Verify redirect status codes and cache behavior are appropriate for a public cutover.

## OAuth Callback And Origin Alignment

- Update the Discord OAuth application settings so the approved redirect URIs match the chosen canonical host.
- Align `NEXTAUTH_URL`, `AUTH_URL`, and any other origin-sensitive runtime settings with the final canonical decision.
- Verify sign-in, sign-out, callback, and session refresh behavior after the host change.

## API Canonical-Origin Alignment

- Update reverse proxy and runtime canonical-origin enforcement so API and web requests agree on the same host.
- Verify any absolute URL generation, callback building, and origin checks use the intended public origin.
- Confirm that redirect-only hosts do not remain accidentally writable or partially canonical.

## Validation Checklist

- Public root loads on the intended canonical host.
- Legacy host redirects to the intended canonical host.
- Discord OAuth sign-in completes successfully on the canonical host.
- Auth callback and session refresh use the same canonical origin.
- Deep links into campaigns, sessions, and settings survive redirects.
- Public slash-command guidance and web links are consistent with the final host decision.

## Notes

- Do not treat this file as approval to change auth config, middleware, API origin enforcement, or runtime plumbing inside the repo.
- Any in-repo config changes needed after the host decision should be handled as a separate, explicitly scoped pass.