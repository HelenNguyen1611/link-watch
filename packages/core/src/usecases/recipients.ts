import type { Db } from "../db/index";
import {
	RecipientInput,
	RecipientTarget,
	type RecipientView,
} from "../schema/settings";

const isConditionalFailure = (err: unknown) =>
	/ConditionalCheckFailed|conditional request failed/i.test(
		`${String(err)} ${String((err as { cause?: unknown })?.cause)}`,
	);

export class RecipientTargetNotFoundError extends Error {
	readonly code = "not_found";
	constructor(
		readonly scope: string,
		readonly target: string,
	) {
		super(`${scope === "LINK" ? "Link" : "Domain"} not found: ${target}`);
		this.name = "RecipientTargetNotFoundError";
	}
}

export class DuplicateRecipientError extends Error {
	readonly code = "duplicate";
	constructor(readonly email: string) {
		super(`Recipient already exists: ${email}`);
		this.name = "DuplicateRecipientError";
	}
}

/** FR-20: the domain or link must exist (deleted links cannot get recipients). */
async function assertTarget(
	db: Db,
	{ scope, target }: RecipientTarget,
): Promise<void> {
	if (scope === "DOMAIN") {
		const { data } = await db.Domain.get({ name: target }).go();
		if (data) return;
	} else {
		const { data } = await db.Link.query.byId({ id: target }).go();
		if (data.some((l) => !l.deletedAt)) return;
	}
	throw new RecipientTargetNotFoundError(scope, target);
}

const toView = (r: RecipientView & Record<string, unknown>): RecipientView => ({
	scope: r.scope,
	target: r.target,
	email: r.email,
	...(r.name && { name: r.name }),
});

/** FR-20: recipients of one domain or link, ordered by email. */
export async function listRecipients(
	db: Db,
	raw: unknown,
): Promise<RecipientView[]> {
	const target = RecipientTarget.parse(raw);
	const { data } = await db.Recipient.query
		.byTarget(target)
		.go({ pages: "all" });
	return data.map(toView);
}

/** FR-20: adds a recipient; the same email twice on one target is rejected. */
export async function addRecipient(
	db: Db,
	raw: unknown,
): Promise<RecipientView> {
	const input = RecipientInput.parse(raw);
	await assertTarget(db, input);
	try {
		const { data } = await db.Recipient.create(input).go();
		return toView(data);
	} catch (err) {
		if (isConditionalFailure(err))
			throw new DuplicateRecipientError(input.email);
		throw err;
	}
}

/** FR-20: removes a recipient (no error when it does not exist). */
export async function removeRecipient(db: Db, raw: unknown): Promise<void> {
	const { scope, target, email } = RecipientInput.pick({
		scope: true,
		target: true,
		email: true,
	}).parse(raw);
	await db.Recipient.delete({ scope, target, email }).go();
}
