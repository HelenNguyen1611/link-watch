import { describe, expect, it } from "vitest";
import { CheckResult } from "./check";

describe("CheckResult", () => {
	it("FR-17: lưu thời điểm, mã HTTP, thời gian phản hồi, URL cuối, kết quả, hạn SSL", () => {
		const r = CheckResult.parse({
			linkId: "01JLINK",
			checkedAt: "2026-09-29T23:01:02.000Z",
			result: "up",
			httpCode: 200,
			responseMs: 321,
			finalUrl: "https://www.abc.com/",
			sslExpiresAt: "2027-01-01T00:00:00.000Z",
		});
		expect(r.result).toBe("up");
	});

	it("FR-17: kết quả lỗi có loại lỗi và thông điệp, không cần mã HTTP", () => {
		expect(
			CheckResult.safeParse({
				linkId: "01JLINK",
				checkedAt: "2026-09-29T23:01:02.000Z",
				result: "down",
				responseMs: 30000,
				errorType: "timeout",
				errorMessage: "ETIMEDOUT",
			}).success,
		).toBe(true);
	});

	it("FR-17: từ chối thời điểm không phải ISO 8601 UTC và loại lỗi lạ", () => {
		const base = { linkId: "x", result: "down", responseMs: 1 };
		expect(
			CheckResult.safeParse({ ...base, checkedAt: "29/09/2026" }).success,
		).toBe(false);
		expect(
			CheckResult.safeParse({
				...base,
				checkedAt: "2026-09-29T23:01:02.000Z",
				errorType: "lạ",
			}).success,
		).toBe(false);
	});
});
