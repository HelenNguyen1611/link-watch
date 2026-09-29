# @linkwatch/infra

AWS CDK v2 cho LinkWatch. Stack đang chạy: `LinkWatch-Web`, `LinkWatch-Cicd` (xem `CLAUDE.md` ở gốc repo).
Cấu hình cố định (account, region, domain, chứng chỉ, GitHub OIDC) nằm ở `lib/config.ts`.

```bash
pnpm test                  # ở gốc repo: Vitest + CDK assertions (infra/test)
pnpm synth                 # ở gốc repo: cần apps/web/out (pnpm --filter @linkwatch/web build)
pnpm --filter @linkwatch/infra exec cdk diff
```

Deploy chạy tự động khi push `main` (`.github/workflows/deploy.yml`). Không chạy `cdk deploy` từ máy khi chưa thống nhất.
