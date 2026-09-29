# LinkWatch — hướng dẫn cho Claude

## Mục tiêu sản phẩm

LinkWatch theo dõi danh sách link, tự gom theo domain chính (eTLD+1) và kiểm tra định kỳ theo lịch (mặc định 06:00 Asia/Saigon, ghi đè được theo domain/link).
Mỗi lần check phân loại thành Hoạt động / Chậm / Link chết / Site down; lỗi 2 lần liên tiếp mới mở sự cố và gửi email, có email hồi phục và nút "Đã khắc phục — kiểm tra lại".
Chạy serverless trên AWS để chi phí gần 0 USD với quy mô 5.000 link, dùng nội bộ.

Nguồn yêu cầu: `docs/SRS.md` (mã HLR/FR/NFR/AC). Kế hoạch build: `docs/PLAN.md`.

## Kiến trúc và công nghệ đã chốt (SRS 3.4–3.5) — không tự ý thay

- TypeScript strict toàn bộ, Node.js 22, monorepo pnpm workspaces.
- `apps/web`: Next.js 16 App Router, **static export** (`output: "export"`). Không dùng Server Actions, Route Handlers, middleware, ISR, route động `[param]`. Trang có tham số dùng query string: `/domains/?d=…`, `/links/detail/?id=…`, `/confirm/?token=…`. Dữ liệu lấy phía client qua TanStack Query. UI: Mantine, form: React Hook Form + Zod, biểu đồ: Recharts, i18n: react-i18next (vi mặc định, en). Đọc `apps/web/AGENTS.md` trước khi sửa web.
- `services/api`: một Lambda Hono sau API Gateway HTTP API (JWT authorizer Cognito).
- `services/dispatcher`: EventBridge Scheduler mỗi 5 phút → lấy link đến hạn (GSI `next_run_at`) → SQS.
- `services/checker`: SQS → check tối đa 20 link/lần gọi bằng `undici` + `p-limit` → ghi kết quả, mở/đóng sự cố.
- `services/alert`: DynamoDB Streams → gộp/nhắc lại → SES v2; mẫu email ở `packages/emails` (react-email).
- Dữ liệu: **một bảng DynamoDB** (single-table, SRS 6.2) truy cập qua **ElectroDB**. Hàng đợi: **SQS FIFO**, `MessageGroupId = domain`, có DLQ.
- Hạ tầng: AWS CDK v2 (TypeScript) trong `infra/`, Lambda đóng gói esbuild, **arm64**, **ngoài VPC**.
- Cấm: NAT Gateway, RDS/PostgreSQL, EC2, ElastiCache, Secrets Manager (dùng SSM Parameter Store Standard).
- Tiện ích Lambda: Powertools (Logger, Metrics, Tracer, Idempotency).

## Quy ước code

- **Logic nghiệp vụ nằm trong `packages/core`** (phân loại 5.1, xác nhận sự cố 5.2, tính lịch, người nhận, token…), viết dạng hàm thuần, có unit test Vitest.
- **Service là lớp mỏng**: parse event → gọi core → ghi DynamoDB/SQS/SES. Không đặt quy tắc nghiệp vụ trong handler.
- **Schema Zod dùng chung FE/BE**, export từ `@linkwatch/core`; kiểu TypeScript suy ra từ schema (`z.infer`), không khai báo trùng.
- Thời gian lưu dạng ISO 8601 UTC; chỉ đổi sang Asia/Saigon khi tính lịch và hiển thị. Hàm cần "bây giờ" nhận `now` làm tham số để test được.
- Lint + format bằng **Biome** (tab, nháy kép). Không thêm ESLint/Prettier/Jest.
- **Tên test chứa mã FR/AC/NFR trong SRS**, ví dụ: `it("FR-02: bỏ #fragment và hạ chữ thường host")`, `it("AC-05: lỗi 1 lần rồi OK thì không mở incident")`.
- Test gọi AWS: dùng `aws-sdk-client-mock` hoặc DynamoDB Local (`pnpm db:local`); không gọi AWS thật trong test.
- Mỗi bước trong `docs/PLAN.md` = một commit riêng, message dạng `feat(core): … (FR-xx)`.

## Lệnh kiểm tra bắt buộc sau mỗi bước

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Thêm theo phạm vi thay đổi:

- Sửa `infra/`: `pnpm synth` (và test CDK assertions trong `infra/test`).
- Sửa `apps/web/`: `pnpm --filter @linkwatch/web build` (phải xuất được `out/`).
- Test integration DynamoDB: `pnpm db:local` trước, rồi `pnpm test:int`.

Không báo "xong" khi một lệnh trên còn fail; báo rõ lệnh nào fail và output.

## An toàn

- Không chạy `cdk deploy`, `rm -rf`, `git reset --hard`, `git push --force` khi chưa được đồng ý.
- Không commit `.env*`, khóa, account ID thật.
