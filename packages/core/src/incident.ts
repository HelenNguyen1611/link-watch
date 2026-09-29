import type { ClassifiedCheck } from "./classify";
import { nextRunAt, type Schedule } from "./schedule";
import type { CheckResultKind, IncidentType, LinkStatus } from "./schema/enums";

/** SRS 5.2 step 1: recheck delay after the first failure. */
export const SUSPECT_RECHECK_MS = 2 * 60_000;
/** SRS 5.2 step 3: recheck interval during the first hour of an open incident. */
export const INCIDENT_RECHECK_MS = 10 * 60_000;
/** SRS 5.2 step 3: length of the dense recheck window. */
export const INCIDENT_DENSE_WINDOW_MS = 60 * 60_000;
/** SRS 5.2 step 3: after the first hour, check at least this often. */
export const INCIDENT_MAX_INTERVAL_MS = 60 * 60_000;

/** An incident that has not been closed yet (Open or Verifying). */
export type ActiveIncident = {
	openedAt: string;
	type: IncidentType;
	state: "open" | "verifying";
};

export type LinkCheckState = {
	status: LinkStatus;
	paused: boolean;
	openIncident?: ActiveIncident;
};

export type IncidentAction =
	| { kind: "none" }
	/** FR-04: paused link, the check is ignored. */
	| { kind: "skip" }
	| { kind: "open"; type: IncidentType; openedAt: string }
	| {
			kind: "close";
			openedAt: string;
			closedAt: string;
			/** AC-07: measured from `openedAt` (second failure) to the successful check. */
			downtimeMs: number;
	  };

export type EvaluateContext = {
	now: Date;
	schedule: Schedule;
	linkId: string;
};

export type Evaluation = {
	status: LinkStatus;
	action: IncidentAction;
	/** undefined → the link has no next run (paused). */
	nextRunAt?: Date;
};

const isFailure = (
	result: CheckResultKind,
): result is Extract<CheckResultKind, IncidentType> =>
	result === "dead" || result === "down";

const after = (now: Date, ms: number) => new Date(now.getTime() + ms);

/**
 * SRS 5.2 step 3: every 10 minutes during the first hour, then whichever comes
 * first of the regular schedule and one hour.
 */
function incidentNextRun(incident: ActiveIncident, ctx: EvaluateContext): Date {
	const openFor = ctx.now.getTime() - Date.parse(incident.openedAt);
	if (openFor < INCIDENT_DENSE_WINDOW_MS)
		return after(ctx.now, INCIDENT_RECHECK_MS);
	const scheduled = nextRunAt(ctx.schedule, ctx.linkId, ctx.now);
	const hourly = after(ctx.now, INCIDENT_MAX_INTERVAL_MS);
	return scheduled < hourly ? scheduled : hourly;
}

/**
 * SRS 5.2: incident confirmation state machine for one check.
 * Pure: the caller persists the new status, applies the incident action and enqueues `nextRunAt`.
 */
export function evaluateCheck(
	state: LinkCheckState,
	check: ClassifiedCheck,
	ctx: EvaluateContext,
): Evaluation {
	if (state.paused) return { status: state.status, action: { kind: "skip" } };

	const { now } = ctx;
	const result = check.result;
	const incident = state.openIncident;

	if (incident) {
		if (isFailure(result)) {
			// The error type may change (404 → 503): keep the same incident, only the status follows.
			return {
				status: result,
				action: { kind: "none" },
				nextRunAt: incidentNextRun(incident, ctx),
			};
		}
		// Step 4 and FR-42: any successful check closes an Open or Verifying incident.
		return {
			status: result,
			action: {
				kind: "close",
				openedAt: incident.openedAt,
				closedAt: now.toISOString(),
				downtimeMs: now.getTime() - Date.parse(incident.openedAt),
			},
			nextRunAt: nextRunAt(ctx.schedule, ctx.linkId, now),
		};
	}

	if (isFailure(result)) {
		if (state.status === "suspect") {
			// Step 2: second consecutive failure → open the incident.
			return {
				status: result,
				action: { kind: "open", type: result, openedAt: now.toISOString() },
				nextRunAt: after(now, INCIDENT_RECHECK_MS),
			};
		}
		// Step 1: first failure → Suspect, recheck soon instead of waiting for the schedule.
		return {
			status: "suspect",
			action: { kind: "none" },
			nextRunAt: after(now, SUSPECT_RECHECK_MS),
		};
	}

	// AC-05: success (including after a single failure) → no incident.
	return {
		status: result,
		action: { kind: "none" },
		nextRunAt: nextRunAt(ctx.schedule, ctx.linkId, now),
	};
}
