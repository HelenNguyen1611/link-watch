import type { LinkStatus } from "@linkwatch/core";
import { describe, expect, it } from "vitest";
import { FAST_REFRESH_MS, refreshInterval, SLOW_REFRESH_MS } from "./refresh";

const l = (status: LinkStatus, paused = false) => ({ status, paused });

describe("refreshInterval — adaptive links refresh", () => {
	it("FR-17: a new (pending) link → every 30 seconds until its first result", () => {
		expect(refreshInterval([l("up"), l("pending")])).toBe(FAST_REFRESH_MS);
	});

	it("5.2: a suspect link (recheck in 2 minutes) → every 30 seconds", () => {
		expect(refreshInterval([l("suspect")])).toBe(FAST_REFRESH_MS);
	});

	it("every result settled (up/slow/dead/down) → every 5 minutes", () => {
		expect(refreshInterval([l("up"), l("slow"), l("dead"), l("down")])).toBe(
			SLOW_REFRESH_MS,
		);
		expect(refreshInterval([])).toBe(SLOW_REFRESH_MS);
	});

	it("FR-04: paused links are not checked, so they never keep the fast rate", () => {
		expect(refreshInterval([l("pending", true), l("up")])).toBe(
			SLOW_REFRESH_MS,
		);
	});

	it("no data yet (first load or error) → fast", () => {
		expect(refreshInterval(undefined)).toBe(FAST_REFRESH_MS);
	});
});
