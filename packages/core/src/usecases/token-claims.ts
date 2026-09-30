import type { Db } from "../db/index";
import { hashToken, isTokenExpired } from "../token";
import {
	type ClaimView,
	claimViews,
	type SendDelayedJob,
	submitClaim,
} from "./claims";

export type TokenClaimView =
	/** FR-34 / AC-12: unknown, removed by TTL, or past 7 days. */
	| { status: "expired" }
	/** FR-42 / AC-12: every incident of the token is already closed. */
	| { status: "recovered"; items: ClaimView[] }
	| { status: "open"; items: ClaimView[]; recipient: string };

async function tokenRecord(db: Db, token: string, now: Date) {
	if (!token || token.length > 200) return undefined;
	const { data } = await db.Token.get({ tokenHash: hashToken(token) }).go();
	if (!data || isTokenExpired(data.ttl, now)) return undefined;
	return data;
}

/**
 * FR-35 / AC-11: GET of the confirmation page — read only (link scanners open it): the
 * incidents of the token and their verification progress. Nothing is written.
 */
export async function readTokenClaim(
	db: Db,
	token: string,
	now: Date = new Date(),
): Promise<TokenClaimView> {
	const record = await tokenRecord(db, token, now);
	if (!record) return { status: "expired" };
	const items = await claimViews(db, record.incidentIds);
	if (items.length === 0) return { status: "expired" };
	if (items.every((i) => i.incident.state === "closed"))
		return { status: "recovered", items };
	return { status: "open", items, recipient: record.recipientEmail };
}

/**
 * FR-35 / FR-36: the "Confirm & check again" POST of the confirmation page. The claimer is
 * the recipient the token was issued to; `incidentIds` may narrow a group token.
 */
export async function submitTokenClaim(
	db: Db,
	input: { token: string; note?: string; incidentIds?: string[] },
	deps: { send: SendDelayedJob; now?: Date },
): Promise<TokenClaimView> {
	const now = deps.now ?? new Date();
	const record = await tokenRecord(db, input.token, now);
	if (!record) return { status: "expired" };
	const ids = input.incidentIds?.length
		? record.incidentIds.filter((id) => input.incidentIds?.includes(id))
		: record.incidentIds;
	const items = await submitClaim(
		db,
		{
			incidentIds: ids,
			byEmail: record.recipientEmail,
			channel: "email",
			...(input.note && { note: input.note }),
		},
		{ send: deps.send, now },
	);
	if (items.length === 0) return { status: "expired" };
	if (items.every((i) => i.incident.state === "closed"))
		return { status: "recovered", items };
	return { status: "open", items, recipient: record.recipientEmail };
}
