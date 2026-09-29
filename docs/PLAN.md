# LinkWatch — Kế hoạch build MVP (Giai đoạn 1, SRS 7.2)

29/09/2026 · bản nháp chờ duyệt

## Phạm vi MVP

- **Trong MVP:** HLR-01 → HLR-08 (FR-01 → FR-14, FR-16 → FR-26), đăng nhập đơn giản 1 vai trò Admin, luồng "Đã khắc phục" FR-33 → FR-42, triển khai serverless (stage `dev`).
- **Để giai đoạn 2** (theo SRS 7.2): FR-15 khung bảo trì (AC-08), FR-27 cảnh báo SSL, FR-28 SSO, FR-29 quản lý người dùng/vai trò, FR-30 audit log, FR-31/32. Schema vẫn chừa chỗ để không phải migrate. Xem câu hỏi Q1.
- Mỗi bước = 1 commit, 1–3 giờ. "Xong" luôn gồm `pnpm lint && pnpm typecheck && pnpm test` pass, cộng với kiểm tra riêng của bước.
- AWS chỉ được gọi thật ở bước 40. Trước đó: DynamoDB Local (`pnpm db:local`) hoặc `aws-sdk-client-mock`.

## Quyết định kỹ thuật nhỏ (làm theo nếu không có phản đối)

- Múi giờ Asia/Saigon không có DST → tính lịch với offset cố định +07:00, không thêm thư viện timezone.
- Trang chi tiết link chỉ có `?id=` nhưng Link có PK `DOMAIN#…` → thêm GSI3 thưa `LINK#<id>` để tra theo id.
- Lấy "bây giờ" và sinh id qua tham số/tiêm phụ thuộc để test điều khiển được thời gian.
- Chạy local: API Hono qua `@hono/node-server` + DynamoDB Local; handler Lambda gọi được trực tiếp trong test.

---

## A. Nền móng

### Bước 0 — Sửa baseline tooling
- **Mục tiêu:** repo xanh trước khi viết tính năng. Hiện tại `pnpm lint` báo 27 lỗi format, `pnpm test` fail vì Vitest chạy test Jest của `infra`.
- **File:** `pnpm-workspace.yaml` (thay giá trị `allowBuilds` đang là placeholder), `vitest.config.ts` (projects cho từng package, tách `*.int.test.ts`), `infra/test/*` + `infra/package.json` (Jest → Vitest), bỏ `infra/jest.config.js`, `package.json` (thêm `test:int`, `aws-sdk-client-mock`), thống nhất phiên bản TypeScript/Biome giữa root và `apps/web`, `biome format --write`.
- **FR/AC:** — (hạ tầng dev).
- **Xong khi:** `pnpm install` không cảnh báo build script; `pnpm lint && pnpm typecheck && pnpm test` pass với 1 smoke test ở core; `pnpm synth` chạy được.
- **Phụ thuộc:** —

## B. Core (`packages/core`)

### Bước 1 — Schema Zod cho Link và chuẩn hóa URL
- **File:** `src/schema/link.ts`, `src/url.ts`, `src/schema/enums.ts` (LinkStatus, CheckResultKind, IncidentState), test tương ứng.
- **FR/AC:** FR-01 (URL http/https ≤ 2.048, GET/HEAD, mã mong đợi 200–399, timeout 30 s, keyword), FR-02 (trim, lowercase host, bỏ fragment, khóa chống trùng).
- **Xong khi:** test `FR-01: …`, `FR-02: …` pass.
- **Phụ thuộc:** 0

### Bước 2 — Domain chính và chặn SSRF
- **File:** `src/domain.ts` (tldts, eTLD+1), `src/ssrf.ts` (nhận diện IP private/loopback/link-local/metadata 169.254.169.254, IPv4 + IPv6), `src/schema/domain.ts`.
- **FR/AC:** FR-07, FR-08 (schema), NFR-07; AC-01 mức hàm (`a.abc.com`, `b.abc.com` → `abc.com`; `blog.abc.com.vn` → `abc.com.vn`).
- **Xong khi:** test `FR-07`, `AC-01`, `NFR-07` pass.
- **Phụ thuộc:** 1

