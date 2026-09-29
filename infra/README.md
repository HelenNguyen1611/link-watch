# @linkwatch/infra

AWS CDK v2 for LinkWatch. Deployed stacks: `LinkWatch-Cicd`, `LinkWatch-Data`, `LinkWatch-Workers`, `LinkWatch-Api`, `LinkWatch-Web` (see `CLAUDE.md` at the repo root).
Fixed configuration (account, region, domain, certificate, GitHub OIDC, DynamoDB capacity) lives in `lib/config.ts`.

```bash
pnpm test                  # from the repo root: Vitest + CDK assertions (infra/test)
pnpm synth                 # from the repo root: needs apps/web/out (pnpm --filter @linkwatch/web build)
pnpm --filter @linkwatch/infra exec cdk diff
```

Deploys run automatically on push to `main` (`.github/workflows/deploy.yml`). Do not run `cdk deploy` locally unless agreed.
