import { describe, expect, it } from "vitest";
import { CheckResult } from "./check";

describe("CheckResult", () => {
	it("FR-17: stores time, HTTP status, response time, final URL, result, SSL expiry", () => {
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

	it("FR-17: an error result has an error type and message, no HTTP status required", () => {
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

	it("FR-17: rejects non-ISO-8601-UTC timestamps and unknown error types", () => {
		const base = { linkId: "x", result: "down", responseMs: 1 };
		expect(
			CheckResult.safeParse({ ...base, checkedAt: "29/09/2026" }).success,
		).toBe(false);
		expect(
			CheckResult.safeParse({
				...base,
				checkedAt: "2026-09-29T23:01:02.000Z",
				errorType: "unknown-type",
			}).success,
		).toBe(false);
	});
});