### Bước 3 — Lịch: schema, lịch hiệu lực, tính `next_run_at`
- **File:** `src/schema/schedule.ts`, `src/schedule.ts` (`resolveEffectiveSchedule`, `computeNextRun`, `applyJitter`).
- **FR/AC:** FR-11 (mặc định 06:00), FR-12 (chu kỳ ≥ 5 phút, giờ cố định ngày/tuần/tháng), FR-13 (Link > Domain > Mặc định, trả về nguồn kế thừa), FR-14 (jitter ≤ 5 phút, xác định theo link id); AC-02, AC-03 mức hàm.
- **Xong khi:** test `FR-11…FR-14`, `AC-02`, `AC-03` pass (gồm case qua ngày, cuối tháng, ngày 31).
- **Phụ thuộc:** 1

### Bước 4 — Phân loại kết quả một lần check (5.1)
- **File:** `src/schema/check.ts` (CheckResult theo FR-17), `src/classify.ts` (input: kết quả probe thô + cấu hình link → Hoạt động/Chậm/Link chết/Site down + error_type).
- **FR/AC:** SRS 5.1 (ENOTFOUND/ETIMEDOUT/ECONNREFUSED/SSL/5xx → down; 4xx, ngoài mã mong đợi, > 10 redirect, thiếu keyword → chết; > 5.000 ms → chậm), FR-17, cờ "bỏ qua 403 WAF" theo domain (SRS 3.4).
- **Xong khi:** test bảng 5.1 (mỗi dòng ví dụ là 1 test) pass.
- **Phụ thuộc:** 1

### Bước 5 — Máy trạng thái xác nhận sự cố (5.2) và trạng thái domain
- **File:** `src/incident.ts` (`evaluateCheck(linkState, result, now)` → trạng thái link mới, hành động incident open/close/none, `next_run_at`), `src/domain-status.ts`.
- **FR/AC:** 5.2 bước 1–4 (Nghi ngờ → recheck 2 phút; lần 2 mở incident; recheck 10 phút trong 1 giờ đầu rồi max(lịch gốc, 1 giờ)); FR-09; FR-42; AC-05, AC-07 mức hàm; FR-04 (link tạm dừng không được đánh giá).
- **Xong khi:** test `5.2`, `FR-09`, `AC-05`, `AC-07` pass.
- **Phụ thuộc:** 3, 4

### Bước 6 — Người nhận, gộp email, nhắc lại, quy tắc 80%
- **File:** `src/recipients.ts`, `src/notify.ts` (`groupIncidents` theo domain trong cửa sổ 5 phút, `isReminderDue`, `isSystemWideOutage`), `src/email-subject.ts`.
- **FR/AC:** FR-20, FR-22, FR-23, FR-24 (tiêu đề `[LinkWatch][DOWN] abc.com — 3 link lỗi`), 5.2 bước 5; AC-06 mức hàm.
- **Xong khi:** test `FR-20`, `FR-22`, `FR-23`, `FR-24`, `AC-06` pass.
- **Phụ thuộc:** 5

### Bước 7 — Token email và logic "Đã khắc phục"
- **File:** `src/token.ts` (random ≥ 128 bit, sha256, hạn 7 ngày/đóng incident), `src/resolve-claim.ts` (chuyển Chờ xác minh, lịch xác minh 0/+2/+5 phút, kết quả sau mỗi lần, giới hạn 1 lần/2 phút).
- **FR/AC:** FR-34, FR-36, FR-37, FR-38, FR-40, FR-42; AC-12, AC-13 mức hàm.
- **Xong khi:** test `FR-34…FR-40`, `AC-12`, `AC-13` pass.
- **Phụ thuộc:** 5

