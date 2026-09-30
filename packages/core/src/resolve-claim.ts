import type { IncidentState } from "./schema/enums";

/** FR-37: verification attempts — now, +2 min, +5 min (to let DNS / CDN catch up). */
export const VERIFY_DELAYS_S = [0, 120, 300] as const;
/** FR-40: at most one re-check per link every 2 minutes. */
export const CLAIM_COOLDOWN_MS = 2 * 60_000;

export type ClaimChannel = "email" | "app";
export type ClaimOutcome = "pending" | "fixed" | "still_failing";

export type ClaimAttempt = {
	attempt: number;
	at: string;
	result: "up" | "slow" | "dead" | "down";
	httpCode?: number;
	errorType?: string;
};

export type ClaimState = {
	claimedAt: string;
	outcome: ClaimOutcome;
	attempts: ClaimAttempt[];
};

export type ClaimDecision =
	/** FR-42 / AC-12: already recovered (by a scheduled check) — nothing to do. */
	| { kind: "recovered"; closedAt?: string }
	/** FR-40 / AC-13: a verification is running or just ran → show its progress, no new claim. */
	| { kind: "in_progress"; claimedAt: string }
	/** FR-36: record the claim, move to Verifying and queue the attempts. */
	| { kind: "start"; delaysS: readonly number[] };

/**
 * FR-36 / FR-40 / FR-42: what to do when someone reports a link as fixed.
 * `latest` is the most recent claim of this incident, if any.
 */
export function decideClaim(
	incident: { state: IncidentState; closedAt?: string },
	latest: ClaimState | undefined,
	now: Date,
): ClaimDecision {
	if (incident.state === "closed")
		return {
			kind: "recovered",
			...(incident.closedAt && { closedAt: incident.closedAt }),
		};
	if (latest) {
		const running = latest.outcome === "pending";
		const recent =
			now.getTime() - Date.parse(latest.claimedAt) < CLAIM_COOLDOWN_MS;
		if (running || recent)
			return { kind: "in_progress", claimedAt: latest.claimedAt };
	}
	return { kind: "start", delaysS: VERIFY_DELAYS_S };
}

export type AttemptEffect =
	/** Success: the check closes the incident (5.2 / FR-37); the claim is marked fixed. */
	| { kind: "fixed" }
	/** Failure before the last attempt: wait for the next one. */
	| { kind: "retry" }
	/** FR-38: all attempts failed → claim still_failing, incident back to Open, tell the claimer. */
	| { kind: "still_failing" }
	/** The claim is already settled (earlier success or superseded): ignore this attempt. */
	| { kind: "ignore" };

/** FR-37 / FR-38: effect of verification attempt `attempt` (1-based) with result `result`. */
export function attemptEffect(
	claim: ClaimState,
	attempt: number,
	result: ClaimAttempt["result"],
): AttemptEffect {
	if (claim.outcome !== "pending") return { kind: "ignore" };
	if (result === "up" || result === "slow") return { kind: "fixed" };
	return attempt >= VERIFY_DELAYS_S.length
		? { kind: "still_failing" }
		: { kind: "retry" };
}

/** FR-39: progress shown on the confirmation page. */
export function claimProgress(claim: ClaimState) {
	return {
		claimedAt: claim.claimedAt,
		outcome: claim.outcome,
		done: claim.outcome !== "pending",
		attempts: claim.attempts,
		total: VERIFY_DELAYS_S.length,
	};
}
export type ClaimProgress = ReturnType<typeof claimProgress>;
