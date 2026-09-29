/**
 * TẠM THỜI (Mốc 1, xóa ở Bước 18b khi có Cognito): header chứa khóa API dùng chung,
 * giá trị lưu ở SSM SecureString `/linkwatch/api-shared-secret`.
 */
export const API_KEY_HEADER = "x-linkwatch-key";
