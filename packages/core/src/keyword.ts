const fold = (s: string) => s.normalize("NFC").toLocaleLowerCase("vi");

/**
 * FR-01: trang có chứa từ khóa bắt buộc không. Không phân biệt hoa/thường và cách mã hóa
 * Unicode (NFC/NFD) để người dùng không bị báo Link chết oan; vẫn phân biệt dấu tiếng Việt.
 */
export function containsKeyword(text: string, keyword: string): boolean {
	return fold(text).includes(fold(keyword));
}
