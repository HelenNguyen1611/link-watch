import { describe, expect, it } from "vitest";
import type { ClassifiedCheck } from "./classify";
import {
	type ActiveIncident,
	type EvaluateContext,
	evaluateCheck,
	type LinkCheckState,
} from "./incident";
import { DEFAULT_SCHEDULE, nextRunAt, type Schedule } from "./schedule";
import type { CheckResultKind } from "./schema/enums";

const LINK_ID = "01J0000000000000000000TEST";
const MIN = 60_000;

const check = (result: CheckResultKind): ClassifiedCheck => ({
	result,
	responseMs: 120,
	httpCode: result === "dead" ? 404 : result === "down" ? 503 : 200,
});

const ctxAt = (iso: string, schedule: Schedule = DEFAULT_SCHEDULE) =>
	({ now: new Date(iso), schedule, linkId: LINK_ID }) satisfies EvaluateContext;

const state = (partial: Partial<LinkCheckState> = {}): LinkCheckState => ({
	status: "up",
	paused: false,
	...partial,
});

// 06:04 on 30/09, Vietnam time
const OPENED_AT = "2026-09-29T23:04:00.000Z";
const incident = (partial: Partial<ActiveIncident> = {}): ActiveIncident => ({
	openedAt: OPENED_AT,
	type: "dead",
	state: "open",
	...partial,
});

