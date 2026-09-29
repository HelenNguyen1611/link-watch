import { describe, expect, it } from "vitest";
import { formatDateTime, formatMs } from "./format";

describe("format", () => {
	it("NFR-10: times shown in Vietnam time as dd/MM/yyyy HH:mm", () => {
		expect(formatDateTime("2026-09-29T23:01:00.000Z")).toBe("30/09/2026 06:01");
		expect(formatDateTime(undefined)).toBe("—");
	});

	it("NFR-10: milliseconds formatted with thousands separators", () => {
		expect(formatMs(7200)).toBe("7,200 ms");
		expect(formatMs(undefined)).toBe("—");
	});
});
