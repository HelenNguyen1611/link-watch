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
pnpm lint                    # Biome
pnpm test                    # Vitest
pnpm synth                   # kiểm tra CDK
```

Nếu `pnpm install` báo "Ignored build scripts", chạy `pnpm approve-builds` và chỉ cho phép gói cần thiết.

## Triển khai AWS

```bash
aws configure sso
pnpm --filter @linkwatch/infra exec cdk bootstrap aws://<ACCOUNT_ID>/ap-southeast-1
pnpm deploy:dev
```

Giữ chi phí gần 0: Lambda ngoài VPC (không NAT Gateway), không RDS/EC2, bật AWS Budgets 1 USD. Chi tiết ở SRS mục 3.4–3.5.
