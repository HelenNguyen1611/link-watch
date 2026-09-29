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

## 2. Khóa API tạm (Mốc 1) — trước lần push đầu có stack `LinkWatch-Api`

**TẠM THỜI:** xóa ở Bước 37b khi chuyển sang Cognito. CloudFormation không tạo được SecureString nên tạo bằng CLI:

```bash
aws ssm put-parameter --name /linkwatch/api-shared-secret --type SecureString \
  --value "$(openssl rand -base64 32)" --region ap-southeast-1 --profile linkwatch
```

- Chưa có tham số thì mọi request `/api/*` (trừ `/api/health`) trả 500; API không bao giờ mở toang.
- Xem khóa để nhập vào web (ô "Nhập khóa API"), chỉ lưu trên trình duyệt:
  `aws ssm get-parameter --name /linkwatch/api-shared-secret --with-decryption --query Parameter.Value --output text --region ap-southeast-1 --profile linkwatch`
- Đổi khóa: chạy lại `put-parameter` với `--overwrite`. Lambda đọc lại sau tối đa 5 phút, không cần deploy.

## 3. Giới hạn đồng thời của Checker

- Hạn mức concurrency Lambda của tài khoản **hiện là 10** (29/09/2026; đã/sẽ xin tăng lên 1000 trong Service Quotas → AWS Lambda → Concurrent executions).
- Checker được giới hạn **5 lần gọi đồng thời** bằng `maxConcurrency` trên event source SQS (`infra/lib/workers-stack.ts`, `CHECKER_MAX_CONCURRENCY`) để chừa suất cho API, Dispatcher và Lambda BucketDeployment. Không dùng reserved concurrency vì với hạn mức 10 thì deploy sẽ lỗi.
- Xem hạn mức: `aws lambda get-account-settings --region ap-southeast-1 --profile linkwatch` (`AccountLimit.ConcurrentExecutions`).
- Khi hạn mức ≥ 100: có thể tăng `CHECKER_MAX_CONCURRENCY` (NFR-06, chỉ đổi số rồi deploy) hoặc cân nhắc reserved concurrency cho Checker.
- Job lỗi 3 lần nằm ở DLQ (output `CheckDlqUrl` của `LinkWatch-Workers`); link tự được gửi lại sau 30 phút giữ chỗ.
