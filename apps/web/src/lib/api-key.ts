/**
 * TẠM THỜI (Mốc 1, xóa ở Bước 23b khi có đăng nhập Cognito):
 * khóa API do người dùng nhập, lưu trong localStorage của trình duyệt.
 * Không nhúng khóa vào bundle vì file tĩnh trên CloudFront ai cũng tải được.
 */
const STORAGE_KEY = "linkwatch.apiKey";

const storage = () => {
	try {
		return typeof window === "undefined" ? null : window.localStorage;
	} catch {
		return null;
	}
};

export function getApiKey(): string | null {
	const v = storage()?.getItem(STORAGE_KEY)?.trim();
	return v ? v : null;
}

export function setApiKey(key: string): void {
	storage()?.setItem(STORAGE_KEY, key.trim());
}

export function clearApiKey(): void {
	storage()?.removeItem(STORAGE_KEY);
}
