/** FR-20: emails compare case-insensitively, surrounding spaces ignored. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

function uniqueEmails(emails: Iterable<string>): string[] {
	const seen = new Set<string>();
	for (const email of emails) {
		const normalized = normalizeEmail(email);
		if (normalized) seen.add(normalized);
	}
	return [...seen];
}

export type RecipientSources = {
	linkRecipients: readonly string[];
	domainRecipients: readonly string[];
	/** FR-26: default admin email from Settings; undefined when not configured yet. */
	defaultAdminEmail?: string;
	/** FR-20: users the admin switched alerts on for; they get every link's alerts. */
	alertEmails?: readonly string[];
};

/**
 * FR-20: recipients = (link recipients ∪ domain recipients, or the default admin email
 * when both lists are empty) ∪ alert users. Emails are trimmed, lowercased and
 * deduplicated, order kept.
 */
export function resolveRecipients(sources: RecipientSources): string[] {
	const explicit = uniqueEmails([
		...sources.linkRecipients,
		...sources.domainRecipients,
	]);
	const base =
		explicit.length > 0
			? explicit
			: sources.defaultAdminEmail
				? [sources.defaultAdminEmail]
				: [];
	return uniqueEmails([...base, ...(sources.alertEmails ?? [])]);
}

/** FR-20: switches one user's alerts on or off; the list stays normalized and sorted. */
export function withAlertEmail(
	list: readonly string[],
	email: string,
	on: boolean,
): string[] {
	const target = normalizeEmail(email);
	const rest = uniqueEmails(list).filter((e) => e !== target);
	return (on && target ? [...rest, target] : rest).sort();
}

/**
 * FR-20 + FR-22: split a grouped email per recipient so each person only receives
 * the links they are a recipient of. Items keep their original order.
 */
export function groupByRecipient<T>(
	items: readonly T[],
	recipientsOf: (item: T) => readonly string[],
): Map<string, T[]> {
	const byRecipient = new Map<string, T[]>();
	for (const item of items) {
		for (const email of uniqueEmails(recipientsOf(item))) {
			const list = byRecipient.get(email);
			if (list) list.push(item);
			else byRecipient.set(email, [item]);
		}
	}
	return byRecipient;
}
