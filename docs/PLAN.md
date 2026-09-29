# LinkWatch — Kế hoạch build MVP (Giai đoạn 1, SRS 7.2)

29/09/2026 · đã duyệt 29/09/2026 · sắp lại theo 3 mốc 29/09/2026

## Phạm vi MVP

- **Trong MVP:** HLR-01 → HLR-08 (FR-01 → FR-14, FR-16 → FR-26), đăng nhập đơn giản 1 vai trò Admin, luồng "Đã khắc phục" FR-33 → FR-42, triển khai serverless lên môi trường duy nhất đang chạy (https://watch.hueai.net).
- **Để giai đoạn 2** (theo SRS 7.2): FR-15 khung bảo trì (AC-08), FR-27 cảnh báo SSL, FR-28 SSO, FR-29 quản lý người dùng/vai trò, FR-30 audit log, FR-31/32. Schema vẫn chừa chỗ để không phải migrate. Xem câu hỏi Q1.
- Mỗi bước = 1 commit, 1–3 giờ. "Xong" luôn gồm `pnpm lint && pnpm typecheck && pnpm test` pass, cộng với kiểm tra riêng của bước.
- Test không gọi AWS thật: DynamoDB Local (`pnpm db:local`) hoặc `aws-sdk-client-mock`.
- **Chỉ commit local, không `git push`.** Push `main` chạy `deploy.yml` → `cdk deploy --all` lên AWS thật; người dùng tự review và push. Từ bước 35, mỗi lần push sẽ tạo/sửa stack thật.

## Hạ tầng đã có (29/09/2026) — không tạo lại, chỉ mở rộng

- 1 môi trường, không stage. Tên stack `LinkWatch-<Tên>`: đã có `LinkWatch-Web`, `LinkWatch-Cicd`; sẽ thêm `LinkWatch-Data`, `LinkWatch-Workers`, `LinkWatch-Api`, `LinkWatch-Ops`.
- `infra/lib/config.ts` là nguồn duy nhất cho account, region, domain, ARN chứng chỉ, GitHub OIDC; stack mới đọc từ đây.
- `LinkWatch-Web`: S3 + OAC + CloudFront + rewrite `index.html` + BucketDeployment `apps/web/out`.
- `LinkWatch-Cicd`: OIDC provider + role `linkwatch-github-deploy`.
- `.github/workflows/deploy.yml`: push `main` → build web → OIDC → `cdk deploy --all`.
- ACM và SES identity `watch.hueai.net` (DKIM, MAIL FROM `mail.watch.hueai.net`) tạo tay; CDK chỉ tham chiếu bằng ARN/tên.

## Quyết định kỹ thuật nhỏ (làm theo nếu không có phản đối)

- Múi giờ Asia/Saigon không có DST → tính lịch với offset cố định +07:00, không thêm thư viện timezone.
- GSI3 `byType`: pk = loại thực thể (`LINK`, `DOMAIN`), sk = id → tra link theo id và liệt kê mọi link/domain.
- Lấy "bây giờ" và sinh id qua tham số/tiêm phụ thuộc để test điều khiển được thời gian.
- Chạy local: API Hono qua `@hono/node-server` + DynamoDB Local; handler Lambda gọi được trực tiếp trong test.

**Đã chốt 29/09/2026 (sau Mốc 1 phần local):**

- Domain chính dùng cả phần private của PSL: `abc.github.io`, `shop.vercel.app` là domain riêng.
- Link trỏ vào địa chỉ nội bộ bị chặn (NFR-07) → Link chết (`blocked_private_address`).
- Mã HTTP trong danh sách mong đợi luôn được ưu tiên, kể cả 4xx/5xx do người dùng khai báo.
- Từ khóa bắt buộc: **không phân biệt hoa/thường** và NFC/NFD, vẫn phân biệt dấu; chỉ đọc tối đa 1 MB.
- Chống trùng URL bằng item `URL#<sha256>` ghi cùng Link trong 1 transaction.
- Dispatcher giữ chỗ 30 phút (dời `next_run_at`) để tick sau không gửi trùng; hết hạn thì gửi lại.
- Link tạm dừng/xóa không có `next_run_at` → tự rời GSI1.

---

## Cách đọc kế hoạch

- Chia 3 mốc; mỗi mốc kết thúc bằng một bản chạy thật trên https://watch.hueai.net.
- **Giữ số bước gốc** để lịch sử commit không lệch. Bước bị tách có hậu tố `a`/`b`/`c`; FR/AC và "Xong khi" của bước gốc được chia cho các phần, không bỏ phần nào.
- Bước đánh dấu **(mới)** là việc chỉ có vì chia mốc (auth tạm, trang web rút gọn, smoke test theo mốc).
- ✅ = đã commit.

---

## Mốc 1 — Walking skeleton

**Mục tiêu:** trên https://watch.hueai.net: thêm link → Dispatcher 5 phút → Checker → xem trạng thái Hoạt động / Chậm / Link chết / Site down.
**Chưa có:** xác nhận 2 lần, incident, email, Cognito, lịch riêng.
**Xong mốc khi:** sau khi người dùng push, thêm 4 link (trả 200, trả 404, domain không tồn tại, phản hồi > 5 giây) qua web; trong ≤ 10 phút thấy đúng 4 trạng thái; API từ chối request không có header bí mật.

### Bước 0 — Sửa baseline tooling ✅
- **Mục tiêu:** repo xanh trước khi viết tính năng. Hiện tại `pnpm lint` báo lỗi format, `pnpm test` fail vì Vitest chạy test Jest mẫu của `infra`.
- **File:** `pnpm-workspace.yaml` (thay giá trị `allowBuilds` đang là placeholder), `vitest.config.ts` (projects cho từng package, tách `*.int.test.ts`), `package.json` (thêm `test:int`), `infra/package.json` (Jest → Vitest), xóa `infra/lib/infra-stack.ts`, `infra/test/infra.test.ts`, `infra/jest.config.js`; thêm `infra/test/web-stack.test.ts`, `infra/test/cicd-stack.test.ts` (Vitest + CDK assertions cho stack đang chạy); thống nhất phiên bản Biome giữa root và `apps/web`; `biome format --write`. Giữ pnpm 10.33.0.
- **FR/AC:** — (hạ tầng dev).
- **Xong khi:** `pnpm lint && pnpm typecheck && pnpm test` pass; `pnpm synth` ra template `LinkWatch-Web` và `LinkWatch-Cicd` giống hệt trước khi sửa (so bằng `diff`).
- **Phụ thuộc:** —

### Bước 1 — Schema Zod cho Link và chuẩn hóa URL ✅
- **File:** `src/schema/link.ts`, `src/url.ts`, `src/schema/enums.ts` (LinkStatus, CheckResultKind, IncidentState), test tương ứng.
- **FR/AC:** FR-01 (URL http/https ≤ 2.048, GET/HEAD, mã mong đợi 200–399, timeout 30 s, keyword), FR-02 (trim, lowercase host, bỏ fragment, khóa chống trùng).
- **Xong khi:** test `FR-01: …`, `FR-02: …` pass.
- **Phụ thuộc:** 0

### Bước 2 — Domain chính và chặn SSRF
- Giữ nguyên cả bước: Checker chạy thật trên internet từ Mốc 1 nên cần chặn SSRF ngay.
- **File:** `src/domain.ts` (tldts, eTLD+1), `src/ssrf.ts` (nhận diện IP private/loopback/link-local/metadata 169.254.169.254, IPv4 + IPv6), `src/schema/domain.ts`.
- **FR/AC:** FR-07, FR-08 (schema), NFR-07; AC-01 mức hàm (`a.abc.com`, `b.abc.com` → `abc.com`; `blog.abc.com.vn` → `abc.com.vn`).
- **Xong khi:** test `FR-07`, `AC-01`, `NFR-07` pass.
- **Phụ thuộc:** 1

### Bước 3a — Lịch mặc định: tính `next_run_at`
- **File:** `src/schedule.ts` (`computeNextRun` cho lịch hàng ngày HH:mm, `applyJitter`).
- **FR/AC:** FR-11 (mặc định 06:00), FR-14 (jitter ≤ 5 phút, xác định theo link id); AC-02 mức hàm.
- **Xong khi:** test `FR-11`, `FR-14`, `AC-02` pass (gồm case qua ngày).
- **Phụ thuộc:** 1

### Bước 4a — Phân loại kết quả một lần check (5.1)
- **File:** `src/schema/check.ts` (CheckResult theo FR-17), `src/classify.ts` (input: kết quả probe thô + cấu hình link → Hoạt động/Chậm/Link chết/Site down + error_type).
- **FR/AC:** SRS 5.1 (ENOTFOUND/ETIMEDOUT/ECONNREFUSED/SSL/5xx → down; 4xx, ngoài mã mong đợi, > 10 redirect, thiếu keyword → chết; > 5.000 ms → chậm), FR-17.
- **Xong khi:** test bảng 5.1 (mỗi dòng ví dụ là 1 test) pass.
- **Phụ thuộc:** 1

### Bước 8a — ElectroDB: bảng, Domain, Link
- **File:** `src/db/table.ts` (client, tên bảng từ env, endpoint Local), `src/db/entities/{domain,link}.ts`, `scripts/create-local-table.ts` (tạo đủ GSI1–3 ngay), `src/db/*.int.test.ts`.
- **FR/AC:** SRS 6.2 (PK/SK, GSI1 `due`/`next_run_at`, GSI3 theo id), FR-08.
- **Xong khi:** `pnpm db:local && pnpm test:int` pass: tạo/đọc Domain + Link, query GSI1 link đến hạn, query link theo id.
- **Phụ thuộc:** 2, 3a

### Bước 9a — ElectroDB: CheckResult
- **File:** `src/db/entities/check.ts` + int test.
- **FR/AC:** FR-17 (TTL 90 ngày).
- **Xong khi:** `pnpm test:int` pass: ghi check có `ttl`.
- **Phụ thuộc:** 8a

### Bước 10a — Use case tạo, liệt kê, xóa link
- **File:** `src/usecases/links.ts` (tạo link: chuẩn hóa → chặn trùng → upsert domain → tính `next_run_at`; liệt kê; xóa mềm).
- Link mới có `next_run_at = now` để được check ở tick kế tiếp, sau đó theo lịch mặc định.
- **FR/AC:** FR-02, FR-07, FR-04 (phần xóa mềm một link); **AC-01** (integration).
- **Xong khi:** `pnpm test:int` có test `AC-01` pass.
- **Phụ thuộc:** 9a

### Bước 11 — Probe HTTP
- **File:** `src/probe.ts` (undici: timeout, tối đa 10 redirect, UA `LinkWatch/1.0`, HEAD → GET khi 405, đọc body tìm keyword có giới hạn dung lượng, không tải tài nguyên phụ, chặn SSRF sau khi phân giải DNS), `src/ssl.ts` (module `tls` lấy hạn chứng chỉ).
- **FR/AC:** FR-17, 5.1 (ghi chú), NFR-07, NFR-09.
- **Xong khi:** test với HTTP/HTTPS server cục bộ (200, 404, 503, redirect vòng, chậm, timeout, HEAD 405, cert tự ký) pass.
- **Phụ thuộc:** 4a

### Bước 12a — Handler Checker (chưa có xác nhận 2 lần / incident)
- **File:** `src/handler.ts` (SQS batch → mỗi message tối đa 20 link, `p-limit` 2/domain → probe → classify → ghi check + trạng thái link + `next_run_at` theo lịch mặc định; trả `batchItemFailures`).
- **FR/AC:** FR-14 (≤ 2 đồng thời/domain), FR-17, NFR-04 (lỗi → retry → DLQ), NFR-09.
- **Xong khi:** `pnpm test:int` (DynamoDB Local + mock SQS) pass: link 404 → trạng thái Link chết và 1 bản ghi check có `ttl`; message lỗi nằm trong `batchItemFailures`.
- **Phụ thuộc:** 10a, 11

### Bước 13a — Dispatcher theo lịch mặc định
- **File:** `src/handler.ts` (query GSI1 `next_run_at ≤ now`, bỏ link tạm dừng, gom 20 link/message theo domain, `MessageGroupId = domain`, dedup id = linkIds + tick, đánh dấu đã dispatch để lần gọi sau không gửi trùng).
- **FR/AC:** FR-11, FR-14, NFR-01, NFR-04 (chạy bù lượt lỡ); **AC-02** (mô phỏng đồng hồ: chạy dispatcher mỗi 5 phút).
- **Xong khi:** `pnpm test:int` có `AC-02` pass.
- **Phụ thuộc:** 10a

### Bước 18a — Khung Hono + auth tạm bằng header bí mật (mới)
- **File:** `src/app.ts` (`basePath("/api")`), `src/lambda.ts`, `src/local.ts` (node-server + DynamoDB Local), `src/middleware/{shared-secret,error}.ts`, `GET /api/health`.
- **TẠM THỜI — xóa ở Bước 18b:** mọi route trừ `/api/health` đòi header `x-linkwatch-key` bằng giá trị SSM SecureString `/linkwatch/api-shared-secret` (tạo tay bằng AWS CLI; CloudFormation không tạo được SecureString). Lambda đọc 1 lần và cache 5 phút; so sánh bằng `timingSafeEqual`. Web không nhúng khóa vào bundle (file tĩnh là công khai): người dùng nhập khóa một lần, lưu `localStorage`.
- **FR/AC:** NFR-07 (tạm).
- **Xong khi:** test `app.request()` cho health, 401 khi thiếu/sai header, lỗi Zod trả 400 có chi tiết.
- **Phụ thuộc:** 10a

### Bước 19a — API thêm, liệt kê, xóa link
- **File:** `src/routes/links.ts` (`POST /api/links`, `GET /api/links`, `DELETE /api/links/:id`).
- **FR/AC:** FR-01, FR-02 (trả 409 khi trùng), FR-04 (xóa mềm).
- **Xong khi:** test route pass trên DynamoDB Local.
- **Phụ thuộc:** 18a

### Bước 23a — Nền tảng web (rút gọn)
- **File:** `src/app/providers.tsx` (Mantine, TanStack Query, Notifications), `src/i18n/{vi,en}.json`, `src/lib/api.ts` (client có kiểu từ schema core, gắn header `x-linkwatch-key` từ `localStorage`), layout + menu, ô nhập khóa API, bỏ file mẫu Next.
- **FR/AC:** NFR-10.
- **Xong khi:** build ra `out/`; `pnpm dev:web` + API local hiển thị layout.
- **Phụ thuộc:** 18a

### Bước 26a — Trang danh sách link + form thêm (mới, rút gọn từ SCR-03/SCR-04)
- **File:** `src/app/links/page.tsx`, `src/features/links/{LinkTable,AddLinkForm}.tsx`.
- **FR/AC:** FR-01, FR-02 (form dùng chung schema Zod `LinkInput`), FR-04 (xóa); hiển thị trạng thái, mã HTTP, thời gian phản hồi, lần check gần nhất; tự làm mới mỗi 30 giây.
- **Xong khi:** web build pass; test component: form báo lỗi URL sai, thêm link hiện ngay trong bảng.
- **Phụ thuộc:** 19a, 23a

### Bước 35 — DataStack
- Stack mới `LinkWatch-Data`: bảng single-table (provisioned 25/25, GSI1–3, Streams NEW_AND_OLD_IMAGES, TTL, `RemovalPolicy.RETAIN`), tham số SSM.
- Làm trọn ở Mốc 1: DynamoDB chỉ thêm được **1 GSI mỗi lần cập nhật bảng**, nên tạo đủ GSI1–3 và bật Streams ngay để các mốc sau không phải deploy nhiều lượt.
- **Đã chốt 29/09/2026 — phương án (c):** provisioned 25 WCU / 25 RCU (hạn mức miễn phí dùng chung cho bảng và các GSI) cho giai đoạn đầu khi số link thực tế còn ít. Với 5.000 link, lượt 06:00 cần khoảng 20.000 lần ghi trong 15 phút nên có thể bị giới hạn tốc độ và vượt NFR-01; khi số link tăng thì xem lại (on-demand hoặc nâng capacity).
- **FR/AC:** SRS 3.4, 6.2, NFR-08. **Phụ thuộc:** 9a

### Bước 36a — Workers: hàng đợi FIFO, Dispatcher, Checker
- Stack mới `LinkWatch-Workers`: SQS FIFO + DLQ (maxReceive 3), NodejsFunction arm64/esbuild cho dispatcher/checker, **không VPC**, log 14 ngày, reserved concurrency checker = 10, EventBridge Scheduler 5 phút, event source mapping SQS, IAM tối thiểu.
- **FR/AC:** NFR-04, NFR-06, SRS 3.4 quy tắc chi phí. Assertion: không có `AWS::EC2::NatGateway`, không có `VpcConfig`. **Phụ thuộc:** 35, 12a, 13a

### Bước 37a — Api stack + behavior `/api/*`
- Stack mới `LinkWatch-Api`: HTTP API (chưa có JWT authorizer), Lambda API, quyền đọc SSM `/linkwatch/api-shared-secret` (tham chiếu theo tên). Mở rộng `LinkWatch-Web`: thêm behavior `/api/*` → API Gateway trên distribution có sẵn (cùng origin, không cần CORS; `CACHING_DISABLED`, forward header `x-linkwatch-key`), không đổi logical ID tài nguyên cũ.
- **FR/AC:** NFR-07 (tạm). Assertion: logical ID cũ của `LinkWatch-Web` còn nguyên (test ở Bước 0). **Phụ thuộc:** 36a, 19a

### Bước 38a — Budgets
- Stack mới `LinkWatch-Ops`: AWS Budgets 1 USD/tháng (email cảnh báo). Đưa lên Mốc 1 để có cảnh báo chi phí trước khi Lambda chạy thật.
- **Việc người dùng làm trước khi deploy:** đăng nhập tài khoản root, bật "IAM user and role access to Billing information" (hiện đang tắt). Xem `docs/RUNBOOK.md` mục 1. Claude phải nhắc khi tới bước này.
- **FR/AC:** SRS 3.4 (Budgets). **Phụ thuộc:** 0

### Bước 40a — Smoke test Mốc 1 (mới)
- ✅ đã làm: `deploy.yml` chạy lint/typecheck/test trước `cdk deploy` (commit `chore(ci)`).
- **File:** `scripts/smoke.ts` (gọi `/api/health`; tạo 4 link mẫu; chờ tối đa 10 phút; kiểm tra 4 trạng thái; thử request không có header → 401; xóa link mẫu); `docs/RUNBOOK.md` (tạo SSM SecureString bằng CLI trước lần push đầu).
- Không push; người dùng review rồi push để deploy.
- **Xong khi:** sau khi người dùng push, workflow xanh và smoke test pass trên https://watch.hueai.net; Budgets đã bật. **Phụ thuộc:** 26a, 37a, 38a

---

## Mốc 2 — Sự cố, email, Cognito

**Mục tiêu:** xác nhận sự cố theo 5.2, email Sự cố / Hồi phục / Nhắc lại qua SES (gửi tới người nhận đã xác thực trong sandbox), đăng nhập Cognito thay header tạm.
**Xong mốc khi:** link 404 trên môi trường thật → sau lần check lại thứ 2 mở incident → email Sự cố tới địa chỉ đã xác thực trong ≤ 5 phút; sửa link → email Hồi phục; web bắt buộc đăng nhập, header tạm đã bị xóa.

### Bước 5 — Máy trạng thái xác nhận sự cố (5.2) và trạng thái domain
- **File:** `src/incident.ts` (`evaluateCheck(linkState, result, now)` → trạng thái link mới, hành động incident open/close/none, `next_run_at`), `src/domain-status.ts`.
- **FR/AC:** 5.2 bước 1–4 (Nghi ngờ → recheck 2 phút; lần 2 mở incident; recheck 10 phút trong 1 giờ đầu rồi max(lịch gốc, 1 giờ)); FR-09; FR-42; AC-05, AC-07 mức hàm; FR-04 (link tạm dừng không được đánh giá).
- **Xong khi:** test `5.2`, `FR-09`, `AC-05`, `AC-07` pass.
- **Phụ thuộc:** 3a, 4a

### Bước 6 — Người nhận, gộp email, nhắc lại, quy tắc 80%
- **File:** `src/recipients.ts`, `src/notify.ts` (`groupIncidents` theo domain trong cửa sổ 5 phút, `isReminderDue`, `isSystemWideOutage`), `src/email-subject.ts`.
- **FR/AC:** FR-20, FR-22, FR-23, FR-24 (tiêu đề `[LinkWatch][DOWN] abc.com — 3 link lỗi`), 5.2 bước 5; AC-06 mức hàm.
- **Xong khi:** test `FR-20`, `FR-22`, `FR-23`, `FR-24`, `AC-06` pass.
- **Phụ thuộc:** 5

### Bước 8b — ElectroDB: Recipient, Settings
- **File:** `src/db/entities/{recipient,settings}.ts` + int test.
- **FR/AC:** FR-20.
- **Xong khi:** `pnpm test:int` pass: ghi/đọc người nhận theo domain và link, đọc email admin mặc định.
- **Phụ thuộc:** 8a

### Bước 9b — ElectroDB: DayStat, Incident, Notification
- **File:** `src/db/entities/{day-stat,incident,notification}.ts` + int test.
- **FR/AC:** NFR-08 (DAY# giữ 2 năm, incident vĩnh viễn), GSI2 `state`/`opened_at`, FR-25.
- **Xong khi:** `pnpm test:int` pass: cộng dồn DayStat, liệt kê incident đang mở qua GSI2.
- **Phụ thuộc:** 9a

### Bước 12b — Checker: xác nhận 2 lần và incident
- **File:** `src/handler.ts` (thêm evaluateCheck → ghi DayStat + incident; Idempotency Powertools).
- **FR/AC:** 5.2; AC-04/AC-05 mức lưu trữ (incident mở sau 2 lần lỗi).
- **Xong khi:** `pnpm test:int` (DynamoDB Local + mock SQS) pass cho 2 lần 404 → 1 incident; lỗi 1 lần rồi OK → không incident.
- **Phụ thuộc:** 5, 9b, 12a

### Bước 14 — Check lại có độ trễ (recheck 2/10 phút, xác minh +2/+5 phút, Check now)
- **File:** `packages/core/src/queue.ts` (kiểu message dùng chung), `services/checker/src/enqueue.ts`; hàng đợi ưu tiên theo giả định Q2.
- **FR/AC:** 5.2 bước 1 và 3, FR-16, FR-36, FR-37.
- **Xong khi:** test mock SQS xác nhận message đúng hàng đợi, đúng `DelaySeconds`; test int: lỗi lần 1 → job recheck 120 giây.
- **Phụ thuộc:** 12b, 13a

### Bước 15a — Mẫu email Sự cố, Hồi phục, Nhắc lại (`packages/emails`)
- **File:** `src/{incident,recovery,reminder}.tsx`, `src/render.ts`, test snapshot HTML + text.
- **FR/AC:** FR-21, FR-22 (email gộp liệt kê từng link), FR-24.
- **Xong khi:** test render pass; tiêu đề đúng FR-24.
- **Phụ thuộc:** 6

### Bước 16a — Alert Lambda: stream → gộp → SES
- **File:** `services/alert/src/handler.ts` (lọc sự kiện incident open/close từ Streams), `src/outbox.ts` (gộp 5 phút theo Q3), `src/send.ts` (SES v2, retry 3 lần, ghi `MAIL#`).
- **FR/AC:** FR-20 → FR-22, FR-24, FR-25, 5.2 bước 5, NFR-03; **AC-04**, **AC-06**, **AC-07**.
- **Xong khi:** `pnpm test:int` (DynamoDB Local + `aws-sdk-client-mock` cho SES) pass `AC-04`, `AC-06`, `AC-07`.
- **Phụ thuộc:** 8b, 12b, 14, 15a

### Bước 17a — Nhắc lại
- **File:** `services/alert/src/reminder.ts` (chạy theo tick dispatcher).
- **FR/AC:** FR-23.
- **Xong khi:** test int: incident mở 24 giờ chưa ack → 1 email Nhắc lại; đã ack → không gửi.
- **Phụ thuộc:** 16a

### Bước 18b — Auth Cognito thay header tạm
- **File:** `src/middleware/auth.ts` (đọc JWT claims từ API GW; chế độ local dùng user giả); xóa `shared-secret.ts`.
- **FR/AC:** FR-28 (MVP: email + mật khẩu qua Cognito, 1 vai trò Admin), NFR-07.
- **Xong khi:** test `app.request()`: 401 khi thiếu claims; không còn route nào đọc `x-linkwatch-key`.
- **Phụ thuộc:** 18a

### Bước 20a — API Người nhận và Cài đặt
- **File:** `src/routes/{recipients,settings}.ts`.
- **FR/AC:** FR-20, FR-26 (địa chỉ gửi SES đã xác thực, gửi email thử qua mock SES).
- **Xong khi:** test route pass.
- **Phụ thuộc:** 8b, 18a

### Bước 23b — Đăng nhập web
- **File:** `src/lib/auth.ts` (aws-amplify/auth; local dùng token giả), trang đăng nhập; bỏ ô nhập khóa API tạm.
- **FR/AC:** FR-28.
- **Xong khi:** build ra `out/`; `pnpm dev:web` + API local hiển thị layout sau đăng nhập.
- **Phụ thuộc:** 18b, 23a

### Bước 31a — SCR-08 Cài đặt email
- **FR/AC:** FR-20 (email admin mặc định), FR-23 (chu kỳ nhắc lại), FR-26 (gửi email thử). **Phụ thuộc:** 20a, 23b

### Bước 36b — Workers: hàng đợi ưu tiên, Alert
- Mở rộng `LinkWatch-Workers`: hàng đợi ưu tiên Standard (Q2), NodejsFunction Alert, event source mapping Streams có filter, IAM tối thiểu.
- **FR/AC:** NFR-04, NFR-06. **Phụ thuộc:** 36a, 17a

### Bước 37b — Cognito + JWT authorizer
- Mở rộng `LinkWatch-Api`: User Pool chỉ admin tạo user, JWT authorizer, route `/public/*` không auth; bỏ quyền đọc SSM header tạm.
- **FR/AC:** FR-28, NFR-07. **Phụ thuộc:** 37a, 18b

### Bước 38b — Tham chiếu SES
- Thêm `sesIdentity: 'watch.hueai.net'`, địa chỉ gửi mặc định vào `config.ts`; cấp quyền `ses:SendEmail` cho Alert/API theo ARN identity có sẵn, không tạo `AWS::SES::EmailIdentity`.
- **FR/AC:** FR-26. Assertion: template không chứa resource SES/ACM. **Phụ thuộc:** 36b, 37b

### Bước 40b — Smoke test Mốc 2 + RUNBOOK (mới)
- Mở rộng `scripts/smoke.ts` (đăng nhập Cognito, link 404 → incident → email tới địa chỉ đã xác thực); `docs/RUNBOOK.md` (tạo user Cognito, xác thực người nhận trong SES sandbox, xử lý DLQ, xóa SSM header tạm).
- **Xong khi:** sau khi người dùng push, workflow xanh và smoke test pass. **Phụ thuộc:** 23b, 31a, 38b

---

## Mốc 3 — Lịch theo domain/link và phần còn lại của MVP

**Mục tiêu:** trước hết là lịch theo domain/link (ghi đè lịch mặc định), sau đó các màn hình, luồng "Đã khắc phục", CI cho PR.
**Xong mốc khi:** đạt toàn bộ AC-01 → AC-13 trừ AC-08 (giai đoạn 2), smoke test đầy đủ pass trên môi trường thật.

### Lịch theo domain/link

#### Bước 3b — Lịch mẫu và lịch hiệu lực
- **File:** `src/schema/schedule.ts`, `src/schedule.ts` (`resolveEffectiveSchedule`, `computeNextRun` cho mọi kiểu lịch).
- **FR/AC:** FR-12 (chu kỳ ≥ 5 phút, giờ cố định ngày/tuần/tháng), FR-13 (Link > Domain > Mặc định, trả về nguồn kế thừa); AC-03 mức hàm.
- **Xong khi:** test `FR-12`, `FR-13`, `AC-03` pass (gồm case cuối tháng, ngày 31).
- **Phụ thuộc:** 3a

#### Bước 8c — ElectroDB: Schedule
- **File:** `src/db/entities/schedule.ts` + int test.
- **FR/AC:** FR-12.
- **Xong khi:** `pnpm test:int` pass: tạo/đọc lịch mẫu.
- **Phụ thuộc:** 8a, 3b

#### Bước 13b — Dispatcher và Checker dùng lịch hiệu lực
- **File:** `services/dispatcher/src/handler.ts`, `services/checker/src/handler.ts` (tính `next_run_at` theo lịch hiệu lực).
- **FR/AC:** FR-13; **AC-03** (mô phỏng đồng hồ: chạy dispatcher mỗi 5 phút trong 1 giờ).
- **Xong khi:** `pnpm test:int` có `AC-03` pass.
- **Phụ thuộc:** 8c, 13a

#### Bước 20b — API Domain và Lịch
- **File:** `src/routes/{domains,schedules}.ts`.
- **FR/AC:** FR-08, FR-10 (số link theo trạng thái, uptime 7/30 ngày từ DayStat, lần check gần nhất/kế tiếp), FR-11 → FR-13.
- **Xong khi:** test route pass; NFR-02: truy vấn tổng quan 500 domain dùng dữ liệu tổng hợp, không quét toàn bảng.
- **Phụ thuộc:** 8c, 9b, 18b

#### Bước 29 — SCR-06 Lịch
- **FR/AC:** FR-11, FR-12, FR-13. **Phụ thuộc:** 20b, 23b

#### Bước 25 — SCR-02 Domain (danh sách + `/domains/?d=`)
- **FR/AC:** FR-08, FR-10, FR-13 (lịch hiệu lực), FR-20 (người nhận domain), cờ bỏ qua 403 WAF, cờ cảnh báo chậm. **Phụ thuộc:** 4b, 20a, 20b, 23b

### Quản lý link đầy đủ

#### Bước 4b — Cờ "bỏ qua 403 WAF" theo domain
- **File:** `src/classify.ts`.
- **FR/AC:** cờ "bỏ qua 403 WAF" theo domain (SRS 3.4).
- **Xong khi:** test bảng 5.1 pass cả khi bật cờ (403 → không phải Link chết).
- **Phụ thuộc:** 4a

#### Bước 10b — Use case sửa, tạm dừng, xóa hàng loạt, nhập
- **File:** `src/usecases/links.ts` (sửa; tạm dừng; xóa mềm hàng loạt), `src/usecases/import.ts` (xem trước CSV/dán ≤ 1.000 dòng: hợp lệ/trùng/lỗi; commit).
- **FR/AC:** FR-03, FR-04.
- **Xong khi:** `pnpm test:int` pass: nhập CSV có dòng trùng/lỗi, tạm dừng link thì Dispatcher bỏ qua.
- **Phụ thuộc:** 10a

#### Bước 19b — API sửa, tạm dừng, thao tác hàng loạt, tìm/lọc, nhập/xuất
- **File:** `src/routes/links.ts`, `src/routes/import.ts`.
- **FR/AC:** FR-03 → FR-06 (tìm, lọc domain/trạng thái/tag/lịch, CSV xuất).
- **Xong khi:** test route pass trên DynamoDB Local, gồm thao tác hàng loạt và export CSV.
- **Phụ thuộc:** 10b, 19a

#### Bước 26b — SCR-03 Danh sách link đầy đủ
- **FR/AC:** FR-04 (thao tác hàng loạt), FR-05, FR-06. **Phụ thuộc:** 19b, 26a

#### Bước 27 — SCR-04 Thêm/nhập link
- **FR/AC:** FR-01, FR-02, FR-03 (bảng xem trước hợp lệ/trùng/lỗi). Test form dùng chung schema Zod. **Phụ thuộc:** 19b, 23b

### Sự cố, lịch sử, tổng quan

#### Bước 21 — API Sự cố, lịch sử check, Check now
- **File:** `src/routes/{incidents,checks}.ts`.
- **FR/AC:** FR-16 (link/domain/tập link → job ưu tiên), FR-17, FR-18 (100 check gần nhất, dữ liệu biểu đồ), FR-19 (lọc mở/đóng, acknowledge + ghi chú, danh sách người nhận email).
- **Xong khi:** test route pass; Check now tạo đúng message trên mock SQS.
- **Phụ thuộc:** 14, 18b

#### Bước 24 — SCR-01 Tổng quan
- **FR/AC:** FR-09, FR-10, NFR-02. **Phụ thuộc:** 20b, 23b

#### Bước 31b — SCR-09 Tài khoản
- **FR/AC:** SCR-09 MVP chỉ hiện tài khoản hiện tại (FR-29 để giai đoạn 2). **Phụ thuộc:** 23b

### Luồng "Đã khắc phục"

#### Bước 7 — Token email và logic "Đã khắc phục"
- **File:** `src/token.ts` (random ≥ 128 bit, sha256, hạn 7 ngày/đóng incident), `src/resolve-claim.ts` (chuyển Chờ xác minh, lịch xác minh 0/+2/+5 phút, kết quả sau mỗi lần, giới hạn 1 lần/2 phút).
- **FR/AC:** FR-34, FR-36, FR-37, FR-38, FR-40, FR-42; AC-12, AC-13 mức hàm.
- **Xong khi:** test `FR-34…FR-40`, `AC-12`, `AC-13` pass.
- **Phụ thuộc:** 5

#### Bước 9c — ElectroDB: ResolveClaim, Token
- **File:** `src/db/entities/{claim,token}.ts` + int test.
- **FR/AC:** FR-34 (TTL 7 ngày).
- **Xong khi:** `pnpm test:int` pass: ghi token bản băm có `ttl`, ghi claim theo incident.
- **Phụ thuộc:** 9b, 7

#### Bước 15b — Nút "Đã khắc phục" và email "vẫn lỗi"
- **File:** `src/{incident,verify-failed}.tsx`, test snapshot.
- **FR/AC:** FR-33 (nút cho từng link + nút cả nhóm), FR-38.
- **Xong khi:** test render pass; mỗi link có URL `/confirm/?token=…`.
- **Phụ thuộc:** 7, 15a

#### Bước 16b — Alert: tạo token cho từng người nhận
- **File:** `services/alert/src/handler.ts` (thêm sự kiện verify-failed), tạo token cho từng người nhận.
- **FR/AC:** FR-33, FR-34.
- **Xong khi:** test int: email Sự cố chứa token hợp lệ, DB chỉ lưu bản băm.
- **Phụ thuộc:** 9c, 15b, 16a

#### Bước 17b — Email "vẫn lỗi" chỉ gửi người bấm
- **File:** `services/alert/src/reminder.ts`, nhánh verify-failed chỉ gửi người bấm.
- **FR/AC:** FR-38; AC-10 phần email.
- **Xong khi:** test int: claim thất bại 3 lần → 1 email "vẫn lỗi" chỉ tới người bấm.
- **Phụ thuộc:** 16b

#### Bước 22 — API resolve-claim (công khai qua token + trong app)
- **File:** `src/routes/claims.ts`: `GET /public/claims?token=` (chỉ đọc), `POST /public/claims` (token), `POST /incidents/{id}/resolve-claim` (JWT, nhiều link), `GET` tiến độ xác minh; header chống cache.
- **FR/AC:** FR-34 → FR-37, FR-40, FR-41, FR-42; **AC-11** (GET không ghi gì), **AC-12**, **AC-13**.
- **Xong khi:** test route pass `AC-11`, `AC-12`, `AC-13`.
- **Phụ thuộc:** 7, 9c, 14, 18b

#### Bước 28 — SCR-05 Chi tiết link (`/links/detail/?id=`)
- **FR/AC:** FR-16, FR-17, FR-18 (Recharts thời gian phản hồi, thanh uptime 30 ngày, 100 check, sự cố), FR-41 (nút Đã khắc phục). **Phụ thuộc:** 21, 22, 23b

#### Bước 30 — SCR-07 Sự cố
- **FR/AC:** FR-19 (acknowledge, ghi chú), FR-41 (chọn nhiều link, dòng thời gian claim). **Phụ thuộc:** 21, 22, 23b

#### Bước 32 — SCR-10 Trang xác nhận (mobile, `/confirm/?token=`, không cần đăng nhập)
- **FR/AC:** FR-35 (GET chỉ hiển thị, nút POST), FR-39 (tự cập nhật mỗi 3 giây tới khi xong 3 lần), FR-42, AC-12 (trang hết hạn / "Đã hồi phục lúc …"). **Phụ thuộc:** 22, 23b

#### Bước 33 — Integration test luồng claim
- **File:** `tests/flows/resolve-claim.int.test.ts` (API + checker + alert gọi trực tiếp handler, DynamoDB Local, SQS/SES mock, đồng hồ giả).
- **FR/AC:** **AC-09**, **AC-10**, FR-37, FR-38, FR-42.
- **Xong khi:** `pnpm test:int` pass AC-09, AC-10. **Phụ thuộc:** 17b, 22

#### Bước 34 — Playwright E2E SCR-10
- **File:** `apps/web/e2e/confirm.spec.ts`, `playwright.config.ts` (chạy web + API local).
- **FR/AC:** AC-09 (UI ≤ 30 giây), **AC-11** (mở GET như bộ quét link → không có claim), AC-12, AC-13, NFR-10 (viewport mobile).
- **Xong khi:** `pnpm e2e` pass. **Phụ thuộc:** 32, 33

### CI và hoàn tất

#### Bước 39 — CI trên Pull Request
- `.github/workflows/ci.yml`: install (cache pnpm) → lint → typecheck → test → test:int (DynamoDB Local service container) → web build → synth → `cdk diff` qua OIDC.
- **Xong khi:** PR thử chạy xanh. **Phụ thuộc:** 38b

#### Bước 40c — Smoke test đầy đủ + heartbeat
- Mở rộng `scripts/smoke.ts` (lịch riêng, Check now, luồng "Đã khắc phục"); heartbeat healthchecks.io (NFR-05).
- Không push; người dùng review rồi push để deploy.
- **Xong khi:** sau khi người dùng push, workflow xanh và smoke test pass trên https://watch.hueai.net. **Phụ thuộc:** 34, 39

---

## Tóm tắt và ước lượng

| Mốc | Bước | Ước lượng |
| --- | --- | --- |
| 1 Walking skeleton | 0 ✅, 1 ✅, 2, 3a, 4a, 8a, 9a, 10a, 11, 12a, 13a, 18a, 19a, 23a, 26a, 35, 36a, 37a, 38a, 40a | khoảng 30–38 giờ |
| 2 Sự cố, email, Cognito | 5, 6, 8b, 9b, 12b, 14, 15a, 16a, 17a, 18b, 20a, 23b, 31a, 36b, 37b, 38b, 40b | khoảng 25–32 giờ |
| 3 Lịch riêng và phần còn lại | 3b, 8c, 13b, 20b, 29, 25, 4b, 10b, 19b, 26b, 27, 21, 24, 31b, 7, 9c, 15b, 16b, 17b, 22, 28, 30, 32, 33, 34, 39, 40c | khoảng 32–42 giờ |
| **Tổng** | | **khoảng 87–112 giờ** (thêm khoảng 7 giờ so với bản cũ do auth tạm và smoke test theo mốc) |

Trong mỗi mốc, làm theo thứ tự liệt kê. Frontend của một mốc làm song song với backend được khi API client dùng dữ liệu giả.

## Câu hỏi mở ảnh hưởng tới code

**Đã chốt 29/09/2026:** chấp nhận toàn bộ giả định Q1–Q5 dưới đây.

1. **Q1 — Ranh giới MVP.** FR-15 (khung bảo trì, AC-08) thuộc HLR-05 "Must" nhưng SRS 7.2 xếp vào giai đoạn 2; FR-41/FR-42 nằm ngoài dải "FR-33 đến FR-40". *Giả định:* FR-15, FR-27 để giai đoạn 2; FR-41, FR-42 làm trong MVP (dùng chung API resolve-claim, FR-42 là hệ quả của 5.2).
2. **Q2 — Check lại có độ trễ với SQS FIFO.** Recheck sau 2 phút, xác minh +2/+5 phút nhỏ hơn chu kỳ 5 phút của Dispatcher, mà SQS FIFO không hỗ trợ `DelaySeconds` theo từng message. *Giả định:* thêm một hàng đợi **Standard** "ưu tiên" cho recheck/xác minh/Check now, dùng `DelaySeconds` (≤ 15 phút); giới hạn 2 request/domain trong Checker bằng `p-limit` theo domain. Hàng đợi FIFO giữ cho lượt theo lịch.
3. **Q3 — Gộp email 5 phút với DynamoDB Streams.** Streams đẩy ngay từng thay đổi, cần chỗ giữ tạm để gộp. *Giả định:* Alert ghi incident vào `OUTBOX#<domain>` và đặt một message trễ 5 phút vào hàng đợi ưu tiên; khi message tới, gửi 1 email cho mọi incident trong outbox. Email gửi trong khoảng ≤ 5 phút sau khi xác nhận (đạt NFR-03 ở mức biên).
4. **Q4 — Ngữ nghĩa trạng thái khi incident đang mở.** Chưa rõ: kết quả *Chậm* có đóng incident không; loại lỗi đổi (Link chết → Site down) thì mở incident mới hay cập nhật; "một lượt" trong quy tắc 80% tính thế nào. *Giả định:* Chậm = thành công (đóng incident); đổi loại lỗi thì cập nhật `type` của incident đang mở, không mở mới, không gửi thêm email; "lượt" = các check trong cùng một tick Dispatcher, chỉ áp dụng khi tick có ≥ 20 link.
5. **Q5 — Đăng nhập MVP và danh tính người bấm.** "Đăng nhập đơn giản 1 vai trò Admin" chưa nói ai tạo tài khoản và ai được Acknowledge. *Giả định:* Cognito User Pool tắt tự đăng ký, Admin tạo user qua console/CLI (ghi trong RUNBOOK); mọi user đăng nhập đều là Admin; claim qua email ghi `by_email` = email người nhận gắn với token, claim trong app ghi email Cognito.
