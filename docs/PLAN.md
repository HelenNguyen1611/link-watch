# LinkWatch — Kế hoạch build MVP (Giai đoạn 1, SRS 7.2)

29/09/2026 · đã duyệt 29/09/2026 · sắp lại theo 3 mốc 29/09/2026

## Phạm vi MVP

- **Trong MVP:** HLR-01 → HLR-08 (FR-01 → FR-14, FR-16 → FR-26), đăng nhập đơn giản 1 vai trò Admin, luồng "Đã khắc phục" FR-33 → FR-42, triển khai serverless lên môi trường duy nhất đang chạy (https://watch.hueai.net).
- **Để giai đoạn 2** (theo SRS 7.2): FR-15 khung bảo trì (AC-08), FR-27 cảnh báo SSL, FR-28 SSO, FR-29 quản lý người dùng/vai trò, FR-30 audit log, FR-31/32. Schema vẫn chừa chỗ để không phải migrate. Xem câu hỏi Q1.
- Mỗi bước = 1 commit, 1–3 giờ. "Xong" luôn gồm `pnpm lint && pnpm typecheck && pnpm test` pass, cộng với kiểm tra riêng của bước.
- Test không gọi AWS thật: DynamoDB Local (`pnpm db:local`) hoặc `aws-sdk-client-mock`.
- **Chỉ commit local, không `git push`.** Push `main` chạy `deploy.yml` → `cdk deploy --all` lên AWS thật; người dùng tự review và push. Từ bước 35, mỗi lần push sẽ tạo/sửa stack thật.

## Hạ tầng đã có (29/09/2026) — không tạo lại, chỉ mở rộng

- 1 môi trường, không stage. Tên stack `LinkWatch-<Tên>`: đã có `LinkWatch-Web`, `LinkWatch-Cicd`; đã thêm `LinkWatch-Data` (Bước 35), sẽ thêm `LinkWatch-Workers`, `LinkWatch-Api`. Budget quản lý thủ công trên Console, không nằm trong CDK.
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

**Đã chốt 29/09/2026 (Mốc 2):** địa chỉ gửi mặc định `noreply@watch.hueai.net`; email admin mặc định và người nhận smoke test `helen@wootech.co` (phải xác thực trong SES sandbox); bước hạ tầng viết + synth + test rồi commit local; bỏ header tạm và chuyển sang Cognito trong cùng một lần push.

**Đã chốt 29/09/2026 (sau Mốc 1 phần local):**

- **Ngôn ngữ (đổi so với SRS NFR-10):** giao diện **chỉ tiếng Anh** (bỏ tiếng Việt khỏi UI). Toàn bộ code (tên, comment, tên test, thông điệp lỗi/log, message commit) viết tiếng Anh; tài liệu `docs/` giữ tiếng Việt.

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
- **File:** `src/app/providers.tsx` (Mantine, TanStack Query, Notifications), `src/i18n/en.json` (ban đầu vi + en; từ 29/09/2026 chỉ tiếng Anh), `src/lib/api.ts` (client có kiểu từ schema core, gắn header `x-linkwatch-key` từ `localStorage`), layout + menu, ô nhập khóa API, bỏ file mẫu Next.
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
- Stack mới `LinkWatch-Workers`: SQS FIFO + DLQ (maxReceive 3), NodejsFunction arm64/esbuild cho dispatcher/checker, **không VPC**, log 14 ngày, EventBridge Scheduler 5 phút, event source mapping SQS, IAM tối thiểu.
- **Đổi 29/09/2026:** không dùng reserved concurrency cho Checker. Hạn mức concurrency của tài khoản **hiện là 10** (đã/sẽ xin tăng lên 1000), reserve 10 sẽ làm deploy lỗi. Giới hạn bằng `maxConcurrency = 5` trên event source SQS để chừa suất cho API, Dispatcher và Lambda BucketDeployment. Khi hạn mức ≥ 100: có thể tăng `maxConcurrency` hoặc cân nhắc reserved concurrency.
- **FR/AC:** NFR-04, NFR-06, SRS 3.4 quy tắc chi phí. Assertion: không có `AWS::EC2::NatGateway`, không có `VpcConfig`. **Phụ thuộc:** 35, 12a, 13a

### Bước 37a — Api stack + behavior `/api/*`
- Stack mới `LinkWatch-Api`: HTTP API (chưa có JWT authorizer), Lambda API, quyền đọc SSM `/linkwatch/api-shared-secret` (tham chiếu theo tên). Mở rộng `LinkWatch-Web`: thêm behavior `/api/*` → API Gateway trên distribution có sẵn (cùng origin, không cần CORS; `CACHING_DISABLED`, forward header `x-linkwatch-key`), không đổi logical ID tài nguyên cũ.
- **FR/AC:** NFR-07 (tạm). Assertion: logical ID cũ của `LinkWatch-Web` còn nguyên (test ở Bước 0). **Phụ thuộc:** 36a, 19a

### Bước 38a — Budgets (chỉ tài liệu, gộp vào commit Bước 37a)
- **Đổi 29/09/2026:** tài khoản đã có sẵn budget "My Zero-Spend Budget" (tạo thủ công trên Console, cảnh báo khi chi phí > 0,01 USD). **Không tạo Budget bằng CDK**, không có stack `LinkWatch-Ops`.
- `docs/RUNBOOK.md`: ghi Budget quản lý thủ công; bật "IAM access to Billing" là tùy chọn (chỉ để user helen xem chi phí, deploy không cần).
- **FR/AC:** SRS 3.4 (Budgets). **Phụ thuộc:** 0

### Bước 40a — Smoke test Mốc 1 (mới)
- ✅ đã làm: `deploy.yml` chạy lint/typecheck/test trước `cdk deploy` (commit `chore(ci)`).
- ✅ đã làm (29/09/2026): `scripts/smoke.ts` (workspace `@linkwatch/scripts`, lệnh `pnpm smoke`) + unit test, RUNBOOK mục 4. Còn chờ: người dùng push rồi chạy trên production.
- **File:** `scripts/smoke.ts` (gọi `/api/health`; tạo 4 link mẫu; chờ tối đa 10 phút; kiểm tra 4 trạng thái; thử request không có header → 401; xóa link mẫu); `docs/RUNBOOK.md` (mục tạo SSM SecureString đã thêm ở Bước 37a).
- Không push; người dùng review rồi push để deploy.
- **Xong khi:** sau khi người dùng push, workflow xanh và smoke test pass trên https://watch.hueai.net. **Phụ thuộc:** 26a, 37a

---

## Mốc 2 — Sự cố, email, Cognito

**Mục tiêu:** xác nhận sự cố theo 5.2, email Sự cố / Hồi phục / Nhắc lại qua SES (gửi tới người nhận đã xác thực trong sandbox), đăng nhập Cognito thay header tạm.
**Xong mốc khi:** link 404 trên môi trường thật → sau lần check lại thứ 2 mở incident → email Sự cố tới địa chỉ đã xác thực trong ≤ 5 phút; sửa link → email Hồi phục; web bắt buộc đăng nhập, header tạm đã bị xóa.

### Bước 5 — Máy trạng thái xác nhận sự cố (5.2) và trạng thái domain ✅
- ✅ đã làm (29/09/2026): thời lượng down tính từ `openedAt` (lần lỗi thứ 2); đổi loại lỗi khi incident đang mở thì giữ 1 incident; `suspect`/`pending` tính là bình thường cho FR-09.
- **File:** `src/incident.ts` (`evaluateCheck(linkState, result, now)` → trạng thái link mới, hành động incident open/close/none, `next_run_at`), `src/domain-status.ts`.
- **FR/AC:** 5.2 bước 1–4 (Nghi ngờ → recheck 2 phút; lần 2 mở incident; recheck 10 phút trong 1 giờ đầu rồi max(lịch gốc, 1 giờ)); FR-09; FR-42; AC-05, AC-07 mức hàm; FR-04 (link tạm dừng không được đánh giá).
- **Xong khi:** test `5.2`, `FR-09`, `AC-05`, `AC-07` pass.
- **Phụ thuộc:** 3a, 4a

### Bước 6 — Người nhận, gộp email, nhắc lại, quy tắc 80% ✅
- ✅ đã làm (29/09/2026): gộp theo (domain, loại email) — Sự cố và Hồi phục tách email; `sendAt` = sự kiện đầu + 5 phút (Q3); `groupByRecipient` tách email gộp để mỗi người chỉ nhận link của mình; Nhắc lại tính cả incident Chờ xác minh, `null` = tắt; tiêu đề email viết tiếng Anh theo quyết định UI chỉ tiếng Anh: `[LinkWatch][DOWN] abc.com — 3 broken links`.
- **File:** `src/recipients.ts`, `src/notify.ts` (`groupIncidents` theo domain trong cửa sổ 5 phút, `isReminderDue`, `isSystemWideOutage`), `src/email-subject.ts`.
- **FR/AC:** FR-20, FR-22, FR-23, FR-24 (tiêu đề `[LinkWatch][DOWN] abc.com — 3 link lỗi`), 5.2 bước 5; AC-06 mức hàm.
- **Xong khi:** test `FR-20`, `FR-22`, `FR-23`, `FR-24`, `AC-06` pass.
- **Phụ thuộc:** 5

### Bước 8b — ElectroDB: Recipient, Settings ✅
- ✅ đã làm (29/09/2026): Recipient có `scope` (`DOMAIN`/`LINK`) + `target` → PK `DOMAIN#<domain>` hoặc `LINK#<id>`, SK `RCP#<email>`; email lưu dạng chuẩn hóa (trim, chữ thường) nên khóa tự chống trùng. Settings là 1 item `SETTINGS`/`META` (địa chỉ gửi, tên người gửi mặc định `LinkWatch`, email admin mặc định, nhắc lại bật + 24 giờ); chưa có item thì `get` trả `null`, nơi gọi dùng mặc định.
- **File:** `src/db/entities/{recipient,settings}.ts` + int test.
- **FR/AC:** FR-20.
- **Xong khi:** `pnpm test:int` pass: ghi/đọc người nhận theo domain và link, đọc email admin mặc định.
- **Phụ thuộc:** 8a

### Bước 9b — ElectroDB: DayStat, Incident, Notification ✅
- ✅ đã làm (29/09/2026): incident id = `<linkId>@<openedAt>`; GSI2 pk = `INC#<state>`, sk = `<openedAt>#<linkId>` (incident đã đóng vẫn ở GSI2 dưới `INC#closed` để SCR-07 liệt kê); DayStat theo ngày Asia/Saigon, TTL 732 ngày; Notification SK `MAIL#<sentAt>#<to>` (1 dòng cho mỗi incident × người nhận).
- **File:** `src/db/entities/{day-stat,incident,notification}.ts` + int test.
- **FR/AC:** NFR-08 (DAY# giữ 2 năm, incident vĩnh viễn), GSI2 `state`/`opened_at`, FR-25.
- **Xong khi:** `pnpm test:int` pass: cộng dồn DayStat, liệt kê incident đang mở qua GSI2.
- **Phụ thuộc:** 9a

### Bước 12b — Checker: xác nhận 2 lần và incident ✅
- ✅ đã làm (29/09/2026): logic nằm ở `packages/core/src/usecases/checks.ts` (`recordCheck`), handler chỉ gọi. **Đổi so với plan (người dùng chốt 29/09/2026):** không dùng Powertools Idempotency (thêm 2 lượt ghi/link vào bảng provisioned free tier); chống trùng bằng `lastJobId` (= SQS messageId) trên Link — lượt ghi Link có điều kiện `lastJobId <> messageId` là điểm chốt, sau đó mới ghi Check, DayStat, incident. Lambda chết sau điểm chốt thì mất bản ghi check/DayStat của lần đó; incident chưa kịp mở sẽ được mở lại ở các lần check sau. Đến Bước 14, recheck 2/10 phút vẫn đi qua Dispatcher (trễ tối đa 5 phút).
- **File:** `src/handler.ts` (thêm evaluateCheck → ghi DayStat + incident; Idempotency Powertools).
- **FR/AC:** 5.2; AC-04/AC-05 mức lưu trữ (incident mở sau 2 lần lỗi).
- **Xong khi:** `pnpm test:int` (DynamoDB Local + mock SQS) pass cho 2 lần 404 → 1 incident; lỗi 1 lần rồi OK → không incident.
- **Phụ thuộc:** 5, 9b, 12a

### Bước 14 — Check lại có độ trễ (recheck 2/10 phút, xác minh +2/+5 phút, Check now) ✅
- ✅ đã làm (29/09/2026): `CheckJob` = `scheduled` (FIFO) | `recheck`/`check_now`/`verify` (hàng đợi ưu tiên, có `dueAt`). `planNextRun`: lần chạy kế trong ≤ 15 phút → gửi message trễ vào hàng đợi ưu tiên và ghi `next_run_at` = giờ recheck + 5 phút làm dự phòng cho Dispatcher. Gửi SQS lỗi không làm fail message (đã có dự phòng). Hàng đợi Standard chỉ trả lại đúng message lỗi. Mới nối `recheck`; `check_now` (Bước 21) và `verify` (Mốc 3) chỉ có schema. Checker đọc `PRIORITY_QUEUE_URL` (Bước 36b). `node_modules` được cài lại bằng pnpm 10.33.0 (trước đó cài nhầm bằng 12.6.0).
- **File:** `packages/core/src/queue.ts` (kiểu message dùng chung), `services/checker/src/enqueue.ts`; hàng đợi ưu tiên theo giả định Q2.
- **FR/AC:** 5.2 bước 1 và 3, FR-16, FR-36, FR-37.
- **Xong khi:** test mock SQS xác nhận message đúng hàng đợi, đúng `DelaySeconds`; test int: lỗi lần 1 → job recheck 120 giây.
- **Phụ thuộc:** 12b, 13a

### Bước 15a — Mẫu email Sự cố, Hồi phục, Nhắc lại (`packages/emails`) ✅
- ✅ đã làm (29/09/2026): chữ trong email gom ở `src/strings.ts` (tiếng Anh); giờ hiển thị dạng số `2026-09-30 06:04 (GMT+7)` để không phụ thuộc ICU; link trang sự cố `/incidents/?id=<incidentId>` (trang làm ở Mốc 3). Nút "Đã khắc phục" để Bước 15b.
- **File:** `src/{incident,recovery,reminder}.tsx`, `src/render.ts`, test snapshot HTML + text.
- **FR/AC:** FR-21, FR-22 (email gộp liệt kê từng link), FR-24.
- **Xong khi:** test render pass; tiêu đề đúng FR-24.
- **Phụ thuộc:** 6

### Bước 16a — Alert Lambda: stream → gộp → SES ✅
- ✅ đã làm (29/09/2026): Streams: incident INSERT → `down`, MODIFY sang `closed` → `recovery` → `OUTBOX#<domain>#<kind>` / `EVT#<at>#<incidentId>`; sự kiện đầu tạo `WINDOW` (có điều kiện) và gửi message trễ 300 giây. **Lệch Q3:** message flush vào **hàng đợi `alert` Standard riêng** (Alert tiêu thụ), không vào hàng đợi ưu tiên của Checker. Flush xóa `WINDOW` trước rồi mới đọc outbox; Sự cố chỉ gửi cho incident chưa đóng và chưa báo (`downNotifiedAt`); Hồi phục chỉ gửi khi đã có email Sự cố và chưa có `recoveryNotifiedAt` → flush bị gửi lại không gửi trùng. SES: app tự retry 3 lần (SDK `maxAttempts: 1`), lỗi vĩnh viễn không retry; mỗi incident × người nhận một dòng `MAIL#`. Người gửi/admin lấy từ Settings, thiếu thì dùng env `SENDER_EMAIL`, `DEFAULT_ADMIN_EMAIL`, link dùng `APP_URL`. **Quy tắc 80%:** Dispatcher ghi `TICK`/`<dispatchedAt>` khi lượt ≥ 20 link (trước khi gửi SQS), Checker cộng `failed` cho mỗi lần check lỗi của job `scheduled`; flush thấy lượt ≥ 80% lỗi trong 30 phút gần nhất → không gửi cho người nhận domain, gửi đúng 1 email admin mỗi lượt (`adminNotifiedAt` có điều kiện); incident bị chặn email thì cũng không có email Hồi phục.
- **File:** `services/alert/src/handler.ts` (lọc sự kiện incident open/close từ Streams), `src/outbox.ts` (gộp 5 phút theo Q3), `src/send.ts` (SES v2, retry 3 lần, ghi `MAIL#`).
- **FR/AC:** FR-20 → FR-22, FR-24, FR-25, 5.2 bước 5, NFR-03; **AC-04**, **AC-06**, **AC-07**.
- **Xong khi:** `pnpm test:int` (DynamoDB Local + `aws-sdk-client-mock` cho SES) pass `AC-04`, `AC-06`, `AC-07`.
- **Phụ thuộc:** 8b, 12b, 14, 15a

### Bước 17a — Nhắc lại ✅
- ✅ đã làm (29/09/2026): Alert nhận event `{"kind":"reminders"}` từ EventBridge Scheduler (mỗi 15 phút, tạo ở Bước 36b) thay vì chạy theo tick Dispatcher. Chỉ nhắc incident Đang mở/Chờ xác minh, chưa Acknowledge, **đã có email Sự cố**; gộp theo domain + người nhận; `lastReminderAt` được ghi kể cả khi gửi lỗi (lỗi vẫn ghi `MAIL#`) để không gửi lại mỗi 15 phút.
- **File:** `services/alert/src/reminder.ts` (chạy theo tick dispatcher).
- **FR/AC:** FR-23.
- **Xong khi:** test int: incident mở 24 giờ chưa ack → 1 email Nhắc lại; đã ack → không gửi.
- **Phụ thuộc:** 16a

### Bước 18b — Auth Cognito thay header tạm ✅
- ✅ đã làm (29/09/2026): `middleware/auth.ts` đọc claims của JWT authorizer (payload 2.0), bắt buộc **ID token** (`token_use = id`, có `email`) → `c.get("user")`; công khai `/api/health`, `/api/public/*`. Local: mọi `Authorization: Bearer …` đăng nhập thành `LOCAL_USER_EMAIL` (mặc định `dev@example.com`; `dev@localhost` không qua được kiểm tra email của Zod). Đã xóa `shared-secret.ts`, `secret.ts`, dependency SSM. `API_KEY_HEADER` trong core còn giữ cho web/smoke đến Bước 23b/40b.
- **File:** `src/middleware/auth.ts` (đọc JWT claims từ API GW; chế độ local dùng user giả); xóa `shared-secret.ts`.
- **FR/AC:** FR-28 (MVP: email + mật khẩu qua Cognito, 1 vai trò Admin), NFR-07.
- **Xong khi:** test `app.request()`: 401 khi thiếu claims; không còn route nào đọc `x-linkwatch-key`.
- **Phụ thuộc:** 18a

### Bước 20a — API Người nhận và Cài đặt ✅
- ✅ đã làm (29/09/2026): `GET/POST/DELETE /api/recipients?scope=DOMAIN|LINK&target=…` (409 trùng, 404 khi domain/link không có); `GET/PATCH /api/settings` trả giá trị hiệu lực (Settings ∪ mặc định từ env `SES_IDENTITY`, `SENDER_EMAIL`, `DEFAULT_ADMIN_EMAIL`), địa chỉ gửi phải thuộc SES identity (`sender_not_verified`); `POST /api/settings/test-email` (mặc định gửi tới email đang đăng nhập, lỗi SES → 502 kèm lỗi). `sendEmail` chuyển sang `packages/emails` để API và Alert dùng chung; schema dùng chung ở `core/schema/settings.ts`.
- **File:** `src/routes/{recipients,settings}.ts`.
- **FR/AC:** FR-20, FR-26 (địa chỉ gửi SES đã xác thực, gửi email thử qua mock SES).
- **Xong khi:** test route pass.
- **Phụ thuộc:** 8b, 18a

### Bước 23b — Đăng nhập web ✅
- ✅ đã làm (30/09/2026): trang `/login/` (công khai, ngoài khung app) gồm đăng nhập email + mật khẩu (SRP qua client `linkwatch-web`), đặt mật khẩu mới lần đầu (mật khẩu tạm trong email mời), quên mật khẩu (mã qua email → mật khẩu mới), danh sách quy tắc mật khẩu khớp policy User Pool. `lib/auth.ts` (interface + `safeNext` chống open redirect + `loadAuthSetup`), `auth-cognito.ts` (Amplify, tự gia hạn ID token bằng refresh token 30 ngày), `auth-local.ts` (chỉ `next dev` khi không có `/auth-config.json`; production thiếu file → báo lỗi, không bao giờ đăng nhập giả), `auth-context.tsx` (phiên + API client gửi `Authorization: Bearer <idToken>`, 401 → đăng xuất). `AuthGate` thay `ApiKeyGate`; `/login/` và `/confirm/` không cần đăng nhập. Header phải: email + Sign out (thay tagline). Đã xóa ô khóa API tạm, trang Settings → API key, `lib/api-key.ts`, `API_KEY_HEADER` trong core.
- **File:** `src/lib/auth.ts` (aws-amplify/auth; local dùng token giả), trang đăng nhập; bỏ ô nhập khóa API tạm.
- **FR/AC:** FR-28.
- **Xong khi:** build ra `out/`; `pnpm dev:web` + API local hiển thị layout sau đăng nhập.
- **Phụ thuộc:** 18b, 23a

### Bước 31a — SCR-08 Cài đặt email ✅
- ✅ đã làm (30/09/2026): `/settings/email/` — địa chỉ gửi (kiểm tra thuộc SES identity ngay trên form, API vẫn kiểm tra lại), tên người gửi, email admin mặc định, bật/tắt nhắc lại + chu kỳ 1–720 giờ (khóa khi tắt); Save chỉ bật khi có thay đổi, có Discard; gửi email thử (trống = gửi tới email đang đăng nhập), lỗi SES hiện nguyên văn kèm gợi ý sandbox. Form dùng `SettingsInput` của core (`.required()`).
- **FR/AC:** FR-20 (email admin mặc định), FR-23 (chu kỳ nhắc lại), FR-26 (gửi email thử). **Phụ thuộc:** 20a, 23b

### Bước 36b — Workers: hàng đợi ưu tiên, Alert ✅
- ✅ đã làm (30/09/2026): `PriorityQueue` Standard (+DLQ, visibility 15 phút) → Checker (batch 5, maxConcurrency 2), Checker có quyền gửi vào đó; `AlertQueue` Standard (+DLQ) → Alert (batch 5, maxConcurrency 2); Streams → Alert có filter `eventName ∈ {INSERT, MODIFY}` và `NewImage.__edb_e__ = incident`, bisect + retry 5 lần + DLQ; Scheduler 15 phút gửi `{"kind":"reminders"}`. `config.ts` thêm `sesIdentity`, `senderEmail`, `defaultAdminEmail` (dùng làm env của Alert). Logical ID cũ giữ nguyên (chỉ thêm tài nguyên). **Lưu ý concurrency:** tối đa Checker 5 + 2, Alert 1/shard + 2, cộng API/Dispatcher có thể vượt quota tài khoản 10 khi tải cao → Lambda bị throttle và SQS/Streams tự thử lại (không mất việc; API có thể trả 429 lúc cao điểm).
- Mở rộng `LinkWatch-Workers`: hàng đợi ưu tiên Standard (Q2), NodejsFunction Alert, event source mapping Streams có filter, IAM tối thiểu.
- **FR/AC:** NFR-04, NFR-06. **Phụ thuộc:** 36a, 17a

### Bước 37b — Cognito + JWT authorizer ✅
- ✅ đã làm (30/09/2026): User Pool `linkwatch-users` (tắt tự đăng ký, đăng nhập bằng email, mật khẩu ≥ 12 ký tự, RETAIN + deletion protection), client SPA `linkwatch-web` (SRP, không secret, ID token 1 giờ, refresh 30 ngày); JWT authorizer (audience = client id) trên `ANY /api` và `ANY /api/{proxy+}`; `GET /api/health`, `ANY /api/public/{proxy+}` không auth. Đã bỏ env/quyền SSM của header tạm. **Web static export không biết id lúc build** → Web stack ghi `/auth-config.json` (`region`, `userPoolId`, `userPoolClientId`) vào S3 cùng BucketDeployment (giá trị lấy từ LinkWatch-Api qua `Fn::GetStackOutput`); web đọc file này khi khởi động (Bước 23b). Logical ID cũ giữ nguyên. Tham số SSM `/linkwatch/api-shared-secret` (tạo tay) xóa tay sau khi deploy (RUNBOOK, Bước 40b).
- Mở rộng `LinkWatch-Api`: User Pool chỉ admin tạo user, JWT authorizer, route `/public/*` không auth; bỏ quyền đọc SSM header tạm.
- **FR/AC:** FR-28, NFR-07. **Phụ thuộc:** 37a, 18b

### Bước 37c — Lỗi JSON của `/api/*` qua CloudFront (mới) ✅
- ✅ đã làm (30/09/2026): bỏ `errorResponses`; CloudFront Function `IndexRewrite` (chỉ behavior mặc định, giữ logical ID) nhúng danh sách trang `.html` đọc từ `apps/web/out` lúc synth → trang không có trong bản build được rewrite sang `/404.html` (**trả 200 kèm trang 404**, vì viewer-request không đổi được mã của origin); file có đuôi (asset, `auth-config.json`) không đụng tới. Synth báo lỗi rõ nếu code vượt 10 KB. Kiểm tra trên môi trường thật (`DELETE /api/links/<id không có>` → 404 JSON) làm ở smoke test 40b.
- **Hạn chế đã chấp nhận ở Mốc 1:** `errorResponses` của distribution (403/404 → `/404.html`) áp cho mọi behavior, nên API trả 404 (hoặc 403) thì body JSON bị CloudFront thay bằng trang HTML (mã HTTP vẫn giữ).
- Sửa: bỏ `errorResponses` khỏi distribution và xử lý trang 404 của web tĩnh bằng CloudFront Function (chỉ gắn behavior mặc định), hoặc cách tương đương không ảnh hưởng `/api/*`; giữ logical ID tài nguyên cũ.
- **Xong khi:** test CDK: `/api/*` không chịu `errorResponses`; trên môi trường thật `DELETE /api/links/<id không có>` trả 404 JSON `{"error":"not_found"}`, còn đường dẫn web không tồn tại vẫn ra trang 404. **Phụ thuộc:** 37a

### Bước 38b — Tham chiếu SES ✅
- ✅ đã làm (30/09/2026): `config.ts` có `sesIdentity`, `senderEmail` (từ Bước 36b); `infra/lib/ses.ts` `grantSendEmail()` cấp `ses:SendEmail` cho Alert và API trên `identity/*` **kèm điều kiện** `ses:FromAddress` ∈ `*@watch.hueai.net`, `*@*.watch.hueai.net` (sandbox SES kiểm tra quyền cả trên identity người nhận đã xác thực, nên không giới hạn resource vào đúng domain). Test: không stack nào có tài nguyên `AWS::SES::*` hay `AWS::CertificateManager::*`.
- Thêm `sesIdentity: 'watch.hueai.net'`, địa chỉ gửi mặc định vào `config.ts`; cấp quyền `ses:SendEmail` cho Alert/API theo ARN identity có sẵn, không tạo `AWS::SES::EmailIdentity`.
- **FR/AC:** FR-26. Assertion: template không chứa resource SES/ACM. **Phụ thuộc:** 36b, 37b

### Bước 40b — Smoke test Mốc 2 + RUNBOOK (mới)
- 🟡 code xong (30/09/2026), **chờ push + chạy thật**: smoke đăng nhập bằng `AdminInitiateAuth` qua client Cognito riêng `linkwatch-smoke` (chỉ bật `ADMIN_USER_PASSWORD_AUTH`, cần credentials IAM); kiểm tra 37c (`DELETE /api/links/<không có>` → 404 JSON, trang web không có → trang 404); luồng sự cố dùng link `https://watch.hueai.net/smoke/<run>.txt` (S3 trả 403 → Link chết) → incident → `MAIL#` `down` `sent` ≤ 5 phút (+1) → upload file → `recovery` `sent`; đọc incident/`MAIL#` thẳng từ DynamoDB (Mốc 3 mới có API). RUNBOOK: tạo user Cognito, xóa SSM header tạm, SES sandbox, bảng xử lý 3 DLQ, cách chạy smoke.
- Mở rộng `scripts/smoke.ts` (đăng nhập Cognito, link 404 → incident → email tới địa chỉ đã xác thực); `docs/RUNBOOK.md` (tạo user Cognito, xác thực người nhận trong SES sandbox, xử lý DLQ, xóa SSM header tạm).
- **Xong khi:** sau khi người dùng push, workflow xanh và smoke test pass. **Phụ thuộc:** 23b, 31a, 38b

---

## Mốc 3 — Lịch theo domain/link và phần còn lại của MVP

**Mục tiêu:** trước hết là lịch theo domain/link (ghi đè lịch mặc định), sau đó các màn hình, luồng "Đã khắc phục", CI cho PR.
**Xong mốc khi:** đạt toàn bộ AC-01 → AC-13 trừ AC-08 (giai đoạn 2), smoke test đầy đủ pass trên môi trường thật.

### Lịch theo domain/link

#### Bước 3b — Lịch mẫu và lịch hiệu lực ✅
- ✅ đã làm (30/09/2026): `ScheduleRule` (Zod) = chu kỳ 5/15/30/60/360/720 phút | hàng ngày HH:mm | hàng tuần (thứ ISO 1–7) | hàng tháng (ngày 1–31, quá cuối tháng → ngày cuối, không chạy 2 lần); `computeNextRun` cho mọi kiểu (chu kỳ căn theo mốc giờ Việt Nam); jitter chu kỳ ≤ min(5 phút, chu kỳ) và tính mốc kế từ (now − jitter) để lượt sau cách đúng 1 chu kỳ; `resolveEffectiveSchedule` Link > Domain > Mặc định (template `default`, chưa có thì 06:00), template đã xóa → xuống cấp kế. AC-03 pass mức hàm.
- **File:** `src/schema/schedule.ts`, `src/schedule.ts` (`resolveEffectiveSchedule`, `computeNextRun` cho mọi kiểu lịch).
- **FR/AC:** FR-12 (chu kỳ ≥ 5 phút, giờ cố định ngày/tuần/tháng), FR-13 (Link > Domain > Mặc định, trả về nguồn kế thừa); AC-03 mức hàm.
- **Xong khi:** test `FR-12`, `FR-13`, `AC-03` pass (gồm case cuối tháng, ngày 31).
- **Phụ thuộc:** 3a

#### Bước 8c — ElectroDB: Schedule ✅
- ✅ đã làm (30/09/2026): entity `Schedule` (PK `SCHED#<id>`, SK `META`, GSI3 pk `SCHED`; `rule` lưu dạng map, kiểm tra bằng `ScheduleRule` trước khi ghi), `loadScheduleTemplates` (id → rule, bỏ qua rule hỏng).
- **File:** `src/db/entities/schedule.ts` + int test.
- **FR/AC:** FR-12.
- **Xong khi:** `pnpm test:int` pass: tạo/đọc lịch mẫu.
- **Phụ thuộc:** 8a, 3b

#### Bước 13b — Dispatcher và Checker dùng lịch hiệu lực ✅
- ✅ đã làm (30/09/2026): Checker nạp lịch mẫu một lần mỗi lần gọi, đọc domain một lần mỗi job, tính `next_run_at` theo `resolveEffectiveSchedule` (Link > Domain > Mặc định); Dispatcher không cần đổi (chỉ lấy link đến hạn). AC-03 pass ở test int (Dispatcher mỗi 5 phút × 2 giờ, đếm giờ thứ hai: link theo domain 15 phút → 4 lần, link hàng tuần → 0). Đổi lịch → tính lại `next_run_at` ngay: Bước 20b.
- **File:** `services/dispatcher/src/handler.ts`, `services/checker/src/handler.ts` (tính `next_run_at` theo lịch hiệu lực).
- **FR/AC:** FR-13; **AC-03** (mô phỏng đồng hồ: chạy dispatcher mỗi 5 phút trong 1 giờ).
- **Xong khi:** `pnpm test:int` có `AC-03` pass.
- **Phụ thuộc:** 8c, 13a

#### Bước 20b — API Domain và Lịch ✅
- ✅ phần 1 (30/09/2026): `GET/POST /api/schedules`, `PATCH/DELETE /api/schedules/:id` (lịch `default` luôn có trong danh sách = FR-11, sửa lần đầu thì tạo; xóa `default` → 400; đang dùng → 409 `schedule_in_use` kèm `usedBy`), `GET/PATCH /api/domains/:name` (tên hiển thị, mô tả, người phụ trách, lịch, bật/tắt, cảnh báo chậm, bỏ qua 403 WAF), `PATCH /api/links/:id` nhận `scheduleId` (null = kế thừa). Mọi thay đổi lịch **tính lại `next_run_at` ngay** (`rescheduleLinks`) cho link bị ảnh hưởng (bỏ qua link tạm dừng). `LinkView` có `scheduleId`.
- ✅ phần 2 (30/09/2026): entity `DomainDayStat` (PK `DOMAIN#<tên>`, SK `DAY#<ngày>`, TTL 2 năm) — Checker cộng dồn cùng lúc với DayStat của link (+1 lượt ghi/check, xem Bước 35b); snapshot mang thêm uptime 7/30 ngày mỗi domain, tính lại tối đa mỗi giờ; `GET /api/domains` = `summarizeDomains` (số link theo trạng thái, tạm dừng, trạng thái FR-09, phản hồi trung bình, lần check gần nhất/kế tiếp, uptime 7/30, lịch hiệu lực + nguồn) từ snapshot → NFR-02 không quét bảng; `GET /api/domains/:name` thêm thanh uptime 30 ngày; PATCH trả chi tiết. Domain tắt (`enabled=false`): Checker không gọi HTTP, chỉ dời `next_run_at`.
- **File:** `src/routes/{domains,schedules}.ts`.
- **FR/AC:** FR-08, FR-10 (số link theo trạng thái, uptime 7/30 ngày từ DayStat, lần check gần nhất/kế tiếp), FR-11 → FR-13.
- **Xong khi:** test route pass; NFR-02: truy vấn tổng quan 500 domain dùng dữ liệu tổng hợp, không quét toàn bảng.
- **Phụ thuộc:** 8c, 9b, 18b

#### Bước 29 — SCR-06 Lịch ✅
- ✅ đã làm (30/09/2026): `/schedules/` — bảng lịch mẫu (lịch mặc định luôn đầu tiên, không xóa được), mô tả bằng chữ (`describeRule`), số domain/link đang dùng; hộp thoại tạo/sửa: tên, kiểu (Chu kỳ / Hàng ngày / Hàng tuần / Hàng tháng), chu kỳ 5 phút–12 giờ, giờ (giờ Việt Nam), chọn thứ, chọn ngày 1–31; xóa bấm 2 lần, đang dùng → thông báo lý do (409). Hộp thoại Sửa link có ô chọn lịch riêng hoặc "Kế thừa" (FR-13).
- **FR/AC:** FR-11, FR-12, FR-13. **Phụ thuộc:** 20b, 23b

#### Bước 25 — SCR-02 Domain (danh sách + `/domains/?d=`) ✅
- ✅ đã làm (30/09/2026): `/domains/` — bảng domain (trạng thái FR-09, số link theo trạng thái + tạm dừng, uptime 7/30, phản hồi TB, lần check gần nhất/kế tiếp, lịch hiệu lực + nguồn), tìm theo tên/tên hiển thị; `/domains/?d=` — chỉ số, thanh uptime 30 ngày, form cài đặt (tên hiển thị, mô tả, người phụ trách, lịch, bật/tắt theo dõi, email khi chậm, bỏ qua 403 WAF; chỉ gửi trường đổi), người nhận của domain (thêm/xóa, trùng → báo).
- **FR/AC:** FR-08, FR-10, FR-13 (lịch hiệu lực), FR-20 (người nhận domain), cờ bỏ qua 403 WAF, cờ cảnh báo chậm. **Phụ thuộc:** 4b, 20a, 20b, 23b

### Quản lý link đầy đủ

#### Bước 4b — Cờ "bỏ qua 403 WAF" theo domain ✅
- ✅ đã làm (30/09/2026): `classify(…, { ignoreWaf403 })` — 403 (ngoài danh sách mong đợi) thành Up/Chậm, giữ mã 403 + ghi chú "HTTP 403 ignored (domain WAF setting)", bỏ kiểm tra từ khóa; 404/401/5xx không đổi. Checker đọc `Domain.ignoreWaf403` một lần mỗi job. Bật/tắt cờ: API + SCR-02 (Bước 20b/25).
- **File:** `src/classify.ts`.
- **FR/AC:** cờ "bỏ qua 403 WAF" theo domain (SRS 3.4).
- **Xong khi:** test bảng 5.1 pass cả khi bật cờ (403 → không phải Link chết).
- **Phụ thuộc:** 4a

#### Bước 10b — Use case sửa, tạm dừng, xóa hàng loạt, nhập ✅
- ✅ đã làm (30/09/2026): `updateLink` (sửa một phần; đổi URL → chống trùng, về Pending, check lượt kế; URL sang domain chính khác → chuyển item sang partition domain mới trong 1 transaction, **giữ id** nên lịch sử/incident còn nguyên; link tạm dừng vẫn tạm dừng), `setPaused` (≤ 100 id; tạm dừng bỏ `next_run_at`, tiếp tục check lượt kế), `deleteLinks`, nhập: `parseImport` (CSV có dòng tiêu đề chứa `url` hoặc mỗi dòng 1 URL, ≤ 1.000 dòng, trùng trong file) + `previewImport` (trùng link đã có) + `commitImport` (**≤ 25 dòng/lần**, web gửi theo lô), `linksToCsv` (cột giống file nhập, chống chèn công thức). AC-01 pass ở mức usecase.
- **File:** `src/usecases/links.ts` (sửa; tạm dừng; xóa mềm hàng loạt), `src/usecases/import.ts` (xem trước CSV/dán ≤ 1.000 dòng: hợp lệ/trùng/lỗi; commit).
- **FR/AC:** FR-03, FR-04.
- **Xong khi:** `pnpm test:int` pass: nhập CSV có dòng trùng/lỗi, tạm dừng link thì Dispatcher bỏ qua.
- **Phụ thuộc:** 10a

#### Bước 19b — API sửa, tạm dừng, thao tác hàng loạt, tìm/lọc, nhập/xuất ✅
- ✅ đã làm (30/09/2026): `PATCH /api/links/:id`, `POST /api/links/bulk` `{action: pause|resume|delete, ids ≤ 100}`, `POST /api/links/import/preview` `{text}` + `POST /api/links/import` (≤ 25 dòng/lần, quá → 400 `import_too_large`), `GET /api/links/export.csv`, `POST /api/links/fresh` (≤ 100 khóa `{domain,id}` → dòng mới nhất, dùng để ghi đè snapshot), `GET /api/links/snapshot`. Snapshot: bucket S3 riêng `SnapshotBucket` (LinkWatch-Data, private, SSE, HTTPS-only), object `links/snapshot.json`; Dispatcher ghi lại sau mỗi lượt (lỗi snapshot không làm hỏng lượt), API chỉ đọc (chưa có → dựng tạm từ GSI3). Tìm/lọc theo domain/trạng thái/tag/lịch làm phía client trên snapshot (26b). Chỉ thêm 2 tài nguyên, không đổi logical ID.
- **Đã chốt 30/09/2026 — hướng 2 (snapshot):** danh sách link cho SCR-03 lấy từ một file snapshot JSON gọn (toàn bộ link, chỉ các cột hiển thị) ghi lại sau mỗi lượt Dispatcher (5 phút), đọc qua API có đăng nhập; web sort/lọc/phân trang phía client như hiện tại (giữ sort mọi cột, tổng số, số trang). Link đang được theo dõi (vừa Check now, vừa thêm/sửa, Pending/Suspect, trang chi tiết) đọc trực tiếp theo khóa và ghi đè lên dòng trong snapshot → luôn mới. Lý do: GSI3 chỉ 8 RCU, đọc toàn bộ 5.000 link mỗi lần tải sẽ bị throttle; hướng 1 (phân trang + FilterExpression trên DynamoDB) mất sort theo cột và tổng số. Snapshot là thành phần mới của kiến trúc (S3 + quyền IAM), đã được người dùng đồng ý.
- **File:** `src/routes/links.ts`, `src/routes/import.ts`.
- **FR/AC:** FR-03 → FR-06 (tìm, lọc domain/trạng thái/tag/lịch, CSV xuất).
- **Xong khi:** test route pass trên DynamoDB Local, gồm thao tác hàng loạt và export CSV.
- **Phụ thuộc:** 10b, 19a

#### Bước 26b — SCR-03 Danh sách link đầy đủ ✅
- ✅ đã làm (30/09/2026): dữ liệu = snapshot (tải lại 5 phút) + lớp ghi đè phía web (link vừa thêm/sửa/tạm dừng/xóa hiện ngay; link Pending/Suspect đọc lại bằng `/api/links/fresh` mỗi 30 giây; ghi đè cũ hơn snapshot tự bỏ); phân trang 25/50/100 (về trang 1 khi đổi lọc/sort, tự lùi khi trang không còn); lọc thêm domain, tag, Đang theo dõi/Tạm dừng (FR-06; lọc theo lịch làm cùng nhóm Lịch); chọn nhiều dòng (cả trang) → Tạm dừng / Tiếp tục / Check now / Xóa (bấm 2 lần); hộp thoại Sửa đủ trường FR-01 (mã HTTP dạng `200-399, 404`, gửi đúng các trường đổi); Export CSV.
- **FR/AC:** FR-04 (thao tác hàng loạt), FR-05, FR-06. **Phụ thuộc:** 19b, 26a

#### Bước 27 — SCR-04 Thêm/nhập link ✅
- ✅ đã làm (30/09/2026): thêm nhanh (URL + tên) giữ ở đầu trang, các thiết lập khác qua hộp thoại Sửa; **Import**: dán danh sách hoặc chọn file `.csv`/`.txt` → Preview (tổng hợp Hợp lệ/Trùng/Lỗi + bảng từng dòng, tối đa hiển thị 200 dòng) → Import N links: web chia lô 25 dòng (CSV giữ dòng tiêu đề), thanh tiến trình, lỗi giữa chừng báo số đã thêm; link mới đọc lại bằng `/api/links/fresh` để hiện ngay. Kết quả commit có thêm `domain`.
- **FR/AC:** FR-01, FR-02, FR-03 (bảng xem trước hợp lệ/trùng/lỗi). Test form dùng chung schema Zod. **Phụ thuộc:** 19b, 23b

### Sự cố, lịch sử, tổng quan

#### Bước 21 — API Sự cố, lịch sử check, Check now ✅
- ✅ đã làm (30/09/2026): `GET /api/incidents?state=active|closed` (active = Đang mở + Chờ xác minh, trả đủ; closed phân trang cursor, GSI2), `GET /api/incidents/:id` (kèm danh sách email đã gửi từ `MAIL#`), `POST /api/incidents/:id/ack` (người bấm = email Cognito, ghi chú; incident đã đóng → 409 `incident_closed`); `GET /api/links/:id`, `/:id/checks?limit≤100`, `/:id/uptime?days≤90` (từ `DAY#`, uptime = Up + Chậm), `/:id/incidents`; `POST /api/links/check-now` `{linkIds ≤ 100}` hoặc `{domain}` → job `check_now` vào hàng đợi ưu tiên (1 domain/job, ≤ 20 link), trả 202 `{queued, skipped, jobs}`; link tạm dừng/đã xóa bị bỏ qua. API local không có hàng đợi → 503 `check_now_unavailable`. Hạ tầng: API Lambda có `PRIORITY_QUEUE_URL` (lấy từ LinkWatch-Workers) + quyền `sqs:SendMessage`; không đổi logical ID. Id incident trong URL phải `encodeURIComponent`.
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

#### Bước 9c — ElectroDB: ResolveClaim, Token ✅
- ✅ đã làm (30/09/2026): `Token` (PK `TOKEN#<sha256>`, SK `META`, `incidentIds` (1 = nút từng link, nhiều = nút cả nhóm), `recipientEmail`, `ttl` 7 ngày), `Claim` (PK `INC#<incidentId>`, SK `CLAIM#<claimedAt>`, người bấm, kênh email/app, ghi chú, `outcome` pending/fixed/still_failing, `attempts`). Incident thêm `verifyingBy`, `verifyingClaimAt`, `closedBy`, `claimNote`.
- **File:** `src/db/entities/{claim,token}.ts` + int test.
- **FR/AC:** FR-34 (TTL 7 ngày).
- **Xong khi:** `pnpm test:int` pass: ghi token bản băm có `ttl`, ghi claim theo incident.
- **Phụ thuộc:** 9b, 7

#### Bước 15b — Nút "Đã khắc phục" và email "vẫn lỗi" ✅
- ✅ đã làm (30/09/2026): email Sự cố — mỗi link có nút "Fixed — check again" → `/confirm/?token=…` (token riêng từng người nhận), email gộp > 1 link có thêm nút cả nhóm + dòng giải thích; email Hồi phục ghi "Fixed by"; mẫu `StillFailingEmail` (tiêu đề `[LinkWatch][STILL FAILING] abc.com — 1 link still failing after your fix`, liệt kê 3 lần check, ghi rõ chỉ người bấm nhận).
- **File:** `src/{incident,verify-failed}.tsx`, test snapshot.
- **FR/AC:** FR-33 (nút cho từng link + nút cả nhóm), FR-38.
- **Xong khi:** test render pass; mỗi link có URL `/confirm/?token=…`.
- **Phụ thuộc:** 7, 15a

#### Bước 16b — Alert: tạo token cho từng người nhận ✅
- ✅ đã làm (30/09/2026): khi gửi email Sự cố, Alert tạo cho **mỗi người nhận** 1 token/link + 1 token nhóm (nếu > 1 link), lưu `Token` (chỉ hash, TTL 7 ngày) trước khi gửi. Nhánh verify-failed: Bước 17b.
- **File:** `services/alert/src/handler.ts` (thêm sự kiện verify-failed), tạo token cho từng người nhận.
- **FR/AC:** FR-33, FR-34.
- **Xong khi:** test int: email Sự cố chứa token hợp lệ, DB chỉ lưu bản băm.
- **Phụ thuộc:** 9c, 15b, 16a

#### Bước 17b — Email "vẫn lỗi" chỉ gửi người bấm ✅
- ✅ đã làm (30/09/2026): Streams MODIFY *Chờ xác minh* → *Đang mở* = `still_failing` → Alert gửi ngay (không gộp) `StillFailingEmail` tới `claim.byEmail`, log `MAIL#` `verify_failed`, đánh dấu `claim.notifiedAt` để không gửi trùng khi Streams gửi lại; email Hồi phục có "Fixed by" từ `incident.closedBy`. (Làm ở `handler`/`outbox`, không ở `reminder.ts` như plan ghi.)
- **File:** `services/alert/src/reminder.ts`, nhánh verify-failed chỉ gửi người bấm.
- **FR/AC:** FR-38; AC-10 phần email.
- **Xong khi:** test int: claim thất bại 3 lần → 1 email "vẫn lỗi" chỉ tới người bấm.
- **Phụ thuộc:** 16b

#### Bước 22 — API resolve-claim (công khai qua token + trong app) ✅
- ✅ phần a (30/09/2026): `submitClaim` (mỗi incident: `decideClaim` → tạo `Claim`, incident *Chờ xác minh* + `verifyingBy`, gửi 3 job `verify` có `DelaySeconds` 0/120/300), `readTokenClaim` (chỉ đọc — AC-11; token lạ/hết hạn → `expired`; mọi incident đã đóng → `recovered`), `submitTokenClaim` (người bấm = người nhận của token; token nhóm có thể chọn bớt incident), `applyVerification` (fixed / retry / still_failing → incident về *Đang mở* + `claimNote`). Checker: job `verify` đọc claim → `recordCheck(…, { verifiedBy })` đóng với `closedReason: verified_fix`, `closedBy`; sau đó `applyVerification`.
- ✅ phần b (30/09/2026): `GET /api/public/claims?token=` (chỉ đọc, `Cache-Control: no-store`, `X-Robots-Tag: noindex`), `POST /api/public/claims` `{token, note?, incidentIds?}`, `POST /api/incidents/resolve-claim` `{incidentIds ≤ 100, note?}` (JWT, kênh `app`); `GET /api/incidents/:id` có `claims` (dòng thời gian FR-41) và `closedBy`/`verifyingBy`/`claimNote`; `sendPriorityJob(job, delaySeconds)`. AC-11, AC-12, AC-13 pass ở test route.
- **File:** `src/routes/claims.ts`: `GET /public/claims?token=` (chỉ đọc), `POST /public/claims` (token), `POST /incidents/{id}/resolve-claim` (JWT, nhiều link), `GET` tiến độ xác minh; header chống cache.
- **FR/AC:** FR-34 → FR-37, FR-40, FR-41, FR-42; **AC-11** (GET không ghi gì), **AC-12**, **AC-13**.
- **Xong khi:** test route pass `AC-11`, `AC-12`, `AC-13`.
- **Phụ thuộc:** 7, 9c, 14, 18b

#### Bước 28 — SCR-05 Chi tiết link (`/links/detail/?id=`) ✅
- ✅ đã làm (30/09/2026, phần không phụ thuộc Bước 22): trạng thái, lần check gần nhất/kế tiếp, **Check now** (hỏi lại riêng link mỗi 3 giây, tối đa 60 giây, xong thì làm mới lịch sử), biểu đồ thời gian phản hồi 100 lần check (Recharts, điểm lỗi màu đỏ), thanh uptime 30 ngày (xanh 100%, vàng ≥ 95%, đỏ < 95%, xám không có check), bảng 100 lần check, danh sách sự cố. Bảng link có liên kết "Details". ✅ FR-41 (30/09/2026): nút "Fixed — check again" khi link có sự cố đang mở.
- **FR/AC:** FR-16, FR-17, FR-18 (Recharts thời gian phản hồi, thanh uptime 30 ngày, 100 check, sự cố), FR-41 (nút Đã khắc phục). **Phụ thuộc:** 21, 22, 23b

#### Bước 30 — SCR-07 Sự cố ✅
- ✅ đã làm (30/09/2026, phần không phụ thuộc Bước 22): `/incidents/` hai tab Đang mở / Đã đóng (Đã đóng có "Load more"), cột URL, loại, trạng thái (+ Acknowledged), mở lúc, thời lượng (đang mở = tính tới hiện tại), lỗi; `/incidents/?id=` (link trong email) — thông tin, link sang chi tiết link, Acknowledge + ghi chú (409 nếu đã đóng), bảng email đã gửi (người nhận, loại, trạng thái, lỗi). Tab Đang mở tự tải lại mỗi 60 giây. ✅ FR-41 (30/09/2026): tab Đang mở chọn nhiều sự cố `open` (sự cố đang `verifying` không chọn được) → "Fixed — check again" hàng loạt; trang chi tiết có nút + ghi chú, dòng thời gian claim (ai, kênh, ghi chú, kết quả, từng lần check), `claimNote` khi còn lỗi; đang xác minh thì ẩn nút và tự tải lại mỗi 5 giây.
- **FR/AC:** FR-19 (acknowledge, ghi chú), FR-41 (chọn nhiều link, dòng thời gian claim). **Phụ thuộc:** 21, 22, 23b

#### Bước 32 — SCR-10 Trang xác nhận (mobile, `/confirm/?token=`, không cần đăng nhập) ✅
- ✅ đã làm (30/09/2026): trang công khai (đã nằm trong `PUBLIC_PATHS` từ 23b), rộng tối đa 480 px; GET chỉ hiển thị URL, loại lỗi, mã HTTP, thời điểm (AC-11); ghi chú + nút "Confirm & check again" (POST); sau khi bấm hiện tiến độ 3 lần check, tự tải lại mỗi 3 giây tới khi xong (FR-39); kết quả Fixed (kèm "fixed by") / Still failing (chỉ báo người bấm, cho bấm lại) / Already back up (FR-42) / Link hết hạn (AC-12).
- **FR/AC:** FR-35 (GET chỉ hiển thị, nút POST), FR-39 (tự cập nhật mỗi 3 giây tới khi xong 3 lần), FR-42, AC-12 (trang hết hạn / "Đã hồi phục lúc …"). **Phụ thuộc:** 22, 23b

#### Bước 33 — Integration test luồng claim
- **File:** `tests/flows/resolve-claim.int.test.ts` (API + checker + alert gọi trực tiếp handler, DynamoDB Local, SQS/SES mock, đồng hồ giả).
- **FR/AC:** **AC-09**, **AC-10**, FR-37, FR-38, FR-42.
- **Xong khi:** `pnpm test:int` pass AC-09, AC-10. **Phụ thuộc:** 17b, 22

#### Bước 34 — Playwright E2E SCR-10
- **File:** `apps/web/e2e/confirm.spec.ts`, `playwright.config.ts` (chạy web + API local).
- **FR/AC:** AC-09 (UI ≤ 30 giây), **AC-11** (mở GET như bộ quét link → không có claim), AC-12, AC-13, NFR-10 (viewport mobile).
- **Xong khi:** `pnpm e2e` pass. **Phụ thuộc:** 32, 33

#### Bước 35b — Tối ưu sức chứa DynamoDB (mới, trước khi lên vài trăm link)
- **Phát hiện 30/09/2026, người dùng chọn làm sau:** bảng provisioned free tier (bảng 10R/15W, GSI1 5/8, GSI2 2/1, GSI3 8/1), cả 3 GSI chiếu `ALL` → mỗi lần sửa Link (Dispatcher giữ chỗ, Checker ghi kết quả) ghi thêm GSI1 và GSI3. Lượt 06:00 với 5.000 link cần ~22 WCU/s bảng, ~11 GSI1, ~11 GSI3 trong 15 phút (NFR-01) → GSI3 (1 WCU) mất ~3 giờ và throttle dội ngược bảng chính; nhập 1.000 link cũng chậm nhiều phút. Hiện 16 link → không ảnh hưởng.
- **Hướng đã cân nhắc:** (a) GSI mới chiếu `KEYS_ONLY` thay GSI3 (2 lần deploy: tạo GSI mới, chuyển code, xóa GSI3) + phân bổ lại 25 WCU + nới lượt 06:00 ra ~45–60 phút — chi phí 0; (b) chuyển on-demand — ~1–3 USD/tháng ở 5.000 link, đạt NFR-01.
- **Xong khi:** người dùng chọn (a) hoặc (b), `cdk synth` + test assertions pass, không đổi logical ID bảng.

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
| 2 Sự cố, email, Cognito | 5, 6, 8b, 9b, 12b, 14, 15a, 16a, 17a, 18b, 20a, 23b, 31a, 36b, 37b, 37c, 38b, 40b | khoảng 25–32 giờ |
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
