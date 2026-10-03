# Tạo tài khoản admin trong Cognito

Hướng dẫn tạo thêm user có quyền **admin** cho LinkWatch bằng AWS CLI hoặc AWS Console.

## Cơ chế phân quyền (HLR-09, FR-29)

- User pool: `linkwatch-users` (stack `LinkWatch-Api`, region `ap-southeast-1`).
- Quyền là **Cognito group**, khai báo trong `infra/lib/api-stack.ts`:

  | Group    | Quyền                                                   |
  | -------- | ------------------------------------------------------- |
  | `admin`  | Toàn quyền: quản lý user, cấu hình email, lịch mặc định |
  | `editor` | Link, domain, lịch, người nhận; xử lý sự cố             |
  | `viewer` | Chỉ xem                                                 |

- User **không thuộc group nào → viewer**. Thuộc nhiều group → lấy quyền cao nhất (`packages/core/src/roles.ts`).
- Quyền đọc từ claim `cognito:groups` trong ID token → sau khi đổi group, user phải **đăng xuất và đăng nhập lại**.

Tạo admin = **tạo user** + **thêm user vào group `admin`**.

## Điều kiện trước

- AWS CLI đã cấu hình profile `linkwatch` (xem tên profile: `aws configure list-profiles`; nếu khác thì thay `linkwatch` trong các lệnh dưới).
- Commit có Cognito groups (`feat(infra): Cognito role groups …`) đã được deploy. Kiểm tra ở bước 1.

## Cách 1 — AWS CLI (khuyên dùng)

> Copy nguyên từng khối lệnh. Không rút gọn tham số bằng `...` — CLI sẽ báo `Unknown options: ...`.

### Bước 1. Lấy User Pool ID và kiểm tra group

```bash
POOL=$(aws cloudformation describe-stacks --stack-name LinkWatch-Api --region ap-southeast-1 --profile linkwatch \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)
echo $POOL
# → ap-southeast-1_XXXXXXXXX => ap-southeast-1_aRg2XEinV

aws cognito-idp list-groups --user-pool-id "$POOL" --region ap-southeast-1 --profile linkwatch \
  --query "Groups[].GroupName"
# → ["admin", "editor", "viewer"]
```

Nếu không thấy `admin`: bản có group chưa được deploy — push `main` và chờ workflow deploy xanh.

### Bước 2. Tạo user

Cognito gửi email mời kèm mật khẩu tạm (hết hạn sau 7 ngày):

```bash
EMAIL=nguoimoi@example.com
aws cognito-idp admin-create-user --user-pool-id "$POOL" --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL --region ap-southeast-1 --profile linkwatch
```

User đã tồn tại thì bỏ qua bước này (lỗi `UsernameExistsException`).

### Bước 3. Thêm vào group `admin`

```bash
aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" --username "$EMAIL" \
  --group-name admin --region ap-southeast-1 --profile linkwatch
```

### Bước 4. Kiểm tra

```bash
aws cognito-idp admin-list-groups-for-user --user-pool-id "$POOL" --username "$EMAIL" \
  --region ap-southeast-1 --profile linkwatch --query "Groups[].GroupName"
# → ["admin"]
```

### Bước 5. Đăng nhập lần đầu

Người dùng mở https://watch.hueai.net/login/, nhập email + mật khẩu tạm trong email mời, rồi đặt mật khẩu mới.

## Cách 2 — AWS Console

1. **Amazon Cognito** → region **Asia Pacific (Singapore) ap-southeast-1** → **User pools** → `linkwatch-users`.
2. Tab **Users** → **Create user**:
   - _Invitation message_: **Send an email invitation**.
   - _User name_ và _Email address_: email người dùng; tích **Mark email address as verified**.
   - _Temporary password_: **Generate a password** → **Create user**.
3. Tab **Groups** → `admin` → **Add user to group** → chọn user vừa tạo.

## Sau khi deploy group lần đầu — gán admin cho user cũ

Trước HLR-09, mọi user đăng nhập đều là Admin (FR-28). Sau khi deploy group, user cũ **không có group → chỉ còn viewer**. Gán lại admin (bỏ qua bước 2):

```bash
EMAIL=helen@wootech.co
aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" --username "$EMAIL" \
  --group-name admin --region ap-southeast-1 --profile linkwatch
```

Rồi đăng xuất, đăng nhập lại trên web.

## Thao tác khác

| Việc               | Lệnh (thêm `--user-pool-id "$POOL" --username "$EMAIL" --region ap-southeast-1 --profile linkwatch`) |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| Gửi lại email mời  | `aws cognito-idp admin-create-user --message-action RESEND`                                          |
| Hạ quyền admin     | `aws cognito-idp admin-remove-user-from-group --group-name admin`                                    |
| Khóa user          | `aws cognito-idp admin-disable-user`                                                                 |
| Mở khóa user       | `aws cognito-idp admin-enable-user`                                                                  |
| Xem thông tin user | `aws cognito-idp admin-get-user`                                                                     |

Luôn giữ **ít nhất một admin**. API cũng chặn admin tự hạ quyền/khóa/xóa chính mình và chặn xóa admin cuối cùng, nhưng CLI/Console thì không chặn.

## Xử lý sự cố

| Triệu chứng                                         | Nguyên nhân / cách xử lý                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `Unknown options: ...`                              | Lệnh còn chữ `...` rút gọn — dùng lệnh đầy đủ ở trên.                                 |
| `The config profile (linkwatch) could not be found` | Sai tên profile — `aws configure list-profiles`.                                      |
| `Stack with id LinkWatch-Api does not exist`        | Sai account/region, hoặc stack Api chưa deploy.                                       |
| `echo $POOL` rỗng hoặc `None`                       | Stack chưa có output `UserPoolId` (bản có Cognito chưa deploy).                       |
| `ResourceNotFoundException` khi add-to-group        | Group chưa tồn tại — deploy bản có Cognito groups.                                    |
| Không nhận được email mời                           | Kiểm tra Spam; Cognito email mặc định giới hạn ~50 email/ngày; gửi lại bằng `RESEND`. |
| Đã vào group nhưng web vẫn chỉ xem được             | Token cũ — đăng xuất rồi đăng nhập lại.                                               |
