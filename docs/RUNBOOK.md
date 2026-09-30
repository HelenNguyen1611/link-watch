# LinkWatch — Runbook vận hành

Các việc làm tay trên AWS Console/CLI mà CDK không làm được hoặc không quản lý. Làm theo thứ tự khi tới bước tương ứng trong `docs/PLAN.md`.

## 1. Cảnh báo chi phí (Budget) — quản lý thủ công, không nằm trong CDK

- Tài khoản `131746731277` đã có budget **"My Zero-Spend Budget"**, tạo thủ công trên Console, cảnh báo khi chi phí > 0,01 USD.
- CDK **không** tạo và không sửa Budget. Muốn đổi ngưỡng hoặc email nhận cảnh báo: Billing and Cost Management → Budgets.

### Tùy chọn: bật quyền IAM xem Billing

Chỉ cần nếu muốn user IAM `helen` (không phải root) xem được Billing/Budgets. **Deploy không cần bước này.**

1. Đăng nhập **tài khoản root**.
2. Menu tài khoản (góc phải) → **Account**.
3. Mục **IAM user and role access to Billing information** → **Edit** → tick **Activate IAM Access** → **Update**.
4. User IAM còn cần quyền Billing trong policy của mình (vd. `AWSBillingReadOnlyAccess`).

## 2. Đăng nhập Cognito (Mốc 2) — ngay sau lần push đầu có Cognito

Từ Bước 18b/37b, web và API dùng Cognito; header tạm `x-linkwatch-key` đã bị xóa. Từ Bước 23b, web có trang đăng nhập `/login/` (email + mật khẩu, đặt mật khẩu mới lần đầu, quên mật khẩu). Sau khi workflow deploy xanh, web **bắt buộc đăng nhập** và chưa có ai đăng nhập được cho tới khi tạo user.

1. Lấy User Pool ID (output `UserPoolId` của `LinkWatch-Api`):

   ```bash
   POOL=$(aws cloudformation describe-stacks --stack-name LinkWatch-Api --region ap-southeast-1 --profile linkwatch \
     --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)
   ```

2. Tạo user (Admin — mọi user đăng nhập đều là Admin ở MVP, FR-28). Cognito gửi email mời kèm mật khẩu tạm (hết hạn sau 7 ngày):

   ```bash
   aws cognito-idp admin-create-user --user-pool-id "$POOL" --username helen@wootech.co \
     --user-attributes Name=email,Value=helen@wootech.co Name=email_verified,Value=true \
     --desired-delivery-mediums EMAIL --region ap-southeast-1 --profile linkwatch
   ```

   Lần đăng nhập đầu, web yêu cầu đặt mật khẩu mới (≥ 12 ký tự, có chữ hoa, chữ thường, số): người dùng mở email mời "Your temporary password", vào https://watch.hueai.net/login/, đăng nhập bằng mật khẩu tạm → màn "Set a new password" → đặt mật khẩu mới là vào thẳng app. Phiên giữ tới 30 ngày (refresh token); nút **Sign out** ở góc phải header.
3. User cho smoke test: tạo không gửi email mời, rồi đặt mật khẩu cố định:

   ```bash
   aws cognito-idp admin-create-user --user-pool-id "$POOL" --username smoke@watch.hueai.net \
     --user-attributes Name=email,Value=smoke@watch.hueai.net Name=email_verified,Value=true \
     --message-action SUPPRESS --region ap-southeast-1 --profile linkwatch
   aws cognito-idp admin-set-user-password --user-pool-id "$POOL" --username smoke@watch.hueai.net \
     --password '<mật khẩu>' --permanent --region ap-southeast-1 --profile linkwatch
   ```

4. Quên mật khẩu: nút "Forgot password?" trên trang đăng nhập (email do Cognito gửi, giới hạn 50 email/ngày của Cognito mặc định). Khóa một user: `admin-disable-user`.
5. **Xóa tham số SSM của header tạm** (không còn Lambda nào đọc):

   ```bash
   aws ssm delete-parameter --name /linkwatch/api-shared-secret --region ap-southeast-1 --profile linkwatch
   ```

   Web còn giữ khóa cũ trong `localStorage` của trình duyệt cũng không sao — không còn được gửi đi.

