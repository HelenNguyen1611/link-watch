import type { Db } from "../db/index";
import { withAlertEmail } from "../recipients";

const isConditionalFailure = (err: unknown) =>
	/ConditionalCheckFailed|conditional request failed/i.test(
		`${String(err)} ${String((err as { cause?: unknown })?.cause)}`,
	);

/** Concurrent toggles on the Users screen: retry the read-modify-write a few times. */
const MAX_ATTEMPTS = 3;

/** FR-20: users who get every alert (normalized emails, sorted). */
export async function getAlertEmails(db: Db): Promise<string[]> {
	const { data } = await db.Settings.get({}).go();
	return data?.alertEmails ?? [];
}

/**
 * FR-20: switches one user's alerts on or off and returns the new list. The caller checks
 * that the user exists and is active; switching off never needs a check (disable/delete).
 * Optimistic: the write only applies if the list did not change since it was read.
 */
export async function setAlertEmail(
	db: Db,
	email: string,
	on: boolean,
): Promise<string[]> {
	for (let attempt = 1; ; attempt++) {
		const { data } = await db.Settings.get({}).go();
		const stored = data?.alertEmails;
		const current = stored ?? [];
		const next = withAlertEmail(current, email, on);
		if (next.join() === current.join()) return current;
		try {
			if (data)
				await db.Settings.patch({})
					.set({ alertEmails: next })
					.where(({ alertEmails }, { eq, notExists }) =>
						stored ? eq(alertEmails, stored) : notExists(alertEmails),
					)
					.go();
			else await db.Settings.create({ alertEmails: next }).go();
			return next;
		} catch (err) {
			if (!isConditionalFailure(err) || attempt >= MAX_ATTEMPTS) throw err;
		}
	}
}
