const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32

/** Id dạng ULID (26 ký tự): 10 ký tự thời gian + 16 ký tự ngẫu nhiên → sắp theo thời gian tạo. */
export function newId(now: Date = new Date()): string {
	let time = now.getTime();
	let head = "";
	for (let i = 0; i < 10; i++) {
		head = ALPHABET[time % 32] + head;
		time = Math.floor(time / 32);
	}
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	let tail = "";
	for (const b of bytes) tail += ALPHABET[b % 32];
	return head + tail;
}
