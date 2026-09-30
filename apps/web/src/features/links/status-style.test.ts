import { LinkStatus } from "@linkwatch/core";
import { describe, expect, it } from "vitest";
import { COLOR } from "@/lib/colors";
import {
	httpCodeColor,
	responseTimeColor,
	STATUS_BY_SEVERITY,
	STATUS_STYLE,
} from "./status-style";

describe("status colours", () => {
	it("SRS 5.1: each status has a colour and icon matching its meaning", () => {
		expect(STATUS_STYLE.up).toMatchObject({
			color: COLOR.success,
			icon: "circle-check",
		});
		expect(STATUS_STYLE.slow).toMatchObject({
			color: "yellow.8",
			icon: "clock",
		});
		expect(STATUS_STYLE.dead).toMatchObject({
			color: "orange.7",
			icon: "unlink",
		});
		expect(STATUS_STYLE.down).toMatchObject({
			color: COLOR.danger,
			icon: "circle-x",
		});
		expect(STATUS_STYLE.pending).toMatchObject({
			color: "gray.6",
			icon: "hourglass",
		});
		expect(STATUS_STYLE.suspect).toMatchObject({
			color: "grape.7",
			icon: "help",
		});
	});

	it("success and outage use the shared site-wide variables, not raw shades", () => {
		expect(STATUS_STYLE.up.color).toBe("var(--lw-color-success)");
		expect(STATUS_STYLE.down.color).toBe("var(--lw-color-danger)");
		expect(httpCodeColor(500)).toBe("var(--lw-color-danger)");
	});

	it("HTTP code: 2xx/3xx neutral, 4xx orange, 5xx red, none neutral", () => {
		expect(httpCodeColor(200)).toBeUndefined();
		expect(httpCodeColor(301)).toBeUndefined();
		expect(httpCodeColor(404)).toBe("orange.7");
		expect(httpCodeColor(503)).toBe(COLOR.danger);
		expect(httpCodeColor(undefined)).toBeUndefined();
	});

	it("response time is highlighted only when the link is Slow", () => {
		expect(responseTimeColor("slow")).toBe("yellow.8");
		expect(responseTimeColor("up")).toBeUndefined();
	});

	it("FR-09: severity order lists every status once, worst first", () => {
		expect(STATUS_BY_SEVERITY).toEqual([
			"down",
			"dead",
			"suspect",
			"slow",
			"up",
			"pending",
		]);
		expect([...STATUS_BY_SEVERITY].sort()).toEqual(
			[...LinkStatus.options].sort(),
		);
	});
});