## 2a. Email qua SES — sandbox

- Identity `watch.hueai.net` (DKIM, MAIL FROM `mail.watch.hueai.net`) tạo tay; CDK chỉ cấp quyền `ses:SendEmail` (điều kiện From thuộc `watch.hueai.net`). Địa chỉ gửi mặc định `noreply@watch.hueai.net`, đổi được ở màn Settings → Email.
- **Khi tài khoản còn trong sandbox, SES chỉ gửi được tới địa chỉ đã xác thực.** Mỗi người nhận (kể cả email admin mặc định `helen@wootech.co`) phải xác thực một lần:

  ```bash
  aws sesv2 create-email-identity --email-identity helen@wootech.co --region ap-southeast-1 --profile linkwatch
  ```

  Người nhận bấm link trong email "Amazon Web Services – Email Address Verification Request". Kiểm tra: `aws sesv2 get-email-identity --email-identity helen@wootech.co …` → `VerifiedForSendingStatus: true`.
- Gửi tới địa chỉ chưa xác thực: SES trả `MessageRejected`; LinkWatch ghi `MAIL#` với `status = failed` (không retry, FR-25). Màn Settings → "Send test email" hiện lỗi này.
- Thoát sandbox (khi có người nhận ngoài công ty): SES → Account dashboard → Request production access.

## 3. Giới hạn đồng thời của Checker

- Hạn mức concurrency Lambda của tài khoản **hiện là 10** (29/09/2026; đã/sẽ xin tăng lên 1000 trong Service Quotas → AWS Lambda → Concurrent executions).
- Checker được giới hạn **5 lần gọi đồng thời** bằng `maxConcurrency` trên event source SQS (`infra/lib/workers-stack.ts`, `CHECKER_MAX_CONCURRENCY`) để chừa suất cho API, Dispatcher và Lambda BucketDeployment. Không dùng reserved concurrency vì với hạn mức 10 thì deploy sẽ lỗi.
- Xem hạn mức: `aws lambda get-account-settings --region ap-southeast-1 --profile linkwatch` (`AccountLimit.ConcurrentExecutions`).
- Khi hạn mức ≥ 100: có thể tăng `CHECKER_MAX_CONCURRENCY` (NFR-06, chỉ đổi số rồi deploy) hoặc cân nhắc reserved concurrency cho Checker.
- Job lỗi 3 lần nằm ở DLQ (output `CheckDlqUrl` của `LinkWatch-Workers`); link tự được gửi lại sau 30 phút giữ chỗ.
- Mốc 2 thêm: recheck trên hàng đợi ưu tiên (Checker, tối đa 2 đồng thời), Alert (Streams 1/shard + hàng đợi alert tối đa 2). Lúc cao điểm tổng có thể vượt hạn mức 10 → Lambda bị throttle, SQS/Streams tự thử lại (không mất việc), API có thể trả 429 trong chốc lát. Nên xin tăng hạn mức.

### Xử lý DLQ (3 hàng đợi)

| Output của `LinkWatch-Workers` | Chứa gì | Hậu quả nếu bỏ mặc | Xử lý |
| --- | --- | --- | --- |
| `CheckDlqUrl` (FIFO) | job check theo lịch lỗi 3 lần | không có — link được gửi lại sau 30 phút giữ chỗ | xem log Checker, rồi purge |
| `PriorityDlqUrl` | recheck 2/10 phút lỗi 3 lần | không có — Dispatcher chạy dự phòng qua `next_run_at` (+5 phút) | xem log Checker, rồi purge |
| `AlertDlqUrl` | message flush lỗi 3 lần, hoặc bản ghi Streams lỗi sau 5 lần thử (chỉ chứa metadata shard/sequence) | **email Sự cố/Hồi phục của domain đó không được gửi** | sửa nguyên nhân (log Alert), rồi gửi lại message flush (xem dưới) |

