import type { ClassifiedCheck } from "../classify";
import type { Db } from "../db/index";
import { parseIncidentId } from "../incident";
import type { PriorityJob } from "../queue";
import {
	attemptEffect,
	type ClaimChannel,
	type ClaimProgress,
	type ClaimState,
	claimProgress,
	decideClaim,
} from "../resolve-claim";
import { toIncidentView } from "./incidents";

/** Sends one job to the priority queue with a delay (FR-36/37: 0, +120 s, +300 s). */
export type SendDelayedJob = (
	job: PriorityJob,
	delaySeconds: number,
) => Promise<void>;

type Incident = ReturnType<typeof toIncidentView>;

export type ClaimView = {
	incident: Incident;
	/** Latest claim of this incident, if any. */
	progress?: ClaimProgress & {
		byEmail: string;
		channel: ClaimChannel;
		note?: string;
	};
	/** What the last submit did for this incident. */
	decision?: "started" | "in_progress" | "recovered";
};

async function latestClaim(db: Db, id: string) {
	const { data } = await db.Claim.query
		.byIncident({ incidentId: id })
		.go({ order: "desc", limit: 1 });
	return data[0];
}

async function view(db: Db, id: string): Promise<ClaimView | undefined> {
	const { data } = await db.Incident.get(parseIncidentId(id)).go();
	if (!data) return undefined;
	const claim = await latestClaim(db, id);
	return {
		incident: toIncidentView(data),
		...(claim && {
			progress: {
				...claimProgress(claim as ClaimState),
				byEmail: claim.byEmail,
				channel: claim.channel,
				...(claim.note && { note: claim.note }),
			},
		}),
	};
}

/** FR-39 / FR-41: current state and verification progress of some incidents. */
export async function claimViews(
	db: Db,
	ids: readonly string[],
): Promise<ClaimView[]> {
	const out: ClaimView[] = [];
	for (const id of ids) {
		const v = await view(db, id);
		if (v) out.push(v);
	}
	return out;
}

export type SubmitClaimInput = {
	incidentIds: readonly string[];
	byEmail: string;
	channel: ClaimChannel;
	note?: string;
};

/**
 * FR-36 / FR-40 / FR-42: someone reports links as fixed. Per incident: already closed → nothing
 * (recovered); a verification running or < 2 min old → its progress; otherwise record the
 * claim, move the incident to Verifying and queue checks now, +2 and +5 minutes.
 */
export async function submitClaim(
	db: Db,
	input: SubmitClaimInput,
	{ send, now = new Date() }: { send: SendDelayedJob; now?: Date },
): Promise<ClaimView[]> {
	const results: ClaimView[] = [];
	for (const id of new Set(input.incidentIds)) {
		let key: { linkId: string; openedAt: string };
		try {
			key = parseIncidentId(id);
		} catch {
			continue;
		}
		const { data: incident } = await db.Incident.get(key).go();
		if (!incident) continue;
		const claim = await latestClaim(db, id);
		const decision = decideClaim(
			incident,
			claim as ClaimState | undefined,
			now,
		);
		if (decision.kind === "start") {
			const claimedAt = now.toISOString();
			await db.Claim.create({
				incidentId: id,
				claimedAt,
				linkId: incident.linkId,
				domain: incident.domain,
				byEmail: input.byEmail,
				channel: input.channel,
				...(input.note?.trim() && { note: input.note.trim().slice(0, 1000) }),
			}).go();
			await db.Incident.patch(key)
				.set({
					state: "verifying",
					verifyingBy: input.byEmail,
					verifyingClaimAt: claimedAt,
				})
				.where(({ state }, { ne }) => ne(state, "closed"))
				.go();
			for (const [i, delay] of decision.delaysS.entries())
				await send(
					{
						kind: "verify",
						domain: incident.domain,
						linkIds: [incident.linkId],
						dueAt: new Date(now.getTime() + delay * 1000).toISOString(),
						attempt: i + 1,
						incidentId: id,
						claimedAt,
					},
					delay,
				);
		}
		const v = await view(db, id);
		if (v)
			results.push({
				...v,
				decision:
					decision.kind === "start"
						? "started"
						: decision.kind === "recovered"
							? "recovered"
							: "in_progress",
			});
	}
	return results;
}

/**
 * FR-37 / FR-38: after a verification check was recorded, update its claim: fixed (the check
 * already closed the incident), one more failed attempt, or still failing after the last one
 * (incident back to Open with a note → the claimer is told, Alert FR-38).
 */
export async function applyVerification(
	db: Db,
	job: { incidentId: string; claimedAt: string; attempt: number },
	checked: ClassifiedCheck,
	now: Date,
): Promise<"fixed" | "retry" | "still_failing" | "ignore"> {
	const { data: claim } = await db.Claim.get({
		incidentId: job.incidentId,
		claimedAt: job.claimedAt,
	}).go();
	if (!claim) return "ignore";
	const effect = attemptEffect(
		claim as ClaimState,
		job.attempt,
		checked.result,
	);
	if (effect.kind === "ignore") return "ignore";
	const attempt = {
		attempt: job.attempt,
		at: now.toISOString(),
		result: checked.result,
		...(checked.httpCode !== undefined && { httpCode: checked.httpCode }),
		...(checked.errorType && { errorType: checked.errorType }),
	};
	const key = { incidentId: job.incidentId, claimedAt: job.claimedAt };
	if (effect.kind === "retry") {
		await db.Claim.patch(key)
			.append({ attempts: [attempt] })
			.go();
		return "retry";
	}
	await db.Claim.patch(key)
		.append({ attempts: [attempt] })
		.set({ outcome: effect.kind, finishedAt: now.toISOString() })
		.go();
	if (effect.kind === "still_failing") {
		const error = [checked.httpCode, checked.errorType]
			.filter(Boolean)
			.join(" ");
		await db.Incident.patch(parseIncidentId(job.incidentId))
			.set({
				state: "open",
				claimNote: `Reported fixed by ${claim.byEmail} but still failing${error ? ` (${error})` : ""}`,
			})
			.remove(["verifyingBy", "verifyingClaimAt"])
			.where(({ state }, { eq }) => eq(state, "verifying"))
			.go()
			.catch((err) => {
				// Closed meanwhile by another check: nothing to reopen.
				if (
					!/ConditionalCheckFailed|conditional request failed/i.test(
						String(err),
					)
				)
					throw err;
			});
	}
	return effect.kind;
}
