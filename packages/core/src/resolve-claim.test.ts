import { describe, expect, it } from "vitest";
import {
	attemptEffect,
	CLAIM_COOLDOWN_MS,
	type ClaimState,
	claimProgress,
	decideClaim,
	VERIFY_DELAYS_S,
} from "./resolve-claim";
import { hashToken, isTokenExpired, newToken, tokenTtl } from "./token";

const NOW = new Date("2026-09-30T03:00:00.000Z");
const claim = (over: Partial<ClaimState> = {}): ClaimState => ({
	claimedAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
	outcome: "still_failing",
	attempts: [],
	...over,
});

describe("token — FR-34", () => {
	it("FR-34: ≥ 128 random bits, URL-safe, unique; only the hash is stored", () => {
		const a = newToken();
		const b = newToken();
		expect(a).not.toBe(b);
		expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes = 256 bits
		expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
		expect(hashToken(a)).not.toContain(a);
	});

	it("FR-34 / AC-12: expires after 7 days", () => {
		const ttl = tokenTtl(NOW);
		expect(isTokenExpired(ttl, new Date(NOW.getTime() + 6 * 86_400_000))).toBe(
			false,
		);
		expect(isTokenExpired(ttl, new Date(NOW.getTime() + 7 * 86_400_000))).toBe(
			true,
		);
	});
});

describe("decideClaim — FR-36, FR-40, FR-42", () => {
	it("FR-36: open incident, no claim → start 3 attempts (now, +2, +5 min)", () => {
		expect(decideClaim({ state: "open" }, undefined, NOW)).toEqual({
			kind: "start",
			delaysS: [0, 120, 300],
		});
		expect(VERIFY_DELAYS_S).toEqual([0, 120, 300]);
	});

	it("FR-42 / AC-12: already closed → recovered, with the time", () => {
		expect(
			decideClaim(
				{ state: "closed", closedAt: "2026-09-30T02:00:00.000Z" },
				undefined,
				NOW,
			),
		).toEqual({
			kind: "recovered",
			closedAt: "2026-09-30T02:00:00.000Z",
		});
	});

	it("AC-13: a verification running → only its progress (5 clicks = 1 verification)", () => {
		const running = claim({
			outcome: "pending",
			claimedAt: new Date(NOW.getTime() - 30_000).toISOString(),
		});
		for (let i = 0; i < 5; i++)
			expect(decideClaim({ state: "verifying" }, running, NOW).kind).toBe(
				"in_progress",
			);
	});

	it("FR-40: a finished claim less than 2 minutes ago still blocks a new one; after 2 minutes a new claim starts", () => {
		const recent = claim({
			outcome: "still_failing",
			claimedAt: new Date(
				NOW.getTime() - CLAIM_COOLDOWN_MS + 1000,
			).toISOString(),
		});
		expect(decideClaim({ state: "open" }, recent, NOW).kind).toBe(
			"in_progress",
		);
		expect(decideClaim({ state: "open" }, claim(), NOW).kind).toBe("start");
	});
});

describe("attemptEffect — FR-37, FR-38", () => {
	const pending = claim({ outcome: "pending" });
	it("FR-37: the first successful attempt fixes it (Slow counts as working)", () => {
		expect(attemptEffect(pending, 1, "up")).toEqual({ kind: "fixed" });
		expect(attemptEffect(pending, 2, "slow")).toEqual({ kind: "fixed" });
	});

	it("FR-38: failures retry until the 3rd attempt, then still failing", () => {
		expect(attemptEffect(pending, 1, "dead")).toEqual({ kind: "retry" });
		expect(attemptEffect(pending, 2, "down")).toEqual({ kind: "retry" });
		expect(attemptEffect(pending, 3, "dead")).toEqual({
			kind: "still_failing",
		});
	});

	it("FR-37: attempts after the claim is settled are ignored", () => {
		expect(attemptEffect(claim({ outcome: "fixed" }), 2, "dead")).toEqual({
			kind: "ignore",
		});
	});

	it("FR-39: progress for the confirmation page", () => {
		expect(claimProgress(pending)).toMatchObject({
			outcome: "pending",
			done: false,
			total: 3,
		});
	});
});
