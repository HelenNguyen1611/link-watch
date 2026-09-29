import { describe, expect, it } from "vitest";
import { aggregateDomainStatus } from "./domain-status";
import type { LinkStatus } from "./schema/enums";

const links = (...statuses: LinkStatus[]) =>
	statuses.map((status) => ({ status, paused: false }));

describe("aggregateDomainStatus — FR-09", () => {
	it("FR-09: any Site down link → down, even alongside dead links", () => {
		expect(aggregateDomainStatus(links("up", "down", "dead"))).toBe("down");
	});

	it("FR-09: a dead link without Site down → error", () => {
		expect(aggregateDomainStatus(links("up", "slow", "dead"))).toBe("error");
	});

	it("FR-09: only slow links as problems → warning", () => {
		expect(aggregateDomainStatus(links("up", "slow"))).toBe("warning");
	});

	it("FR-09: all up → normal", () => {
		expect(aggregateDomainStatus(links("up", "up"))).toBe("normal");
	});

	it("FR-09: suspect and pending are unconfirmed and count as normal", () => {
		expect(aggregateDomainStatus(links("up", "suspect", "pending"))).toBe(
			"normal",
		);
	});

	it("FR-09: a domain without links → normal", () => {
		expect(aggregateDomainStatus([])).toBe("normal");
	});

	it("FR-04: paused links are ignored", () => {
		expect(
			aggregateDomainStatus([
				{ status: "up", paused: false },
				{ status: "dead", paused: true },
			]),
		).toBe("normal");
	});
});
