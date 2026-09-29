/** FR-24: subject tag per email kind. English per the 29/09/2026 English-only decision. */
const TAGS = {
	down: "DOWN",
	recovery: "RECOVERED",
	reminder: "REMINDER",
} as const;

export type EmailSubjectKind = keyof typeof TAGS;

const links = (count: number) => (count === 1 ? "1 link" : `${count} links`);

/**
 * FR-24: `[LinkWatch][DOWN] abc.com — 3 broken links`.
 * Recovery: `[LinkWatch][RECOVERED] abc.com — 3 links back up`.
 * Reminder: `[LinkWatch][REMINDER] abc.com — 3 links still down`.
 */
export function emailSubject(
	kind: EmailSubjectKind,
	domain: string,
	linkCount: number,
): string {
	if (!Number.isInteger(linkCount) || linkCount < 1)
		throw new Error(`Invalid link count: ${linkCount}`);
	const prefix = `[LinkWatch][${TAGS[kind]}] ${domain} — `;
	switch (kind) {
		case "down":
			return `${prefix}${linkCount === 1 ? "1 broken link" : `${linkCount} broken links`}`;
		case "recovery":
			return `${prefix}${links(linkCount)} back up`;
		case "reminder":
			return `${prefix}${links(linkCount)} still down`;
	}
}

/** SRS 5.2 step 5: single admin email when most links fail in one run. */
export function systemWideOutageSubject(
	failed: number,
	checked: number,
): string {
	return `[LinkWatch][NETWORK] ${failed}/${checked} links failed in one run — possible LinkWatch network issue`;
}
