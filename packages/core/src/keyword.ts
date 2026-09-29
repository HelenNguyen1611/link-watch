const fold = (s: string) => s.normalize("NFC").toLocaleLowerCase("vi");

/**
 * FR-01: whether the page contains the required keyword. Case-insensitive and independent of
 * Unicode normalization (NFC/NFD) so users are not wrongly told the link is dead; still distinguishes Vietnamese diacritics.
 */
export function containsKeyword(text: string, keyword: string): boolean {
	return fold(text).includes(fold(keyword));
}
