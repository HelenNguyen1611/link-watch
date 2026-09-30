import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { describeRule } from "./describe";

const t = i18n.t.bind(i18n) as (
	k: string,
	o?: Record<string, unknown>,
) => string;

describe("describeRule — FR-12", () => {
	it("FR-12: intervals in minutes or hours", () => {
		expect(describeRule({ kind: "interval", minutes: 15 }, t)).toBe(
			"Every 15 minutes",
		);
		expect(describeRule({ kind: "interval", minutes: 60 }, t)).toBe(
			"Every hour",
		);
		expect(describeRule({ kind: "interval", minutes: 360 }, t)).toBe(
			"Every 6 hours",
		);
	});

	it("FR-12: fixed times", () => {
		expect(describeRule({ kind: "daily", at: "06:00" }, t)).toBe(
			"Daily at 06:00",
		);
		expect(describeRule({ kind: "weekly", days: [1, 5], at: "07:00" }, t)).toBe(
			"Mon, Fri at 07:00",
		);
		expect(
			describeRule(
				{ kind: "weekly", days: [1, 2, 3, 4, 5, 6, 7], at: "07:00" },
				t,
			),
		).toBe("Daily at 07:00");
		expect(
			describeRule({ kind: "monthly", days: [1, 15, 31], at: "09:00" }, t),
		).toBe("Days 1, 15, 31 of the month at 09:00");
	});
});