- Xem số message: `aws sqs get-queue-attributes --queue-url <url> --attribute-names ApproximateNumberOfMessages …`.
- Gửi lại message flush từ `AlertDlq` về hàng đợi alert: SQS Console → AlertDlq → **Start DLQ redrive** (về source queue). Bản ghi lỗi của Streams không redrive được: sự kiện vẫn nằm trong `OUTBOX#<domain>#<kind>`; gửi tay một message `{"kind":"flush","domain":"<domain>","notification":"down"}` vào hàng đợi alert.
- Purge: `aws sqs purge-queue --queue-url <url> …`.

## 4. Smoke test sau khi deploy (Bước 40a, 40b)

Chạy sau mỗi lần push `main` khi workflow deploy đã xanh, bằng credentials AWS của bạn (`scripts/smoke.ts`, `scripts/smoke-incident.ts`).

**Chuẩn bị một lần:** tạo user Cognito cho smoke test với mật khẩu cố định (mục 2, bước 3) và xác thực người nhận trong SES (mục 2a).

```bash
AWS_PROFILE=linkwatch SMOKE_EMAIL=smoke@watch.hueai.net SMOKE_PASSWORD='<mật khẩu>' pnpm smoke
```

Phần Mốc 1 (~10–15 phút):

1. `GET /api/health` → 200; `GET /api/links` không có token → 401.
2. Bước 37c: `DELETE /api/links/<không có>` → 404 JSON `{"error":"not_found"}` (không bị CloudFront đổi thành trang HTML); một trang web không tồn tại vẫn ra trang 404 (HTML).
3. Tạo 4 link mẫu (tag `smoke`, query `?linkwatch-smoke=<run>`): `example.com` → Hoạt động, `httpbin.org/delay/7` → Chậm, `httpbin.org/status/404` → Link chết, `linkwatch-smoke-nx.example.com` → Site down. Link lỗi ở lần check đầu là **Nghi ngờ** (Suspect), 2 phút sau check lại mới thành Link chết/Site down (SRS 5.2), nên script chờ tới khi không còn link Pending/Suspect (tối đa 15 phút) rồi so trạng thái; luôn xóa link mẫu.

Phần Mốc 2 (~20–35 phút, bỏ qua bằng `SMOKE_SKIP_INCIDENT=1`):

4. Thêm người nhận `SMOKE_RECIPIENT` (mặc định `helen@wootech.co`) cho domain `hueai.net`.
5. Thêm link `https://watch.hueai.net/smoke/<run>.txt` — file không có trong bucket nên CloudFront/S3 trả 403 → Link chết.
6. Chờ incident mở sau lần check lỗi thứ 2 (≤ 15 phút), rồi chờ `MAIL#` loại `down` tới người nhận ở trạng thái `sent` trong ≤ 5 phút (+1 phút dư) kể từ lúc mở (AC-04).
7. Upload file đó lên bucket web → link trả 200 → chờ incident đóng và email `recovery` `sent` (AC-07).
8. Luôn dọn: xóa file trong bucket, xóa link, xóa người nhận nếu do smoke tạo. Kiểm tra hộp thư: có 2 email `[LinkWatch][DOWN] hueai.net — 1 broken link` và `[LinkWatch][RECOVERED] …`.

- Biến tùy chọn: `SMOKE_BASE_URL` (mặc định `https://watch.hueai.net`), `SMOKE_TIMEOUT_MS` (phần Mốc 1, mặc định 900000), `SMOKE_RECIPIENT`, `SMOKE_SKIP_INCIDENT=1`.
- Quyền IAM cần: `cloudformation:DescribeStacks`, `cloudformation:DescribeStackResource`, `cognito-idp:AdminInitiateAuth`, `ssm:GetParameter` (`/linkwatch/table-name`), đọc DynamoDB, `s3:PutObject`/`s3:DeleteObject` trên bucket web.
- Mã thoát: 0 = pass, 1 = fail, 2 = thiếu `SMOKE_EMAIL`/`SMOKE_PASSWORD`.
- Fail ở "incident email": xem log Lambda Alert, `AlertDlqUrl`, và `MAIL#` (`status = failed` + `error`, thường là người nhận chưa xác thực trong sandbox). Fail ở "incident opened": xem log Checker/Dispatcher và `PriorityDlqUrl`.
