# LinkWatch — Runbook vận hành

Các việc làm tay trên AWS Console/CLI mà CDK không làm được. Làm theo thứ tự khi tới bước tương ứng trong `docs/PLAN.md`.

## 1. Bật quyền IAM xem Billing (trước Bước 38a — Budgets)

AWS Budgets tạo qua CloudFormation bằng role của CDK sẽ bị từ chối nếu tài khoản chưa cho IAM truy cập Billing.

1. Đăng nhập **tài khoản root** (không dùng IAM user/SSO).
2. Mở menu tài khoản (góc phải) → **Account**.
3. Mục **IAM user and role access to Billing information** → **Edit** → tick **Activate IAM Access** → **Update**.
4. Kiểm tra: đăng nhập lại bằng profile thường, mở Billing and Cost Management → Budgets, không còn báo thiếu quyền.

Chỉ cần làm một lần cho tài khoản `131746731277`.