### Bước 8 — ElectroDB: bảng, Domain, Link, Schedule, Recipient, Settings
- **File:** `src/db/table.ts` (client, tên bảng từ env, endpoint Local), `src/db/entities/{domain,link,schedule,recipient,settings}.ts`, `scripts/create-local-table.ts`, `src/db/*.int.test.ts`.
- **FR/AC:** SRS 6.2 (PK/SK, GSI1 `due`/`next_run_at`, GSI3 theo id), FR-08, FR-12, FR-20.
- **Xong khi:** `pnpm db:local && pnpm test:int` pass: tạo/đọc Domain + Link, query GSI1 link đến hạn, query link theo id.
- **Phụ thuộc:** 2, 3

### Bước 9 — ElectroDB: CheckResult, DayStat, Incident, ResolveClaim, Token, Notification
- **File:** `src/db/entities/{check,day-stat,incident,claim,token,notification}.ts` + int test.
- **FR/AC:** FR-17 (TTL 90 ngày), NFR-08 (DAY# giữ 2 năm, incident vĩnh viễn), GSI2 `state`/`opened_at`, FR-25, FR-34 (TTL 7 ngày).
- **Xong khi:** `pnpm test:int` pass: ghi check có `ttl`, cộng dồn DayStat, liệt kê incident đang mở qua GSI2.
- **Phụ thuộc:** 8

### Bước 10 — Use case quản lý link (repository)
- **File:** `src/usecases/links.ts` (tạo link: chuẩn hóa → chặn trùng → upsert domain → tính `next_run_at`; sửa; tạm dừng; xóa mềm hàng loạt), `src/usecases/import.ts` (xem trước CSV/dán ≤ 1.000 dòng: hợp lệ/trùng/lỗi; commit).
- **FR/AC:** FR-02, FR-03, FR-04, FR-07; **AC-01** (integration).
- **Xong khi:** `pnpm test:int` có test `AC-01` pass.
- **Phụ thuộc:** 9

## C. Checker (`services/checker`)

### Bước 11 — Probe HTTP
- **File:** `src/probe.ts` (undici: timeout, tối đa 10 redirect, UA `LinkWatch/1.0`, HEAD → GET khi 405, đọc body tìm keyword có giới hạn dung lượng, không tải tài nguyên phụ, chặn SSRF sau khi phân giải DNS), `src/ssl.ts` (module `tls` lấy hạn chứng chỉ).
- **FR/AC:** FR-17, 5.1 (ghi chú), NFR-07, NFR-09.
- **Xong khi:** test với HTTP/HTTPS server cục bộ (200, 404, 503, redirect vòng, chậm, timeout, HEAD 405, cert tự ký) pass.
- **Phụ thuộc:** 4

### Bước 12 — Handler Checker
- **File:** `src/handler.ts` (SQS batch → mỗi message tối đa 20 link, `p-limit` 2/domain → probe → classify → evaluateCheck → ghi check + link + DayStat + incident; trả `batchItemFailures`; Idempotency Powertools).
- **FR/AC:** FR-14 (≤ 2 đồng thời/domain), FR-17, 5.2, NFR-04 (lỗi → retry → DLQ), NFR-09; AC-04/AC-05 mức lưu trữ (incident mở sau 2 lần lỗi).
- **Xong khi:** `pnpm test:int` (DynamoDB Local + mock SQS) pass cho 2 lần 404 → 1 incident; lỗi 1 lần rồi OK → không incident.
- **Phụ thuộc:** 10, 11

## D. Dispatcher và lịch (`services/dispatcher`)

### Bước 13 — Dispatcher theo lịch
- **File:** `src/handler.ts` (query GSI1 `next_run_at ≤ now`, bỏ link tạm dừng, gom 20 link/message theo domain, `MessageGroupId = domain`, dedup id = linkIds + tick, đánh dấu đã dispatch để lần gọi sau không gửi trùng).
- **FR/AC:** FR-11, FR-13, FR-14, NFR-01, NFR-04 (chạy bù lượt lỡ); **AC-02**, **AC-03** (mô phỏng đồng hồ: chạy dispatcher mỗi 5 phút trong 1 giờ).
- **Xong khi:** `pnpm test:int` có `AC-02`, `AC-03` pass.
- **Phụ thuộc:** 10

### Bước 14 — Check lại có độ trễ (recheck 2/10 phút, xác minh +2/+5 phút, Check now)
- **File:** `packages/core/src/queue.ts` (kiểu message dùng chung), `services/checker/src/enqueue.ts`; hàng đợi ưu tiên theo giả định Q2.
- **FR/AC:** 5.2 bước 1 và 3, FR-16, FR-36, FR-37.
- **Xong khi:** test mock SQS xác nhận message đúng hàng đợi, đúng `DelaySeconds`; test int: lỗi lần 1 → job recheck 120 giây.
- **Phụ thuộc:** 12, 13

## E. Alert và email

### Bước 15 — Mẫu email (`packages/emails`)
- **File:** `src/{incident,recovery,reminder,verify-failed}.tsx`, `src/render.ts`, test snapshot HTML + text.
- **FR/AC:** FR-21, FR-22 (email gộp liệt kê từng link), FR-24, FR-33 (nút cho từng link + nút cả nhóm), FR-38.
- **Xong khi:** test render pass; tiêu đề đúng FR-24; mỗi link có URL `/confirm/?token=…`.
- **Phụ thuộc:** 6, 7

### Bước 16 — Alert Lambda: stream → gộp → SES
- **File:** `services/alert/src/handler.ts` (lọc sự kiện incident open/close/verify-failed từ Streams), `src/outbox.ts` (gộp 5 phút theo Q3), `src/send.ts` (SES v2, retry 3 lần, ghi `MAIL#`), tạo token cho từng người nhận.
- **FR/AC:** FR-20 → FR-22, FR-24, FR-25, FR-33, FR-34, 5.2 bước 5, NFR-03; **AC-04**, **AC-06**, **AC-07**.
- **Xong khi:** `pnpm test:int` (DynamoDB Local + `aws-sdk-client-mock` cho SES) pass `AC-04`, `AC-06`, `AC-07`.
- **Phụ thuộc:** 12, 15

### Bước 17 — Nhắc lại và email "vẫn lỗi"
- **File:** `services/alert/src/reminder.ts` (chạy theo tick dispatcher), nhánh verify-failed chỉ gửi người bấm.
- **FR/AC:** FR-23, FR-38; AC-10 phần email.
- **Xong khi:** test int: incident mở 24 giờ chưa ack → 1 email Nhắc lại; đã ack → không gửi.
- **Phụ thuộc:** 16

## F. API (`services/api`)

### Bước 18 — Khung Hono
- **File:** `src/app.ts`, `src/lambda.ts`, `src/local.ts` (node-server + DynamoDB Local), `src/middleware/{auth,error}.ts` (đọc JWT claims từ API GW; chế độ local dùng user giả), `GET /health`.
- **FR/AC:** FR-28 (MVP: email + mật khẩu qua Cognito, 1 vai trò Admin), NFR-07.
- **Xong khi:** test `app.request()` cho health, 401 khi thiếu claims, lỗi Zod trả 400 có chi tiết.
- **Phụ thuộc:** 10

### Bước 19 — API Link và nhập/xuất
- **File:** `src/routes/links.ts`, `src/routes/import.ts`.
- **FR/AC:** FR-01 → FR-06 (tìm, lọc domain/trạng thái/tag/lịch, CSV xuất).
- **Xong khi:** test route pass trên DynamoDB Local, gồm thao tác hàng loạt và export CSV.
- **Phụ thuộc:** 18

### Bước 20 — API Domain, Lịch, Người nhận, Cài đặt
- **File:** `src/routes/{domains,schedules,recipients,settings}.ts`.
- **FR/AC:** FR-08, FR-10 (số link theo trạng thái, uptime 7/30 ngày từ DayStat, lần check gần nhất/kế tiếp), FR-11 → FR-13, FR-20, FR-26 (địa chỉ gửi SES đã xác thực, gửi email thử qua mock SES).
- **Xong khi:** test route pass; NFR-02: truy vấn tổng quan 500 domain dùng dữ liệu tổng hợp, không quét toàn bảng.
- **Phụ thuộc:** 18

### Bước 21 — API Sự cố, lịch sử check, Check now
- **File:** `src/routes/{incidents,checks}.ts`.
- **FR/AC:** FR-16 (link/domain/tập link → job ưu tiên), FR-17, FR-18 (100 check gần nhất, dữ liệu biểu đồ), FR-19 (lọc mở/đóng, acknowledge + ghi chú, danh sách người nhận email).
- **Xong khi:** test route pass; Check now tạo đúng message trên mock SQS.
- **Phụ thuộc:** 14, 18

### Bước 22 — API resolve-claim (công khai qua token + trong app)
- **File:** `src/routes/claims.ts`: `GET /public/claims?token=` (chỉ đọc), `POST /public/claims` (token), `POST /incidents/{id}/resolve-claim` (JWT, nhiều link), `GET` tiến độ xác minh; header chống cache.
- **FR/AC:** FR-34 → FR-37, FR-40, FR-41, FR-42; **AC-11** (GET không ghi gì), **AC-12**, **AC-13**.
- **Xong khi:** test route pass `AC-11`, `AC-12`, `AC-13`.
- **Phụ thuộc:** 7, 14, 18

## G. Frontend (`apps/web`) — mỗi màn hình kiểm tra bằng `pnpm --filter @linkwatch/web build` + Vitest/Testing Library cho component có logic

### Bước 23 — Nền tảng web
- **File:** `src/app/providers.tsx` (Mantine, TanStack Query, Notifications), `src/i18n/{vi,en}.json`, `src/lib/api.ts` (client có kiểu từ schema core), `src/lib/auth.ts` (aws-amplify/auth; local dùng token giả), layout + menu, trang đăng nhập, bỏ file mẫu Next.
- **FR/AC:** FR-28, NFR-10.
- **Xong khi:** build ra `out/`; `pnpm dev:web` + API local hiển thị layout sau đăng nhập.
- **Phụ thuộc:** 18

### Bước 24 — SCR-01 Tổng quan
- **FR/AC:** FR-09, FR-10, NFR-02. **Phụ thuộc:** 20, 23

### Bước 25 — SCR-02 Domain (danh sách + `/domains/?d=`)
- **FR/AC:** FR-08, FR-10, FR-13 (lịch hiệu lực), FR-20 (người nhận domain), cờ bỏ qua 403 WAF, cờ cảnh báo chậm. **Phụ thuộc:** 20, 23

### Bước 26 — SCR-03 Danh sách link
- **FR/AC:** FR-04 (thao tác hàng loạt), FR-05, FR-06. **Phụ thuộc:** 19, 23

### Bước 27 — SCR-04 Thêm/nhập link
- **FR/AC:** FR-01, FR-02, FR-03 (bảng xem trước hợp lệ/trùng/lỗi). Test form dùng chung schema Zod. **Phụ thuộc:** 19, 23

### Bước 28 — SCR-05 Chi tiết link (`/links/detail/?id=`)
- **FR/AC:** FR-16, FR-17, FR-18 (Recharts thời gian phản hồi, thanh uptime 30 ngày, 100 check, sự cố), FR-41 (nút Đã khắc phục). **Phụ thuộc:** 21, 22, 23

### Bước 29 — SCR-06 Lịch
- **FR/AC:** FR-11, FR-12, FR-13. **Phụ thuộc:** 20, 23

### Bước 30 — SCR-07 Sự cố
- **FR/AC:** FR-19 (acknowledge, ghi chú), FR-41 (chọn nhiều link, dòng thời gian claim). **Phụ thuộc:** 21, 22, 23

### Bước 31 — SCR-08/09 Cài đặt
- **FR/AC:** FR-20 (email admin mặc định), FR-23 (chu kỳ nhắc lại), FR-26 (gửi email thử); SCR-09 MVP chỉ hiện tài khoản hiện tại (FR-29 để giai đoạn 2). **Phụ thuộc:** 20, 23

### Bước 32 — SCR-10 Trang xác nhận (mobile, `/confirm/?token=`, không cần đăng nhập)
- **FR/AC:** FR-35 (GET chỉ hiển thị, nút POST), FR-39 (tự cập nhật mỗi 3 giây tới khi xong 3 lần), FR-42, AC-12 (trang hết hạn / "Đã hồi phục lúc …"). **Phụ thuộc:** 22, 23

## H. Luồng "Đã khắc phục" đầu-cuối

### Bước 33 — Integration test luồng claim
- **File:** `tests/flows/resolve-claim.int.test.ts` (API + checker + alert gọi trực tiếp handler, DynamoDB Local, SQS/SES mock, đồng hồ giả).
- **FR/AC:** **AC-09**, **AC-10**, FR-37, FR-38, FR-42.
- **Xong khi:** `pnpm test:int` pass AC-09, AC-10. **Phụ thuộc:** 17, 22

### Bước 34 — Playwright E2E SCR-10
- **File:** `apps/web/e2e/confirm.spec.ts`, `playwright.config.ts` (chạy web + API local).
- **FR/AC:** AC-09 (UI ≤ 30 giây), **AC-11** (mở GET như bộ quét link → không có claim), AC-12, AC-13, NFR-10 (viewport mobile).
- **Xong khi:** `pnpm e2e` pass. **Phụ thuộc:** 32, 33

## I. Hạ tầng CDK (`infra/`) — mỗi bước kiểm tra bằng `pnpm synth` + test `Template.fromStack` assertions

### Bước 35 — DataStack
- Bảng single-table (provisioned 25/25, GSI1–3, Streams NEW_AND_OLD_IMAGES, TTL), tham số SSM, tên stack theo `stage`.
- **FR/AC:** SRS 3.4, 6.2, NFR-08. **Phụ thuộc:** 9

### Bước 36 — Hàng đợi và Lambda xử lý
- SQS FIFO + DLQ (maxReceive 3), hàng đợi ưu tiên (Q2), NodejsFunction arm64/esbuild cho dispatcher/checker/alert, **không VPC**, log 14 ngày, reserved concurrency checker = 10, EventBridge Scheduler 5 phút, event source mapping (SQS, Streams có filter), IAM tối thiểu.
- **FR/AC:** NFR-04, NFR-06, SRS 3.4 quy tắc chi phí. Assertion: không có `AWS::EC2::NatGateway`, không có `VpcConfig`. **Phụ thuộc:** 35, 17

### Bước 37 — API và Cognito
- HTTP API + JWT authorizer, route `/public/*` không auth, User Pool chỉ admin tạo user, Lambda API.
- **FR/AC:** FR-28, NFR-07. **Phụ thuộc:** 36, 22

### Bước 38 — Web, SES, Budgets
- S3 private + CloudFront (OAC) + CloudFront Function rewrite `/x/` → `/x/index.html`, SES identity + cấu hình DKIM (domain qua context), AWS Budgets 1 USD, output URL.
- **FR/AC:** SRS 3.4–3.5, FR-26. **Phụ thuộc:** 37, 32

## J. CI/CD và triển khai

### Bước 39 — CI trên Pull Request
- `.github/workflows/ci.yml`: install (cache pnpm) → lint → typecheck → test → test:int (DynamoDB Local service container) → web build → synth → `cdk diff` qua OIDC.
- **Xong khi:** PR thử chạy xanh. **Phụ thuộc:** 38

### Bước 40 — Deploy dev
- `.github/workflows/deploy.yml` (merge `main` → deploy `dev`, OIDC role), `docs/RUNBOOK.md` (bootstrap, tạo user Cognito, xác thực SES, gỡ sandbox), `scripts/smoke.ts` (tạo link thật OK + link 404, Check now, xác nhận email tới địa chỉ đã xác thực), heartbeat healthchecks.io (NFR-05).
- **Cần bạn duyệt trước khi chạy** `cdk bootstrap`/`cdk deploy` lần đầu.
- **Xong khi:** smoke test pass trên `dev`; Budgets đã bật. **Phụ thuộc:** 39

---

## Tóm tắt thứ tự và ước lượng

| Nhóm | Bước | Ước lượng |
| --- | --- | --- |
| A Nền móng | 0 | 1–2 giờ |
| B Core | 1–10 | 18–25 giờ |
| C–D Checker, Dispatcher | 11–14 | 8–11 giờ |
| E Alert, email | 15–17 | 6–8 giờ |
| F API | 18–22 | 10–13 giờ |
| G Frontend | 23–32 | 20–26 giờ |
| H Luồng Đã khắc phục | 33–34 | 4–5 giờ |
| I CDK | 35–38 | 8–10 giờ |
| J CI/CD, deploy | 39–40 | 4–6 giờ |
| **Tổng** | **41 bước** | **khoảng 80–105 giờ** (khớp 4–6 tuần của SRS 7.2) |

Nhóm G có thể làm song song với E–F khi API client dùng dữ liệu giả.

## Câu hỏi mở ảnh hưởng tới code

Mỗi câu có giả định đề xuất; kế hoạch trên đang làm theo giả định. Khi chốt, cập nhật mục này và SRS 7.3.

1. **Q1 — Ranh giới MVP.** FR-15 (khung bảo trì, AC-08) thuộc HLR-05 "Must" nhưng SRS 7.2 xếp vào giai đoạn 2; FR-41/FR-42 nằm ngoài dải "FR-33 đến FR-40". *Giả định:* FR-15, FR-27 để giai đoạn 2; FR-41, FR-42 làm trong MVP (dùng chung API resolve-claim, FR-42 là hệ quả của 5.2).
2. **Q2 — Check lại có độ trễ với SQS FIFO.** Recheck sau 2 phút, xác minh +2/+5 phút nhỏ hơn chu kỳ 5 phút của Dispatcher, mà SQS FIFO không hỗ trợ `DelaySeconds` theo từng message. *Giả định:* thêm một hàng đợi **Standard** "ưu tiên" cho recheck/xác minh/Check now, dùng `DelaySeconds` (≤ 15 phút); giới hạn 2 request/domain trong Checker bằng `p-limit` theo domain. Hàng đợi FIFO giữ cho lượt theo lịch.
3. **Q3 — Gộp email 5 phút với DynamoDB Streams.** Streams đẩy ngay từng thay đổi, cần chỗ giữ tạm để gộp. *Giả định:* Alert ghi incident vào `OUTBOX#<domain>` và đặt một message trễ 5 phút vào hàng đợi ưu tiên; khi message tới, gửi 1 email cho mọi incident trong outbox. Email gửi trong khoảng ≤ 5 phút sau khi xác nhận (đạt NFR-03 ở mức biên).
4. **Q4 — Ngữ nghĩa trạng thái khi incident đang mở.** Chưa rõ: kết quả *Chậm* có đóng incident không; loại lỗi đổi (Link chết → Site down) thì mở incident mới hay cập nhật; "một lượt" trong quy tắc 80% tính thế nào. *Giả định:* Chậm = thành công (đóng incident); đổi loại lỗi thì cập nhật `type` của incident đang mở, không mở mới, không gửi thêm email; "lượt" = các check trong cùng một tick Dispatcher, chỉ áp dụng khi tick có ≥ 20 link.
5. **Q5 — Đăng nhập MVP và danh tính người bấm.** "Đăng nhập đơn giản 1 vai trò Admin" chưa nói ai tạo tài khoản và ai được Acknowledge. *Giả định:* Cognito User Pool tắt tự đăng ký, Admin tạo user qua console/CLI (ghi trong RUNBOOK); mọi user đăng nhập đều là Admin; claim qua email ghi `by_email` = email người nhận gắn với token, claim trong app ghi email Cognito.
