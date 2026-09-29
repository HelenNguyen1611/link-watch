# LinkWatch

Công cụ web kiểm tra link chết / site down, nhóm theo domain chính, kiểm tra định kỳ theo lịch và gửi email cho người liên quan khi có sự cố. Chạy serverless trên AWS để chi phí gần 0.

## Tài liệu

| Tài liệu | Nơi xem |
| --- | --- |
| Phân tích yêu cầu, HLR, SRS | [docs/SRS.md](docs/SRS.md) · [bản gốc (living doc)](https://claude.ai/code/artifact/ceda111b-7f2a-497b-a771-de2709d90ee2) |
| Wireframe 10 màn hình | [LinkWatch Wireframe](https://claude.ai/artifact/AQYJpWDzkSktgbdFCvtJfo) |
| Sơ đồ kiến trúc | [docs/images/kien-truc-serverless.png](docs/images/kien-truc-serverless.png) |
| Luồng "Đã khắc phục" | [docs/images/luong-da-khac-phuc.png](docs/images/luong-da-khac-phuc.png) |

## Cấu trúc

```
apps/web/            Next.js 16 static export (SCR-01 … SCR-10)
services/api/        Lambda API (Hono)
services/dispatcher/ EventBridge 5 phút → SQS
services/checker/    SQS → kiểm tra link → DynamoDB
services/alert/      DynamoDB Streams → SES
packages/core/       Zod schema, ElectroDB entity, logic dùng chung
packages/emails/     Mẫu email (react-email)
infra/               AWS CDK v2
docs/                Tài liệu
```

## Bắt đầu

Yêu cầu: Node.js 22 (`nvm use`), pnpm (`corepack enable`), Docker (cho DynamoDB Local), AWS CLI.

```bash
pnpm install                 # cài dependencies (lần đầu trên máy)
pnpm dev:web                 # giao diện: http://localhost:3000
pnpm db:local                # DynamoDB Local tại cổng 8000
pnpm db:init                 # tạo bảng "linkwatch" trên DynamoDB Local
pnpm test:int                # integration test (cần db:local)
pnpm dev:api                 # API local: http://localhost:8787/api (khóa tạm: "dev")
NEXT_PUBLIC_API_BASE=http://localhost:8787 pnpm dev:web   # web gọi API local
pnpm lint                    # Biome
pnpm test                    # Vitest
pnpm synth                   # kiểm tra CDK
SMOKE_API_KEY=… pnpm smoke   # smoke test trên https://watch.hueai.net (xem docs/RUNBOOK.md mục 4)
```

Nếu `pnpm install` báo "Ignored build scripts", chạy `pnpm approve-builds` và chỉ cho phép gói cần thiết.

## Triển khai AWS

Deploy chính là **push `main`**: GitHub Actions (`.github/workflows/deploy.yml`) chạy lint/typecheck/test → build web → đăng nhập AWS bằng OIDC (role `linkwatch-github-deploy`, không lưu access key) → `cdk deploy --all`. Lỗi ở bước kiểm tra thì không deploy.

Deploy tay từ máy **chỉ khi khẩn cấp** (vd. GitHub Actions ngừng hoạt động):

```bash
aws sso login --profile linkwatch
pnpm --filter @linkwatch/web build
pnpm run deploy --profile linkwatch   # phải có "run": "pnpm deploy" là lệnh có sẵn của pnpm
```

Giữ chi phí gần 0: Lambda ngoài VPC (không NAT Gateway), không RDS/EC2, cảnh báo chi phí bằng budget "My Zero-Spend Budget" (quản lý thủ công trên Console, xem docs/RUNBOOK.md). Chi tiết ở SRS mục 3.4–3.5.
