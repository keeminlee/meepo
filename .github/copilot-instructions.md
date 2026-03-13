# Copilot Safety Guardrails

## Protected Runtime Files And Paths
Treat the following as break-glass protected. Do not edit them unless the user explicitly says they are debugging a production incident and explicitly asks for changes in these paths.

- deploy-meepo.sh
- install-runtime-assets.sh
- deploy/ec2/**
- deploy/env/**
- deploy/systemd/**
- meepo-bot.env.example
- meepo-web.env.example
- meepo-bot.service
- meepo-web.service
- .github/workflows/ci.yml

## Required Protocol Before Editing Protected Paths
Only proceed when all checks pass:

1. The user states this is a production incident or runtime hotfix.
2. The user confirms exactly which protected file(s) may be changed.
3. You explain expected blast radius and rollback plan in 2-4 lines.
4. You apply the smallest possible change.
5. You run validation commands relevant to the changed file.

If any condition is missing, refuse to edit protected paths and ask for explicit break-glass confirmation.

## Additional Safety Rules
- Never create, overwrite, or chmod files under /etc/meepo unless user explicitly requests host-level runtime repair.
- Never copy template env files into production runtime paths unless user explicitly requests it.
- Prefer diagnostics first, edits second.
