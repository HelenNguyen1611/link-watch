import { describe, expect, it } from "vitest";
import { formatDateTime, formatMs } from "./format";

describe("format", () => {
	it("NFR-10: thời gian hiển thị giờ Việt Nam dd/MM/yyyy HH:mm", () => {
		expect(formatDateTime("2026-09-29T23:01:00.000Z")).toBe("30/09/2026 06:01");
		expect(formatDateTime(undefined)).toBe("—");
	});

	it("NFR-10: số mili giây theo định dạng Việt Nam", () => {
		expect(formatMs(7200)).toBe("7.200 ms");
		expect(formatMs(undefined)).toBe("—");
	});
});
