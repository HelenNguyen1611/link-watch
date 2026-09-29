import { describe, expect, it } from "vitest";
import { newId } from "./id";

describe("newId", () => {
	it("26 ký tự Crockford base32, sắp theo thời gian tạo", () => {
		const a = newId(new Date("2026-09-29T00:00:00.000Z"));
		const b = newId(new Date("2026-09-29T00:00:00.001Z"));
		expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(a < b).toBe(true);
	});

	it("không trùng khi tạo nhiều id cùng mili giây", () => {
		const now = new Date();
		const ids = new Set(Array.from({ length: 1000 }, () => newId(now)));
		expect(ids.size).toBe(1000);
	});
});
