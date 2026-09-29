import { describe, expect, it } from "vitest";
import {
	applyJitter,
	computeNextRun,
	DEFAULT_SCHEDULE,
	JITTER_MAX_MS,
	nextRunAt,
} from "./schedule";

const utc = (s: string) => new Date(s);

describe("computeNextRun — lịch hàng ngày", () => {
	it("FR-11: lịch mặc định là 06:00 hàng ngày giờ Asia/Saigon", () => {
		expect(DEFAULT_SCHEDULE).toEqual({ kind: "daily", at: "06:00" });
	});

	it("FR-11: trước 06:00 → 06:00 cùng ngày (06:00 +07:00 = 23:00 UTC hôm trước)", () => {
		// 05:30 ngày 30/09 giờ VN
		expect(
			computeNextRun(
				DEFAULT_SCHEDULE,
				utc("2026-09-29T22:30:00Z"),
			).toISOString(),
		).toBe("2026-09-29T23:00:00.000Z");
	});

	it("FR-11: sau 06:00 → 06:00 ngày hôm sau (qua ngày)", () => {
		// 07:00 ngày 30/09 giờ VN
		expect(
			computeNextRun(
				DEFAULT_SCHEDULE,
				utc("2026-09-30T00:00:00Z"),
			).toISOString(),
		).toBe("2026-09-30T23:00:00.000Z");
	});

	it("FR-11: đúng 06:00 → lượt kế tiếp là ngày hôm sau (luôn sau thời điểm hiện tại)", () => {
		expect(
			computeNextRun(
				DEFAULT_SCHEDULE,
				utc("2026-09-29T23:00:00Z"),
			).toISOString(),
		).toBe("2026-09-30T23:00:00.000Z");
	});

	it("FR-11: qua tháng và qua năm", () => {
		// 23:59 ngày 30/09 giờ VN → 06:00 ngày 01/10
		expect(
			computeNextRun(
				DEFAULT_SCHEDULE,
				utc("2026-09-30T16:59:00Z"),
			).toISOString(),
		).toBe("2026-09-30T23:00:00.000Z");
		// 12:00 ngày 31/12 giờ VN → 06:00 ngày 01/01 năm sau
		expect(
			computeNextRun(
				DEFAULT_SCHEDULE,
				utc("2026-12-31T05:00:00Z"),
			).toISOString(),
		).toBe("2026-12-31T23:00:00.000Z");
	});

	it("FR-11: Admin đổi giờ mặc định (vd. 07:30) thì tính theo giờ mới", () => {
		expect(
			computeNextRun(
				{ kind: "daily", at: "07:30" },
				utc("2026-09-29T22:30:00Z"),
			).toISOString(),
		).toBe("2026-09-30T00:30:00.000Z");
	});

	it.each(["6:00", "24:00", "06:60", "0600", ""])(
		"FR-11: giờ không hợp lệ bị từ chối: %j",
		(at) => {
			expect(() => computeNextRun({ kind: "daily", at }, new Date())).toThrow();
		},
	);
});

describe("applyJitter", () => {
	const base = utc("2026-09-29T23:00:00Z");

	it("FR-14: lệch trong [0, 5 phút)", () => {
		for (let i = 0; i < 500; i++) {
			const d = applyJitter(base, `link_${i}`).getTime() - base.getTime();
			expect(d).toBeGreaterThanOrEqual(0);
			expect(d).toBeLessThan(JITTER_MAX_MS);
		}
		expect(JITTER_MAX_MS).toBe(5 * 60_000);
	});

	it("FR-14: cùng link id luôn cùng độ lệch (không đổi giữa các lượt)", () => {
		expect(applyJitter(base, "abc").getTime()).toBe(
			applyJitter(base, "abc").getTime(),
		);
		const other = utc("2026-10-05T23:00:00Z");
		expect(applyJitter(other, "abc").getTime() - other.getTime()).toBe(
			applyJitter(base, "abc").getTime() - base.getTime(),
		);
	});

	it("FR-14: dàn đều các link cùng mốc giờ (mỗi phút trong 5 phút có 15–25% số link)", () => {
		const buckets = [0, 0, 0, 0, 0];
		const n = 5000;
		for (let i = 0; i < n; i++) {
			const d =
				applyJitter(base, `01J${i.toString(36).padStart(8, "0")}`).getTime() -
				base.getTime();
			buckets[Math.floor(d / 60_000)]++;
		}
		for (const b of buckets) {
			expect(b / n).toBeGreaterThan(0.15);
			expect(b / n).toBeLessThan(0.25);
		}
	});
});

describe("nextRunAt", () => {
	it("AC-02: link không có lịch riêng, domain không có lịch riêng → lượt kế tiếp trong 06:00–06:05", () => {
		// Dispatcher chạy mỗi 5 phút nên link được lấy ra trước 06:10, Checker xong trước 06:15.
		const now = utc("2026-09-29T10:00:00Z"); // 17:00 giờ VN
		for (const id of ["a", "b", "c", "01JABCDEF", "link-9999"]) {
			const t = nextRunAt(DEFAULT_SCHEDULE, id, now).getTime();
			const six = utc("2026-09-29T23:00:00Z").getTime();
			expect(t).toBeGreaterThanOrEqual(six);
			expect(t).toBeLessThan(six + JITTER_MAX_MS);
		}
	});

	it("AC-02: link vừa check lúc 06:03 (đã có jitter) → lượt kế tiếp là sáng hôm sau", () => {
		const checkedAt = utc("2026-09-29T23:03:00Z");
		const t = nextRunAt(DEFAULT_SCHEDULE, "a", checkedAt);
		expect(t.getTime()).toBeGreaterThanOrEqual(
			utc("2026-09-30T23:00:00Z").getTime(),
		);
		expect(t.getTime()).toBeLessThan(utc("2026-09-30T23:05:00Z").getTime());
	});
});
