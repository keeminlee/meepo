# Production Command Autodeploy Handoff

Date: 2026-03-14

This note covers the remaining production-side work after the repo change that adds Discord command deployment to the main deploy workflow.

## Repo-Side Change Landed In This Branch

- `.github/deploy.yml` now runs the normal EC2 deploy hook and then runs `npm run deploy:commands` on the host.
- The command deploy step sources `/etc/meepo/meepo-bot.env` before running so it can use the same Discord credentials as the bot runtime.
- Repo-side automation is complete; the remaining work is production rollout validation and fallback readiness.

## Remaining Prod-Side Steps

1. Merge this branch to `main` so the updated workflow is eligible to run.
2. Confirm `/etc/meepo/meepo-bot.env` on the EC2 host contains the command deploy inputs:
   - `DISCORD_TOKEN`
   - `DISCORD_APPLICATION_ID` or `DISCORD_CLIENT_ID`
3. Trigger the `Deploy Meepo` workflow on `main` or merge to `main` and let the normal push trigger run.
4. Verify the workflow log shows a successful `Deploy Discord commands` step after the remote app deploy.
5. In Discord, confirm the production app now exposes the current `/starstory` manifest and that `/starstory showtime start` includes the expected campaign options.

## Validation Checklist

- Workflow deploy job succeeds end-to-end.
- Host command deploy step completes without missing-env errors.
- Production global commands match the current repo manifest.
- `/starstory showtime start` in production includes campaign selection inputs.
- No stale `/meepo` root remains for newly refreshed command manifests.

## Operational Notes

- Discord global command propagation may still take a short period after a successful deploy.
- The production deploy flow is documented in `docs/runtime/ops/DEPLOY_FLOW.md`.
- This workflow change does not replace the broader public-host and OAuth cutover work tracked in `docs/product/external-cutover-handoff.md`.
- Manual fallback remains available: SSH to the host, source `/etc/meepo/meepo-bot.env`, then run `npm run deploy:commands` from `APP_DIR`.

## Rollback

- Re-run the deploy workflow from the previous known-good commit if the new step fails unexpectedly.
- If only the command deploy step fails, fix the host env mismatch and re-run the workflow rather than editing the deployed manifest by hand.