describe("evaluateCheck — SRS 5.2 incident confirmation", () => {
	it("5.2: first failure → suspect, recheck after 2 minutes, no incident", () => {
		const ctx = ctxAt("2026-09-29T23:02:00.000Z");
		const r = evaluateCheck(state(), check("dead"), ctx);
		expect(r.status).toBe("suspect");
		expect(r.action).toEqual({ kind: "none" });
		expect(r.nextRunAt?.toISOString()).toBe("2026-09-29T23:04:00.000Z");
	});

	it("5.2: first failure of a never-checked (pending) link → suspect", () => {
		const r = evaluateCheck(
			state({ status: "pending" }),
			check("down"),
			ctxAt("2026-09-29T23:02:00.000Z"),
		);
		expect(r.status).toBe("suspect");
		expect(r.action).toEqual({ kind: "none" });
	});

	it("5.2: second consecutive failure → opens an incident of the result type, recheck after 10 minutes", () => {
		const r = evaluateCheck(
			state({ status: "suspect" }),
			check("dead"),
			ctxAt(OPENED_AT),
		);
		expect(r.status).toBe("dead");
		expect(r.action).toEqual({
			kind: "open",
			type: "dead",
			openedAt: OPENED_AT,
		});
		expect(r.nextRunAt?.toISOString()).toBe("2026-09-29T23:14:00.000Z");
	});

	it("5.2: a Site down second failure opens a down incident", () => {
		const r = evaluateCheck(
			state({ status: "suspect" }),
			check("down"),
			ctxAt(OPENED_AT),
		);
		expect(r.action).toMatchObject({ kind: "open", type: "down" });
	});

	it("AC-05: one failure then OK on the recheck does not open an incident", () => {
		const first = evaluateCheck(
			state(),
			check("dead"),
			ctxAt("2026-09-29T23:02:00.000Z"),
		);
		const ctx = ctxAt("2026-09-29T23:04:00.000Z");
		const second = evaluateCheck(
			state({ status: first.status }),
			check("up"),
			ctx,
		);
		expect(second.status).toBe("up");
		expect(second.action).toEqual({ kind: "none" });
		expect(second.nextRunAt).toEqual(
			nextRunAt(DEFAULT_SCHEDULE, LINK_ID, ctx.now),
		);
	});

	it("5.1: Slow is not a failure and never makes a link suspect", () => {
		const ctx = ctxAt("2026-09-29T23:02:00.000Z");
		const r = evaluateCheck(state(), check("slow"), ctx);
		expect(r.status).toBe("slow");
		expect(r.action).toEqual({ kind: "none" });
		expect(r.nextRunAt).toEqual(nextRunAt(DEFAULT_SCHEDULE, LINK_ID, ctx.now));
	});

	it("5.2: while the incident is open, rechecks every 10 minutes during the first hour", () => {
		// 06:54, open for 50 minutes
		const r = evaluateCheck(
			state({ status: "dead", openIncident: incident() }),
			check("dead"),
			ctxAt("2026-09-29T23:54:00.000Z"),
		);
		expect(r.status).toBe("dead");
		expect(r.action).toEqual({ kind: "none" });
		expect(r.nextRunAt?.toISOString()).toBe("2026-09-30T00:04:00.000Z");
	});

	it("5.2: after the first hour, checks hourly when the regular schedule is sparser", () => {
		// 07:04, open for exactly 1 hour; daily 06:00 schedule is much later
		const r = evaluateCheck(
			state({ status: "dead", openIncident: incident() }),
			check("dead"),
			ctxAt("2026-09-30T00:04:00.000Z"),
		);
		expect(r.nextRunAt?.toISOString()).toBe("2026-09-30T01:04:00.000Z");
	});

	it("5.2: after the first hour, follows the regular schedule when it is denser than hourly", () => {
		const schedule: Schedule = { kind: "daily", at: "07:30" };
		const ctx = ctxAt("2026-09-30T00:04:00.000Z", schedule);
		const r = evaluateCheck(
			state({ status: "dead", openIncident: incident() }),
			check("dead"),
			ctx,
		);
		const scheduled = nextRunAt(schedule, LINK_ID, ctx.now);
		expect(scheduled.getTime() - ctx.now.getTime()).toBeLessThan(60 * MIN);
		expect(r.nextRunAt).toEqual(scheduled);
	});

	it("5.2: an error type change during an open incident keeps the same incident", () => {
		const r = evaluateCheck(
			state({ status: "dead", openIncident: incident() }),
			check("down"),
			ctxAt("2026-09-29T23:14:00.000Z"),
		);
		expect(r.status).toBe("down");
		expect(r.action).toEqual({ kind: "none" });
	});

	it("AC-07: success while the incident is open closes it with the downtime since it opened", () => {
		// 10:04, four hours after opening
		const ctx = ctxAt("2026-09-30T03:04:00.000Z");
		const r = evaluateCheck(
			state({ status: "dead", openIncident: incident() }),
			check("up"),
			ctx,
		);
		expect(r.status).toBe("up");
		expect(r.action).toEqual({
			kind: "close",
			openedAt: OPENED_AT,
			closedAt: "2026-09-30T03:04:00.000Z",
			downtimeMs: 4 * 60 * MIN,
		});
		expect(r.nextRunAt).toEqual(nextRunAt(DEFAULT_SCHEDULE, LINK_ID, ctx.now));
	});

	it("AC-07: a slow but successful check also closes the incident", () => {
		const r = evaluateCheck(
			state({ status: "down", openIncident: incident({ type: "down" }) }),
			check("slow"),
			ctxAt("2026-09-29T23:14:00.000Z"),
		);
		expect(r.status).toBe("slow");
		expect(r.action).toMatchObject({ kind: "close", downtimeMs: 10 * MIN });
	});

	it("FR-42: a successful check closes a Verifying incident before anyone confirms", () => {
		const r = evaluateCheck(
			state({
				status: "dead",
				openIncident: incident({ state: "verifying" }),
			}),
			check("up"),
			ctxAt("2026-09-30T00:00:00.000Z"),
		);
		expect(r.action).toMatchObject({ kind: "close", openedAt: OPENED_AT });
	});

	it("FR-04: a paused link is not evaluated and gets no next run", () => {
		const r = evaluateCheck(
			state({ status: "suspect", paused: true }),
			check("dead"),
			ctxAt(OPENED_AT),
		);
		expect(r).toEqual({ status: "suspect", action: { kind: "skip" } });
	});

	it("FR-04: a paused link with an open incident is not closed by a success", () => {
		const r = evaluateCheck(
			state({ status: "dead", paused: true, openIncident: incident() }),
			check("up"),
			ctxAt("2026-09-30T00:00:00.000Z"),
		);
		expect(r.action).toEqual({ kind: "skip" });
		expect(r.nextRunAt).toBeUndefined();
	});
});
