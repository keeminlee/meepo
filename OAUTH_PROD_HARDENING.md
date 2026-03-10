# OAuth Production Hardening (NextAuth + Nginx + Discord)

This document records the production failure modes we hit on `meepo.online` and the safeguards to prevent regressions.

Canonical production auth policy:

- Canonical auth origin is `https://meepo.online`.
- `https://starstory.online` is redirect-only and must not serve an independent OAuth flow.
- Discord OAuth redirect URI must remain exact and canonical: `https://meepo.online/api/auth/callback/discord`.

## Incident Summary

Observed symptoms during Discord callback (`/api/auth/callback/discord`):

- NextAuth: `OAUTH_CALLBACK_ERROR State cookie was missing`
- Nginx: `upstream sent too big header while reading response header from upstream`
- Browser: `502` after Discord authorize/return

Root causes:

1. Custom NextAuth `cookies` overrides in app config increased fragility behind reverse proxy.
2. JWT session cookie payload was too large because we persisted full Discord guild snapshots in token (`id`, `name`, `icon`, `permissions` for many guilds).
3. Some attempts were using stale `.next` build artifacts that did not yet include fixes.

## Final Code Safeguards

Implemented in `apps/web/lib/server/authOptions.ts`:

- Keep `trustHost: true` and `useSecureCookies: isProduction`.
- Remove custom `cookies` override and rely on NextAuth defaults.
- Store compact guild snapshot in JWT (`[{ id }]`) instead of full guild objects.

Type safety alignment in `apps/web/types/next-auth.d.ts`:

- `name` and `icon` on session/JWT guild entries are optional.

## Why This Prevents Recurrence

- NextAuth default cookie behavior is safer for reverse-proxy deployments than custom cookie naming/domain logic.
- Reducing JWT payload size prevents oversized `Set-Cookie` response headers during callback.
- Smaller auth headers avoid nginx upstream-header limit failures (`502`).

## Deployment Checklist (Required)

0. Run runtime truth preflight before changing auth/debugging.
1. Build from latest source in `apps/web`.
2. Remove stale build artifacts before building.
3. Restart `meepo-web` service.
4. Validate both app logs and nginx error log during a real OAuth sign-in.

Reference commands:

```bash
cd /home/meepo/meepo-bot
/bin/bash deploy/ec2/auth-runtime-preflight.sh

cd /home/meepo/meepo-bot/apps/web
rm -rf .next
NODE_OPTIONS=--max-old-space-size=768 npm run build
sudo systemctl restart meepo-web
sudo journalctl -u meepo-web -n 120 --no-pager
sudo tail -n 120 /var/log/nginx/error.log
```

## Runtime Config Checklist

Systemd environment should include:

- `NEXTAUTH_URL=https://meepo.online`
- `AUTH_URL=https://meepo.online`
- `AUTH_TRUST_HOST=true`
- `AUTH_SECRET=<strong-secret>`
- `DISCORD_CLIENT_ID=<discord-app-client-id>`
- `DISCORD_CLIENT_SECRET=<discord-app-client-secret>`

Nginx should forward:

- `Host`
- `X-Forwarded-Proto`
- `X-Forwarded-For`
- `X-Forwarded-Host`
- `X-Forwarded-Port`

Discord application OAuth redirect must exactly match:

- `https://meepo.online/api/auth/callback/discord`

## Fast Triage Matrix

If callback fails, use this mapping:

- `State cookie was missing`:
  - Check for custom NextAuth cookie overrides.
  - Check `AUTH_TRUST_HOST=true` and forwarded headers.
  - Check scheme/domain consistency (`https://meepo.online`).

- `upstream sent too big header` in nginx:
  - Inspect auth token/session size growth (JWT payload bloat).
  - Verify session payload does not include large arrays/objects.

- `access_denied` from provider:
  - User canceled consent or provider denied request.
  - Verify Discord OAuth redirect URL and app credentials.

## Regression Guardrails For Future Changes

When editing auth callbacks:

1. Do not persist large objects in JWT/session cookies.
2. Prefer IDs and compact metadata only.
3. Avoid custom `cookies` config unless absolutely required.
4. Test OAuth on production-like HTTPS + reverse proxy before release.
5. After auth changes, always do a clean build (`rm -rf .next`).

## Verification Steps After Any Auth Change

1. Open sign-in flow from logged-out state.
2. Complete Discord consent.
3. Confirm callback returns `302`/`200` (not `502`).
4. Confirm no `State cookie was missing` in app logs.
5. Confirm no `upstream sent too big header` in nginx logs.
6. Confirm authenticated dashboard renders.

## Stability Acceptance Gates

1. `5/5` logged-out Discord sign-ins succeed on `https://meepo.online`.
2. Callback path has no `502` and no `State cookie was missing`.
3. Nginx error log has no `upstream sent too big header` during callback runs.
4. Session cookies remain secure and origin-consistent across refresh/navigation.
5. `https://starstory.online` always redirects and never serves independent auth pages.
6. Browser does not show unsafe/certificate warnings on either public domain.

## Notes

- This project currently uses NextAuth v4 with JWT sessions.
- JWT sessions are cookie-backed; payload size is directly tied to header size limits.
